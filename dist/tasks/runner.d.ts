/**
 * Task Runner
 *
 * Executes a task's steps sequentially. Each step is routed to its
 * assigned model, with context built from the task description and
 * previous step results. Emits events throughout for transport
 * notifications.
 */
import type { SigilConfig, Task } from '../types.js';
import { EventBus } from '../lib/event-bus.js';
import { ProviderPool } from '../router/provider-pool.js';
import { ContextEngine } from '../context/engine.js';
import { ToolRegistry } from '../tools/registry.js';
import { CostTracker } from '../router/cost-tracker.js';
import { TaskStore } from './store.js';
import { Planner } from './planner.js';
export declare class TaskRunner {
    private bus;
    private pool;
    private context;
    private tools;
    private costTracker;
    private store;
    private planner;
    private config;
    constructor(bus: EventBus, pool: ProviderPool, context: ContextEngine, tools: ToolRegistry | null, costTracker: CostTracker | null, store: TaskStore, planner: Planner, config: SigilConfig);
    /** Execute a task: plan steps, run each, collect results */
    run(task: Task): Promise<void>;
    /** Execute a single step */
    private executeStep;
    /** Build a system prompt for a task step */
    private buildStepPrompt;
    /** Find the best available model for a given tier */
    private resolveModel;
}
//# sourceMappingURL=runner.d.ts.map