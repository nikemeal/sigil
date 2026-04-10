/**
 * Evaluator
 *
 * Automatically extracts reusable techniques from completed background tasks.
 * Listens on task:complete, fires a cheap LLM call to extract a technique,
 * and stores it in the TechniqueStore.
 *
 * Uses the cheapest available model to keep costs minimal.
 * Silently skips if extraction fails or yields nothing useful.
 */
import { EventBus } from '../lib/event-bus.js';
import { ProviderPool } from '../router/provider-pool.js';
import { TechniqueStore } from './store.js';
export declare class Evaluator {
    private bus;
    private pool;
    private store;
    constructor(bus: EventBus, pool: ProviderPool, store: TechniqueStore);
    private evaluate;
}
//# sourceMappingURL=evaluator.d.ts.map