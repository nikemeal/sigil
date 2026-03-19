/**
 * Agent Core
 *
 * Message processing with smart routing, context trimming,
 * and multi-round tool calling.
 *
 * Flow:
 *   1. Router classifies message complexity, picks model
 *   2. Context trimmer adjusts context window for that model/tier
 *   3. LLM called (possibly multiple rounds for tool use)
 *   4. Cost tracked
 *   5. Response broadcast
 */

import { randomUUID } from 'node:crypto';
import type {
  Message,
  Response,
  LLMProvider,
  LLMMessage,
  SigilConfig,
  ModelConfig,
} from '../types.js';
import { EventBus } from '../lib/event-bus.js';
import { ContextEngine } from '../context/engine.js';
import { ToolRegistry } from '../tools/registry.js';
import { Router, type RoutingDecision } from '../router/router.js';
import { ProviderPool } from '../router/provider-pool.js';
import { CostTracker } from '../router/cost-tracker.js';
import { getTrimConfig, trimTools } from '../router/trimmer.js';

/** Maximum tool-calling rounds before forcing a response */
const MAX_TOOL_ROUNDS = 10;

export class Agent {
  private config: SigilConfig;
  private bus: EventBus;
  private context: ContextEngine | null = null;
  private tools: ToolRegistry | null = null;
  private router: Router;
  private pool: ProviderPool;
  private costTracker: CostTracker | null = null;

  // Fallback single provider (for when pool has only one model)
  private fallbackProvider: LLMProvider | null = null;

  constructor(config: SigilConfig, bus: EventBus, pool: ProviderPool) {
    this.config = config;
    this.bus = bus;
    this.pool = pool;
    this.router = new Router(config);
  }

  setContext(context: ContextEngine): void { this.context = context; }
  setTools(tools: ToolRegistry): void { this.tools = tools; }
  setCostTracker(tracker: CostTracker): void { this.costTracker = tracker; }
  getContext(): ContextEngine | null { return this.context; }
  getTools(): ToolRegistry | null { return this.tools; }

  /**
   * Process a message: route → trim → call LLM → track cost → respond.
   */
  async process(message: Message): Promise<Response> {
    try {
      // 1. Route: classify and pick model
      const decision = this.router.route(message.content);
      const provider = this.pool.getProvider(decision.model);

      console.log(
        `[Agent] ${decision.reason} | type=${decision.classification.type} ` +
        `confidence=${decision.classification.confidence.toFixed(2)} model=${decision.model.name}`
      );

      // 2. Trim context for this request type
      const trimConfig = getTrimConfig(decision.classification.type);

      // Build context with trimming
      const messageWithCleanContent = { ...message, content: decision.cleanMessage };
      const llmMessages = this.context
        ? await this.context.buildContext(messageWithCleanContent, trimConfig)
        : this.buildFallbackMessages(messageWithCleanContent);

      // Record user message
      if (this.context) {
        this.context.recordMessage(message.id, 'user', decision.cleanMessage, message.source);
      }

      // Get tool definitions (trimmed for this request type)
      const allToolDefs = this.tools ? this.tools.getDefinitions() : [];
      const toolDefs = trimTools(allToolDefs, trimConfig);

      // 3. Tool calling loop
      let round = 0;
      let currentMessages = [...llmMessages];
      let totalUsage = { inputTokens: 0, outputTokens: 0 };

      while (round < MAX_TOOL_ROUNDS) {
        const completion = await provider.complete({
          messages: currentMessages,
          model: decision.model.model,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
        });

        totalUsage.inputTokens += completion.usage.inputTokens;
        totalUsage.outputTokens += completion.usage.outputTokens;

        // No tool calls — we're done
        if (!completion.toolCalls || completion.toolCalls.length === 0) {
          // Track cost
          if (this.costTracker) {
            this.costTracker.log(
              message.id,
              decision.model,
              totalUsage,
              decision.classification.type,
              decision.classification.override ? 'override' : 'heuristic',
              decision.classification.override ?? null,
            );
          }

          const response = this.buildResponse(
            message.id, completion.content, decision.model.model, totalUsage,
          );

          if (this.context) {
            this.context.recordMessage(response.id, 'assistant', completion.content);
          }

          this.bus.emit('message:complete', response);
          this.bus.emit('broadcast:response', response);
          return response;
        }

        // Tool calls — execute and continue
        const assistantMsg: LLMMessage = {
          role: 'assistant',
          content: completion.content,
          toolCalls: completion.toolCalls,
        };
        currentMessages.push(assistantMsg);

        for (const toolCall of completion.toolCalls) {
          console.log(`[Agent] Tool: ${toolCall.name}(${JSON.stringify(toolCall.arguments).slice(0, 100)})`);

          const result = this.tools
            ? await this.tools.execute(toolCall.name, toolCall.arguments, message.id)
            : `Error: No tool registry available.`;

          console.log(`[Agent] Result: ${result.slice(0, 100)}${result.length > 100 ? '...' : ''}`);

          const toolMsg: LLMMessage = {
            role: 'tool',
            toolCallId: toolCall.id,
            content: result,
          };
          currentMessages.push(toolMsg);
        }

        round++;
      }

      // Hit max rounds
      const finalResponse = this.buildResponse(
        message.id,
        'I reached the maximum number of tool-calling rounds. Here is what I found so far.',
        decision.model.model,
        totalUsage,
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

  private buildResponse(
    messageId: string, content: string, model: string,
    usage?: { inputTokens: number; outputTokens: number },
  ): Response {
    return {
      id: randomUUID(),
      messageId, content, model,
      timestamp: new Date(),
      usage,
    };
  }

  private buildFallbackMessages(message: Message): LLMMessage[] {
    return [
      { role: 'system', content: `You are ${this.config.identity.name}.\n\n${this.config.identity.personality}` },
      { role: 'user', content: message.content },
    ];
  }
}
