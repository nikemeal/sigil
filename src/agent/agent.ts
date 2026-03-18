/**
 * Agent Core
 *
 * Message processing: takes a message, builds context (with conversation
 * history, memories, profile), sends to LLM, records the exchange,
 * and returns a response.
 *
 * Future modules extend this:
 *   - Module 4: tool calling loop (multi-round)
 *   - Module 5: smart routing to different models
 *   - Module 6: background task orchestration
 */

import { randomUUID } from 'node:crypto';
import type {
  Message,
  Response,
  LLMProvider,
  SigilConfig,
} from '../types.js';
import { EventBus } from '../lib/event-bus.js';
import { ContextEngine } from '../context/engine.js';

export class Agent {
  private provider: LLMProvider;
  private config: SigilConfig;
  private bus: EventBus;
  private context: ContextEngine | null = null;

  constructor(provider: LLMProvider, config: SigilConfig, bus: EventBus) {
    this.provider = provider;
    this.config = config;
    this.bus = bus;
  }

  /** Attach the context engine (called after DB is initialised) */
  setContext(context: ContextEngine): void {
    this.context = context;
  }

  /**
   * Process a single message and return a response.
   * This is the core loop — everything flows through here.
   */
  async process(message: Message): Promise<Response> {
    try {
      // Build context: system prompt + memories + history + current message
      const llmMessages = this.context
        ? await this.context.buildContext(message)
        : this.buildFallbackMessages(message);

      // Record the user message in conversation history
      if (this.context) {
        this.context.recordMessage(message.id, 'user', message.content, message.source);
      }

      // Determine which model to use
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

      // Record the assistant response in conversation history
      if (this.context) {
        this.context.recordMessage(response.id, 'assistant', completion.content);
      }

      this.bus.emit('message:complete', response);
      this.bus.emit('broadcast:response', response);

      return response;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.bus.emit('message:error', { messageId: message.id, error });
      throw err;
    }
  }

  /** Get the context engine (for tools that need memory access) */
  getContext(): ContextEngine | null {
    return this.context;
  }

  /**
   * Fallback message building when no context engine is attached.
   * Just identity + current message — same as Module 1.
   */
  private buildFallbackMessages(message: Message) {
    return [
      {
        role: 'system' as const,
        content: `You are ${this.config.identity.name}.\n\n${this.config.identity.personality}`,
      },
      {
        role: 'user' as const,
        content: message.content,
      },
    ];
  }

  /** Resolve which model to use. */
  private resolveModel(): string {
    const modelConfig = this.config.models.find(
      (m) => m.name === this.config.defaultModel
    );
    if (!modelConfig) {
      return this.config.models[0]?.model ?? this.config.defaultModel;
    }
    return modelConfig.model;
  }
}
