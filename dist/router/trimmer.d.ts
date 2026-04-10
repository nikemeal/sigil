/**
 * Context Trimmer
 *
 * Adjusts how much context is sent to the LLM based on request type.
 * Cheaper models get less context (fewer messages, fewer tools).
 * This is the main cost optimisation — most messages don't need
 * full history and every tool definition.
 *
 * Trimming rules:
 *   chat:     identity + profile, last 5 messages, all tools
 *   question: identity + profile, memories, last 5 messages, all tools
 *   tool:     full system prompt, memories, last 10 messages, relevant tools
 *   complex:  full system prompt, all memories, full history, all tools
 */
import type { RequestType } from './classifier.js';
import type { ToolDefinition } from '../types.js';
export interface TrimConfig {
    maxHistory: number;
    includeMemories: boolean;
    includeTools: boolean;
    maxTools: number;
}
/** Get the trim config for a request type */
export declare function getTrimConfig(type: RequestType): TrimConfig;
/**
 * Trim tool definitions based on request type.
 * For 'tool' requests, we could filter to relevant tools based on the message,
 * but for now we just limit the count.
 */
export declare function trimTools(tools: ToolDefinition[], config: TrimConfig): ToolDefinition[];
//# sourceMappingURL=trimmer.d.ts.map