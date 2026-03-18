/**
 * Anthropic LLM Provider
 *
 * Native Anthropic API implementation (Claude models).
 * Handles the Anthropic-specific message format where the system prompt
 * is a separate parameter, not part of the messages array.
 *
 * Includes rate limiting with exponential backoff on 429/500/503.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMProvider,
  CompletionRequest,
  CompletionResponse,
  LLMMessage,
} from '../../types.js';

/** Default max tokens if not specified in request or model config */
const DEFAULT_MAX_TOKENS = 4096;

/** Backoff config for rate limiting */
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly providerType = 'anthropic' as const;
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    // Anthropic separates system prompt from messages
    const { system, messages } = this.splitSystemPrompt(request.messages);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: request.model,
          max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: request.temperature,
          system: system || undefined,
          messages,
          stop_sequences: request.stop,
        });

        // Extract text from content blocks
        const content = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('');

        return {
          content,
          model: response.model,
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            cacheReadTokens: (response.usage as unknown as Record<string, number>).cache_read_input_tokens,
            cacheWriteTokens: (response.usage as unknown as Record<string, number>).cache_creation_input_tokens,
          },
          finishReason: this.mapStopReason(response.stop_reason),
        };
      } catch (err) {
        lastError = err as Error;

        // Only retry on rate limit or server errors
        if (!this.isRetryable(err)) throw err;

        // Exponential backoff with jitter
        const delay = this.backoffDelay(attempt, err);
        console.warn(
          `[Anthropic] Request failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), ` +
          `retrying in ${Math.round(delay)}ms: ${(err as Error).message}`
        );
        await sleep(delay);
      }
    }

    throw lastError ?? new Error('[Anthropic] Request failed after all retries');
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Minimal request to check connectivity
      await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Anthropic expects system prompt as a separate param, not in the messages array.
   * Split it out here.
   */
  private splitSystemPrompt(messages: LLMMessage[]): {
    system: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  } {
    let system = '';
    const filtered: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Concatenate multiple system messages (shouldn't happen, but be safe)
        system += (system ? '\n\n' : '') + msg.content;
      } else {
        filtered.push({ role: msg.role, content: msg.content });
      }
    }

    return { system, messages: filtered };
  }

  /** Map Anthropic stop reasons to our standard set */
  private mapStopReason(reason: string | null): CompletionResponse['finishReason'] {
    switch (reason) {
      case 'end_turn': return 'end';
      case 'max_tokens': return 'max_tokens';
      case 'stop_sequence': return 'stop';
      default: return 'end';
    }
  }

  /** Check if an error is retryable (rate limit or server error) */
  private isRetryable(err: unknown): boolean {
    if (err instanceof Anthropic.RateLimitError) return true;
    if (err instanceof Anthropic.InternalServerError) return true;
    if (err instanceof Anthropic.APIConnectionError) return true;

    // Check status code for generic HTTP errors
    const status = (err as { status?: number }).status;
    return status === 429 || status === 500 || status === 503;
  }

  /** Calculate backoff delay, respecting retry-after header if present */
  private backoffDelay(attempt: number, err: unknown): number {
    // Check for retry-after header
    const retryAfter = (err as { headers?: Record<string, string> }).headers?.['retry-after'];
    if (retryAfter) {
      const seconds = parseFloat(retryAfter);
      if (!isNaN(seconds)) return seconds * 1000;
    }

    // Exponential backoff with jitter: base * 2^attempt * (0.5-1.5 random)
    const jitter = 0.5 + Math.random();
    return BASE_DELAY_MS * Math.pow(2, attempt) * jitter;
  }
}

/** Simple sleep utility */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
