import type { LLMProvider, CompletionRequest, CompletionResponse, ToolSchema } from '../../gateway/types.js';
import type { CopilotAuth, CopilotSessionToken } from './copilot-auth.js';

/**
 * GitHub Copilot provider — uses Copilot's OpenAI-compatible chat completions API.
 *
 * Copilot proxies multiple models (GPT-4o, Claude, Gemini, etc.) through a
 * single endpoint. Authentication is via a short-lived session token that
 * CopilotAuth manages (refreshed from the OAuth token automatically).
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
    const session = await this.auth.getSessionToken();
    if (!session) {
      throw new Error(
        'Copilot session expired or not authenticated. ' +
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
        Authorization: `Bearer ${session.token}`,
        'Openai-Intent': 'conversation-edits',
        'Editor-Version': 'sigil/0.1.0',
      },
      body: JSON.stringify(body),
    });

    if (res.status === 401) {
      // Token might have just expired — try one refresh
      const refreshed = await this.retryWithRefresh(body);
      if (refreshed) return refreshed;
      throw new Error('Copilot session token expired and refresh failed.');
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Copilot API error (${res.status}): ${err}`);
    }

    return this.parseResponse(await res.json());
  }

  private async retryWithRefresh(body: Record<string, unknown>): Promise<CompletionResponse | null> {
    // Force a new session token
    const session = await this.auth.getSessionToken();
    if (!session) return null;

    const res = await fetch(COPILOT_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
        'Openai-Intent': 'conversation-edits',
        'Editor-Version': 'sigil/0.1.0',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) return null;
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

  /** Health check — verify the session token is valid */
  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const session = await this.auth.getSessionToken();
      if (!session) {
        return { ok: false, error: 'Not authenticated — no valid session token' };
      }

      // Check if token will expire soon (within 5 minutes)
      const now = Math.floor(Date.now() / 1000);
      if (session.expiresAt < now + 300) {
        return { ok: false, error: `Session token expires in ${session.expiresAt - now}s` };
      }

      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
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
