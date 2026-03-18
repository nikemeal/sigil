/**
 * Agent Core
 *
 * Single-turn message processing: takes a message, sends it to the LLM,
 * returns a response. Module 1 keeps this simple — no tools, no multi-turn,
 * no routing. Just message in, LLM call, response out.
 *
 * Future modules extend this:
 *   - Module 2: conversation history and context assembly
 *   - Module 4: tool calling loop (multi-round)
 *   - Module 5: smart routing to different models
 *   - Module 6: background task orchestration
 */

import { randomUUID } from 'node:crypto';
import type {
  Message,
  Response,
  LLMProvider,
  LLMMessage,
  SigilConfig,
} from '../types.js';
import { EventBus } from '../lib/event-bus.js';

export class Agent {
  private provider: LLMProvider;
  private config: SigilConfig;
  private bus: EventBus;

  constructor(provider: LLMProvider, config: SigilConfig, bus: EventBus) {
    this.provider = provider;
    this.config = config;
    this.bus = bus;
  }

  /**
   * Process a single message and return a response.
   * This is the core loop — everything flows through here.
   */
  async process(message: Message): Promise<Response> {
    this.bus.emit('message:processing', { messageId: message.id });

    try {
      // Build the messages array for the LLM
      const llmMessages = this.buildMessages(message);

      // Determine which model to use (module 5 makes this smart)
      const model = this.resolveModel();

      // Call the LLM
      const completion = await this.provider.complete({
        messages: llmMessages,
        model,
      });

      const response: Response = {
        id: randomUUID(),
        messageId: message.id,
        content: completion.content,
        model: completion.model,
        timestamp: new Date(),
        usage: completion.usage,
      };

      this.bus.emit('message:complete', response);
      this.bus.emit('broadcast:response', response);

      return response;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.bus.emit('message:error', { messageId: message.id, error });
      throw err;
    }
  }

  /**
   * Build the LLM message array for a request.
   * Module 1: just system prompt + user message.
   * Module 2 adds: memories, compressed history, living profile.
   */
  private buildMessages(message: Message): LLMMessage[] {
    const messages: LLMMessage[] = [];

    // System prompt with agent identity
    const systemParts: string[] = [
      `You are ${this.config.identity.name}.`,
      this.config.identity.personality,
    ];

    messages.push({
      role: 'system',
      content: systemParts.join('\n\n'),
    });

    // User message
    messages.push({
      role: 'user',
      content: message.content,
    });

    return messages;
  }

  /** Resolve which model to use. Module 1: just the default. */
  private resolveModel(): string {
    // Find the default model config
    const modelConfig = this.config.models.find(
      (m) => m.name === this.config.defaultModel
    );

    if (!modelConfig) {
      // Fallback: use the first model, or the raw default name
      return this.config.models[0]?.model ?? this.config.defaultModel;
    }

    return modelConfig.model;
  }
}
