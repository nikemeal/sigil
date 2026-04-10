/**
 * Smart Router
 *
 * Picks the right model for each request based on:
 *   1. Complexity classification (chat/question/tool/complex)
 *   2. User overrides (/local, /cloud, /private)
 *   3. Model tier matching
 *   4. Availability
 *
 * Falls back gracefully: if the ideal model isn't available,
 * picks the next best option.
 */
import type { ModelConfig, SigilConfig } from '../types.js';
import { type Classification } from './classifier.js';
export interface RoutingDecision {
    model: ModelConfig;
    classification: Classification;
    cleanMessage: string;
    reason: string;
}
export declare class Router {
    private config;
    constructor(config: SigilConfig);
    /**
     * Route a message to the best model.
     * Returns the model config, classification, and cleaned message.
     */
    route(message: string): RoutingDecision;
    /**
     * Find the best model for a request type based on tier preference.
     */
    private findBestModel;
    /**
     * Resolve a user override to a model.
     *   /local   → find a model with cost 0 (local/free)
     *   /cloud   → find a model with cost > 0 (paid API)
     *   /private → same as /local (force local, nothing leaves network)
     */
    private resolveOverride;
}
//# sourceMappingURL=router.d.ts.map