/**
 * Task Planner
 *
 * Uses a cheap/fast model to decompose a complex request into steps.
 * Each step gets a recommended model tier. The runner then resolves
 * tiers to actual models via the router.
 *
 * Single-model fallback: if only one model is configured, skip planning
 * and create a single step with the full request.
 */
import type { SigilConfig } from '../types.js';
import { ProviderPool } from '../router/provider-pool.js';
export interface PlannedStep {
    description: string;
    tier: string;
}
export declare class Planner {
    private config;
    private pool;
    constructor(config: SigilConfig, pool: ProviderPool);
    /**
     * Break a complex request into steps with model tier assignments.
     * Returns a single step if only one model is available.
     */
    plan(message: string): Promise<PlannedStep[]>;
    private findCheapestModel;
    private callPlanner;
    /**
     * Detect when the planner over-decomposes a simple request into
     * multiple steps that are effectively the same task.
     */
    private stepsLookRedundant;
}
//# sourceMappingURL=planner.d.ts.map