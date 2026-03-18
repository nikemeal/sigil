/**
 * OpenAI-Compatible LLM Provider
 *
 * Covers any service with a /v1/chat/completions endpoint:
 * OpenAI, Ollama, LM Studio, Groq, Together AI, Mistral, local llama.cpp, etc.
 *
 * Uses raw fetch — no SDK dependency. This keeps it lightweight and avoids
 * version conflicts between different OpenAI-compatible services.
 *
 * Includes rate limiting with exponential backoff on 429/500/503.
 */

import type {
  LLMProvider,
  CompletionRequest,
  CompletionResponse,
} from '../../types.js';

/** Default max tokens if not specified */
const DEFAULT_MAX_TOKENS = 4096;

/** Backoff config */
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/** OpenAI chat completions response shape */
interface OpenAIChatResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string | null };
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

export interface OpenAICompatibleConfig {
  /** Display name for this provider instance (e.g. 'ollama', 'openai', 'groq') */
  name: string;
  /** Base URL for the API (e.g. 'http://localhost:11434', 'https://api.openai.com') */
  baseUrl: string;
  /** API key — empty string for keyless services like local Ollama */
  apiKey: string;
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  readonly providerType = 'openai-compatible' as const;
  private baseUrl: string;
  private apiKey: string;

  constructor(config: OpenAICompatibleConfig) {
    this.name = config.name;
    // Normalise: strip trailing slash, ensure /v1 path
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const url = `${this.baseUrl}/v1/chat/completions`;

    const body = {
      model: request.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: request.temperature,
      stop: request.stop,
    };

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

        return {
          content: choice?.message?.content ?? '',
          model: data.model,
          usage: {
            inputTokens: data.usage?.prompt_tokens ?? 0,
            outputTokens: data.usage?.completion_tokens ?? 0,
          },
          finishReason: this.mapFinishReason(choice?.finish_reason),
        };
      } catch (err) {
        lastError = err as Error;

        // Network errors (ECONNREFUSED, etc.) are retryable
        if (this.isNetworkError(err) && attempt < MAX_RETRIES) {
          const delay = this.backoffDelay(attempt, null);
          console.warn(
            `[${this.name}] Network error (attempt ${attempt + 1}/${MAX_RETRIES + 1}), ` +
            `retrying in ${Math.round(delay)}ms: ${(err as Error).message}`
          );
          await sleep(delay);
          continue;
        }

        // Non-retryable errors bubble up immediately
        if (!this.isNetworkError(err)) throw err;
      }
    }

    throw lastError ?? new Error(`[${this.name}] Request failed after all retries`);
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Try the models endpoint first (lightweight, no tokens used)
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Map OpenAI finish reasons to our standard set */
  private mapFinishReason(reason: string | undefined): CompletionResponse['finishReason'] {
    switch (reason) {
      case 'stop': return 'end';
      case 'length': return 'max_tokens';
      case 'content_filter': return 'stop';
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

  /** Calculate backoff delay, respecting retry-after header if present */
  private backoffDelay(attempt: number, response: Response | null): number {
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
