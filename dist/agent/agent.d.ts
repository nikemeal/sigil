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
import type { Message, Response, SigilConfig } from '../types.js';
import { EventBus } from '../lib/event-bus.js';
import { ContextEngine } from '../context/engine.js';
import { ToolRegistry } from '../tools/registry.js';
import { ProviderPool } from '../router/provider-pool.js';
import { CostTracker } from '../router/cost-tracker.js';
export declare class Agent {
    private config;
    private bus;
    private context;
    private tools;
    private router;
    private pool;
    private costTracker;
    private fallbackProvider;
    constructor(config: SigilConfig, bus: EventBus, pool: ProviderPool);
    setContext(context: ContextEngine): void;
    setTools(tools: ToolRegistry): void;
    setCostTracker(tracker: CostTracker): void;
    getContext(): ContextEngine | null;
    getTools(): ToolRegistry | null;
    /**
     * Process a message: route → trim → call LLM → track cost → respond.
     */
    process(message: Message): Promise<Response>;
    private buildResponse;
    private buildFallbackMessages;
}
//# sourceMappingURL=agent.d.ts.map