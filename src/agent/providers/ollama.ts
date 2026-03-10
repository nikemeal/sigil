import type { LLMProvider, CompletionRequest, CompletionResponse, ToolSchema } from '../../gateway/types.js';

/**
 * Ollama provider — talks to a local Ollama instance via its OpenAI-compatible API.
 *
 * Ollama exposes /v1/chat/completions which supports tool_calls for models
 * that have been trained for it (Qwen 3, Llama 3.x, Mistral, etc.)
 *
 * For models without native tool support, we fall back to prompt-based
 * tool calling — injecting tool schemas into the system prompt and parsing
 * the response for JSON tool calls.
 */
export class OllamaProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;
  private supportsNativeTools: boolean;

  // Models known to support native tool calling via Ollama
  private static NATIVE_TOOL_MODELS = [
    'qwen3', 'qwen2.5', 'llama3', 'llama4', 'mistral', 'glm4',
    'deepseek', 'command-r', 'firefunction',
  ];

  constructor(model: string, baseUrl = 'http://localhost:11434') {
    this.model = model;
    this.baseUrl = baseUrl;

    // Check if model likely supports native tool calling
    const modelLower = model.toLowerCase();
    this.supportsNativeTools = OllamaProvider.NATIVE_TOOL_MODELS.some(
      m => modelLower.includes(m)
    );
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    if (this.supportsNativeTools && request.tools?.length) {
      return this.completeWithNativeTools(request);
    }
    return this.completeWithPromptTools(request);
  }

  /**
   * Native tool calling — uses Ollama's OpenAI-compatible /v1/chat/completions
   */
  private async completeWithNativeTools(request: CompletionRequest): Promise<CompletionResponse> {
    const tools = request.tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: request.system },
        ...request.messages,
      ],
      tools,
      stream: false,
      options: {
        temperature: request.temperature ?? 0.7,
        num_predict: request.maxTokens ?? 4096,
      },
    };

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama API error (${res.status}): ${err}`);
    }

    const data = await res.json() as OllamaResponse;
    const choice = data.choices?.[0];

    if (!choice) {
      throw new Error('Ollama returned no choices');
    }

    const toolCalls = choice.message.tool_calls?.map(tc => ({
      id: tc.id ?? `tool_${Date.now()}`,
      name: tc.function.name,
      input: typeof tc.function.arguments === 'string'
        ? JSON.parse(tc.function.arguments)
        : tc.function.arguments,
    }));

    return {
      content: choice.message.content ?? '',
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      stopReason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
      usage: data.usage ? {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
      } : undefined,
    };
  }

  /**
   * Prompt-based tool calling — for models without native tool support.
   * Injects tool schemas into the system prompt and parses JSON from the response.
   */
  private async completeWithPromptTools(request: CompletionRequest): Promise<CompletionResponse> {
    let system = request.system;

    if (request.tools?.length) {
      system += '\n\n' + this.buildToolPrompt(request.tools);
    }

    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: system },
        ...request.messages,
      ],
      stream: false,
      options: {
        temperature: request.temperature ?? 0.7,
        num_predict: request.maxTokens ?? 4096,
      },
    };

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama API error (${res.status}): ${err}`);
    }

    const data = await res.json() as OllamaChatResponse;
    const content = data.message?.content ?? '';

    // Try to parse tool calls from the response
    const toolCalls = this.parseToolCallsFromText(content);

    // If we found tool calls, strip them from the visible content
    let cleanContent = content;
    if (toolCalls.length > 0) {
      cleanContent = content
        .replace(/```json\s*\{[\s\S]*?\}\s*```/g, '')
        .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
        .trim();
    }

    return {
      content: cleanContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
      usage: data.eval_count ? {
        inputTokens: data.prompt_eval_count ?? 0,
        outputTokens: data.eval_count ?? 0,
      } : undefined,
    };
  }

  private buildToolPrompt(tools: ToolSchema[]): string {
    const toolDefs = tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    return `# Available Tools

You have access to the following tools. To use a tool, respond with a JSON block inside <tool_call> tags:

<tool_call>
{"name": "tool_name", "arguments": {"param": "value"}}
</tool_call>

You can call multiple tools by including multiple <tool_call> blocks.
Only use tools when they would help accomplish the task. Otherwise, respond normally.

Tools:
${JSON.stringify(toolDefs, null, 2)}`;
  }

  /**
   * Parse tool calls from model output.
   * Supports both <tool_call> XML tags and ```json code blocks.
   */
  private parseToolCallsFromText(text: string): Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }> {
    const calls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

    // Try <tool_call> tags first
    const tagPattern = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
    let match;
    while ((match = tagPattern.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed.name) {
          calls.push({
            id: `tool_${Date.now()}_${calls.length}`,
            name: parsed.name,
            input: parsed.arguments ?? parsed.input ?? parsed.params ?? {},
          });
        }
      } catch {
        // Not valid JSON, skip
      }
    }

    if (calls.length > 0) return calls;

    // Fallback: try ```json blocks
    const codePattern = /```json\s*(\{[\s\S]*?\})\s*```/g;
    while ((match = codePattern.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed.name) {
          calls.push({
            id: `tool_${Date.now()}_${calls.length}`,
            name: parsed.name,
            input: parsed.arguments ?? parsed.input ?? parsed.params ?? {},
          });
        }
      } catch {
        // Not valid JSON, skip
      }
    }

    return calls;
  }

  /** Check if Ollama is running and the model is available */
  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (!res.ok) return { ok: false, error: `Ollama returned ${res.status}` };

      const data = await res.json() as { models: Array<{ name: string }> };
      const available = data.models?.map(m => m.name) ?? [];
      const modelBase = this.model.split(':')[0];

      if (!available.some(m => m.startsWith(modelBase))) {
        return {
          ok: false,
          error: `Model "${this.model}" not found. Available: ${available.join(', ')}. Run: ollama pull ${this.model}`,
        };
      }

      return { ok: true };
    } catch {
      return { ok: false, error: 'Cannot connect to Ollama. Is it running? (ollama serve)' };
    }
  }
}

// --- Ollama API response types ---

interface OllamaResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        id?: string;
        function: { name: string; arguments: string | Record<string, unknown> };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

interface OllamaChatResponse {
  message?: { content: string };
  eval_count?: number;
  prompt_eval_count?: number;
}
