/**
 * Agent Core
 *
 * Message processing with multi-round tool calling.
 * Flow: message → build context → call LLM → if tool_use, execute tools,
 * feed results back to LLM → repeat until LLM gives a text response
 * or we hit the max rounds limit.
 */

import { randomUUID } from 'node:crypto';
import type {
  Message,
  Response,
  LLMProvider,
  LLMMessage,
  SigilConfig,
  ToolCall,
} from '../types.js';
import { EventBus } from '../lib/event-bus.js';
import { ContextEngine } from '../context/engine.js';
import { ToolRegistry } from '../tools/registry.js';

/** Maximum tool-calling rounds before forcing a response */
const MAX_TOOL_ROUNDS = 10;

export class Agent {
  private provider: LLMProvider;
  private config: SigilConfig;
  private bus: EventBus;
  private context: ContextEngine | null = null;
  private tools: ToolRegistry | null = null;

  constructor(provider: LLMProvider, config: SigilConfig, bus: EventBus) {
    this.provider = provider;
    this.config = config;
    this.bus = bus;
  }

  /** Attach the context engine (called after DB is initialised) */
  setContext(context: ContextEngine): void {
    this.context = context;
  }

  /** Attach the tool registry */
  setTools(tools: ToolRegistry): void {
    this.tools = tools;
  }

  /**
   * Process a message through the LLM with multi-round tool calling.
   */
  async process(message: Message): Promise<Response> {
    try {
      // Build initial context
      const llmMessages = this.context
        ? await this.context.buildContext(message)
        : this.buildFallbackMessages(message);

      // Record user message
      if (this.context) {
        this.context.recordMessage(message.id, 'user', message.content, message.source);
      }

      const model = this.resolveModel();
      const toolDefs = this.tools ? this.tools.getDefinitions() : [];

      // Tool calling loop
      let round = 0;
      let currentMessages = [...llmMessages];

      while (round < MAX_TOOL_ROUNDS) {
        const completion = await this.provider.complete({
          messages: currentMessages,
          model,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
        });

        // If no tool calls, we're done — return the text response
        if (!completion.toolCalls || completion.toolCalls.length === 0) {
          const response = this.buildResponse(message.id, completion.content, completion.model, completion.usage);

          if (this.context) {
            this.context.recordMessage(response.id, 'assistant', completion.content);
          }

          this.bus.emit('message:complete', response);
          this.bus.emit('broadcast:response', response);
          return response;
        }

        // LLM wants to call tools — add its response to messages
        const assistantMsg: LLMMessage = {
          role: 'assistant',
          content: completion.content,
          toolCalls: completion.toolCalls,
        };
        currentMessages.push(assistantMsg);

        // Execute each tool call and add results
        for (const toolCall of completion.toolCalls) {
          console.log(`[Agent] Tool call: ${toolCall.name}(${JSON.stringify(toolCall.arguments).slice(0, 100)})`);

          const result = this.tools
            ? await this.tools.execute(toolCall.name, toolCall.arguments, message.id)
            : `Error: No tool registry available.`;

          console.log(`[Agent] Tool result: ${result.slice(0, 100)}${result.length > 100 ? '...' : ''}`);

          const toolMsg: LLMMessage = {
            role: 'tool',
            toolCallId: toolCall.id,
            content: result,
          };
          currentMessages.push(toolMsg);
        }

        round++;
      }

      // Hit max rounds — return whatever we have
      const finalResponse = this.buildResponse(
        message.id,
        'I reached the maximum number of tool-calling rounds. Here is what I found so far.',
        model,
      );

      this.bus.emit('message:complete', finalResponse);
      this.bus.emit('broadcast:response', finalResponse);
      return finalResponse;

    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.bus.emit('message:error', { messageId: message.id, error });
      throw err;
    }
  }

  /** Get the context engine */
  getContext(): ContextEngine | null {
    return this.context;
  }

  /** Get the tool registry */
  getTools(): ToolRegistry | null {
    return this.tools;
  }

  private buildResponse(
    messageId: string,
    content: string,
    model: string,
    usage?: { inputTokens: number; outputTokens: number },
  ): Response {
    return {
      id: randomUUID(),
      messageId,
      content,
      model,
      timestamp: new Date(),
      usage,
    };
  }

  private buildFallbackMessages(message: Message): LLMMessage[] {
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
