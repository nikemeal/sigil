import type { LLMProvider, CompletionRequest, CompletionResponse, ToolSchema } from '../../gateway/types.js';
import type { CopilotAuth } from './copilot-auth.js';

/**
 * GitHub Copilot provider — uses Copilot's OpenAI-compatible chat completions API.
 *
 * Copilot proxies multiple models (GPT-4o, Claude, Gemini, etc.) through a
 * single endpoint. Authentication is via the OAuth token directly — no
 * session token exchange needed.
 *
 * The API endpoint is: https://api.githubcopilot.com/chat/completions
 * It's OpenAI-compatible, so we use the same format as the Ollama native tools path.
 */

const COPILOT_CHAT_URL = 'https://api.githubcopilot.com/chat/completions';

export class CopilotProvider implements LLMProvider {
  private auth: CopilotAuth;
  private model: string;

  constructor(auth: CopilotAuth, model: string) {
    this.auth = auth;
    this.model = model;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const token = this.auth.getToken();
    if (!token) {
      throw new Error(
        'Copilot not authenticated. ' +
        'Re-run onboarding or restart Sigil to re-authenticate.'
      );
    }

    const tools = request.tools?.map(this.toOpenAITool) ?? [];

    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: 'system', content: request.system },
        ...request.messages,
      ],
      max_tokens: request.maxTokens ?? 8192,
      temperature: request.temperature ?? 0.7,
      stream: false,
    };

    if (tools.length > 0) {
      body.tools = tools;
    }

    const res = await fetch(COPILOT_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Openai-Intent': 'conversation-edits',
        'Editor-Version': 'sigil/0.1.0',
      },
      body: JSON.stringify(body),
    });

    if (res.status === 401) {
      throw new Error(
        'Copilot OAuth token is invalid or revoked. ' +
        'Re-run onboarding to re-authenticate.'
      );
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Copilot API error (${res.status}): ${err}`);
    }

    return this.parseResponse(await res.json());
  }

  private parseResponse(data: OpenAIChatResponse): CompletionResponse {
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error('Copilot returned no choices');
    }

    const content = choice.message.content ?? '';

    const toolCalls = choice.message.tool_calls?.map(tc => ({
      id: tc.id ?? `tool_${Date.now()}`,
      name: tc.function.name,
      input: typeof tc.function.arguments === 'string'
        ? JSON.parse(tc.function.arguments)
        : tc.function.arguments,
    }));

    return {
      content,
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      stopReason: choice.finish_reason === 'tool_calls' || choice.finish_reason === 'function_call'
        ? 'tool_use'
        : 'end_turn',
      usage: data.usage ? {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
      } : undefined,
    };
  }

  private toOpenAITool(tool: ToolSchema) {
    return {
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    };
  }

  /** Health check — verify the OAuth token is still valid */
  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    return this.auth.verifyToken();
  }
}

// ── OpenAI-compatible response types ──

interface OpenAIChatResponse {
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
