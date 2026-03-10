import { randomUUID } from 'node:crypto';
import type {
  Message, Response, Action, LLMProvider,
  CompletionResponse, ToolCall,
} from '../gateway/types.js';
import { ContextEngine } from '../context/engine.js';
import { ToolRegistry } from '../tools/registry.js';

const MAX_TOOL_ROUNDS = 10;

export class Agent {
  private llm: LLMProvider;
  private context: ContextEngine;
  private tools: ToolRegistry;

  constructor(llm: LLMProvider, context: ContextEngine, tools: ToolRegistry) {
    this.llm = llm;
    this.context = context;
    this.tools = tools;
  }

  async process(message: Message): Promise<Response> {
    const startTime = Date.now();
    const actions: Action[] = [];

    // 1. Assemble context
    const ctx = await this.context.assemble(message);

    // 2. Agentic loop — keep going until the model stops calling tools
    let completion: CompletionResponse;
    let round = 0;

    // Build a running message history for tool results
    const messages = [...ctx.messages];

    while (round < MAX_TOOL_ROUNDS) {
      round++;

      completion = await this.llm.complete({
        system: ctx.system,
        messages,
        tools: this.tools.getSchemas(),
      });

      // If no tool calls, we're done
      if (!completion.toolCalls || completion.toolCalls.length === 0) {
        break;
      }

      // Execute each tool call
      const toolResultParts: string[] = [];

      for (const tc of completion.toolCalls) {
        const toolStart = Date.now();
        // Inject message context so task tools know where to reply
        const enrichedInput = {
          ...tc.input,
          _replyTransport: message.source,
          _replyThreadId: message.threadId ?? message.source,
        };
        const result = await this.tools.execute(tc.name, enrichedInput);
        const duration = Date.now() - toolStart;

        actions.push({
          tool: tc.name,
          input: tc.input,
          output: result.content.slice(0, 500), // truncate for response
          durationMs: duration,
        });

        toolResultParts.push(
          `[Tool: ${tc.name}]\n${result.isError ? 'ERROR: ' : ''}${result.content}`
        );
      }

      // Add assistant message (with tool calls) and tool results to history
      // For simplicity, we serialize tool interactions as text messages
      const assistantMsg = [
        completion.content,
        ...completion.toolCalls.map(
          tc => `[Calling tool: ${tc.name}(${JSON.stringify(tc.input)})]`
        ),
      ]
        .filter(Boolean)
        .join('\n');

      messages.push({ role: 'assistant', content: assistantMsg });
      messages.push({ role: 'user', content: `Tool results:\n${toolResultParts.join('\n\n')}` });
    }

    // 3. Store the response
    const threadId = message.threadId ?? message.source;
    this.context.storeResponse(threadId, completion!.content);

    // 4. Log usage
    if (completion!.usage) {
      const { inputTokens, outputTokens } = completion!.usage;
      const totalMs = Date.now() - startTime;
      console.log(
        `[agent] ${inputTokens} in / ${outputTokens} out / ${round} round(s) / ${totalMs}ms / ${actions.length} tool call(s)`
      );
    }

    return {
      id: randomUUID(),
      replyTo: message.id,
      content: completion!.content,
      actions: actions.length > 0 ? actions : undefined,
      timestamp: new Date(),
    };
  }
}
