/**
 * OpenAI-Compatible LLM Provider
 *
 * Covers any service with a /v1/chat/completions endpoint:
 * OpenAI, Ollama, LM Studio, Groq, Together AI, Mistral, local llama.cpp, etc.
 *
 * Supports tool calling via OpenAI's function calling format.
 * Uses raw fetch — no SDK dependency.
 *
 * Includes rate limiting with exponential backoff on 429/500/503.
 */

import type {
  LLMProvider,
  CompletionRequest,
  CompletionResponse,
  LLMMessage,
  ToolDefinition,
  ToolCall,
} from '../../types.js';

const DEFAULT_MAX_TOKENS = 4096;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/** OpenAI chat completions response shape */
interface OpenAIChatResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
    index: number;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model: string;
}

/** OpenAI tool format */
interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** OpenAI message format */
interface OpenAIMessage {
  role: string;
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface OpenAICompatibleConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  readonly providerType = 'openai-compatible' as const;
  private baseUrl: string;
  private apiKey: string;

  constructor(config: OpenAICompatibleConfig) {
    this.name = config.name;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const url = `${this.baseUrl}/v1/chat/completions`;

    const body: Record<string, unknown> = {
      model: request.model,
      messages: this.convertMessages(request.messages),
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: request.temperature,
      stop: request.stop,
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = this.convertTools(request.tools);
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const status = response.status;
          const text = await response.text().catch(() => 'unknown');

          if (this.isRetryableStatus(status) && attempt < MAX_RETRIES) {
            const delay = this.backoffDelay(attempt, response);
            console.warn(
              `[${this.name}] HTTP ${status} (attempt ${attempt + 1}/${MAX_RETRIES + 1}), ` +
              `retrying in ${Math.round(delay)}ms`
            );
            await sleep(delay);
            continue;
          }

          throw new Error(`[${this.name}] HTTP ${status}: ${text}`);
        }

        const data = (await response.json()) as OpenAIChatResponse;
        const choice = data.choices[0];

        // Extract tool calls
        const toolCalls = choice?.message?.tool_calls?.map((tc) => {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            args = { raw: tc.function.arguments };
          }
          return {
            id: tc.id,
            name: tc.function.name,
            arguments: args,
          };
        });

        return {
          content: choice?.message?.content ?? '',
          model: data.model,
          usage: {
            inputTokens: data.usage?.prompt_tokens ?? 0,
            outputTokens: data.usage?.completion_tokens ?? 0,
          },
          finishReason: this.mapFinishReason(choice?.finish_reason),
          toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
        };
      } catch (err) {
        lastError = err as Error;

        if (this.isNetworkError(err) && attempt < MAX_RETRIES) {
          const delay = this.backoffDelay(attempt, null);
          console.warn(
            `[${this.name}] Network error (attempt ${attempt + 1}/${MAX_RETRIES + 1}), ` +
            `retrying in ${Math.round(delay)}ms: ${(err as Error).message}`
          );
          await sleep(delay);
          continue;
        }

        if (!this.isNetworkError(err)) throw err;
      }
    }

    throw lastError ?? new Error(`[${this.name}] Request failed after all retries`);
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Convert our LLMMessage to OpenAI format */
  private convertMessages(messages: LLMMessage[]): OpenAIMessage[] {
    return messages.map((msg) => {
      if (msg.role === 'tool') {
        return {
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.toolCallId,
        };
      }
      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: msg.content || null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
      }
      return {
        role: msg.role,
        content: msg.content,
      };
    });
  }

  /** Convert our ToolDefinition to OpenAI format */
  private convertTools(tools: ToolDefinition[]): OpenAITool[] {
    return tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  private mapFinishReason(reason: string | undefined): CompletionResponse['finishReason'] {
    switch (reason) {
      case 'stop': return 'end';
      case 'length': return 'max_tokens';
      case 'content_filter': return 'stop';
      case 'tool_calls': return 'tool_use';
      default: return 'end';
    }
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || status === 500 || status === 502 || status === 503;
  }

  private isNetworkError(err: unknown): boolean {
    const code = (err as { code?: string }).code;
    return code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ENOTFOUND' ||
           code === 'UND_ERR_CONNECT_TIMEOUT' || err instanceof TypeError;
  }

  private backoffDelay(attempt: number, response: globalThis.Response | null): number {
    if (response) {
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter) {
        const seconds = parseFloat(retryAfter);
        if (!isNaN(seconds)) return seconds * 1000;
      }
    }
    const jitter = 0.5 + Math.random();
    return BASE_DELAY_MS * Math.pow(2, attempt) * jitter;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
