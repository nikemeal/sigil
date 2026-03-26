/**
 * Context Trimmer
 *
 * Adjusts how much context is sent to the LLM based on request type.
 * Cheaper models get less context (fewer messages, fewer tools).
 * This is the main cost optimisation — most messages don't need
 * full history and every tool definition.
 *
 * Trimming rules:
 *   chat:     identity + profile, last 5 messages, no tools
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
  maxTools: number;          // 0 = no limit
}

/** Trimming rules per request type */
const TRIM_RULES: Record<RequestType, TrimConfig> = {
  chat: {
    maxHistory: 5,
    includeMemories: false,
    includeTools: false,
    maxTools: 0,
  },
  question: {
    maxHistory: 5,
    includeMemories: true,
    includeTools: true,
    maxTools: 0,
  },
  tool: {
    maxHistory: 10,
    includeMemories: true,
    includeTools: true,
    maxTools: 5,
  },
  complex: {
    maxHistory: 20,
    includeMemories: true,
    includeTools: true,
    maxTools: 0,        // no limit
  },
  background: {
    maxHistory: 10,
    includeMemories: true,
    includeTools: true,
    maxTools: 0,
  },
};

/** Get the trim config for a request type */
export function getTrimConfig(type: RequestType): TrimConfig {
  return TRIM_RULES[type];
}

/**
 * Trim tool definitions based on request type.
 * For 'tool' requests, we could filter to relevant tools based on the message,
 * but for now we just limit the count.
 */
export function trimTools(tools: ToolDefinition[], config: TrimConfig): ToolDefinition[] {
  if (!config.includeTools) return [];
  if (config.maxTools === 0) return tools;
  return tools.slice(0, config.maxTools);
}
