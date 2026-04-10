/**
 * Override Reviewer
 *
 * After a git pull, scans local/ for agent-created overrides and compares
 * each one against the updated src/ file using a cheap LLM call.
 *
 * Decisions:
 *   (a) still valid  → keep, no event
 *   (b) stale        → delete override, emit update:override_removed
 *   (c) unclear      → keep, emit update:override_flagged
 *
 * If no src/ match exists (file was deleted/moved), the override is removed
 * automatically without an LLM call.
 */
import type { ProviderPool } from '../router/provider-pool.js';
import type { EventBus } from '../lib/event-bus.js';
export declare class OverrideReviewer {
    private readonly cwd;
    private readonly localDir;
    private readonly srcDir;
    constructor(cwd: string);
    review(bus: EventBus, pool: ProviderPool | null): Promise<void>;
    private scanLocal;
    private scanDir;
    /**
     * Find the src/ counterpart to a local/ file path.
     * Tries both .ts and .js extensions since local/ overrides may use .js
     * while src/ uses .ts.
     */
    private findSrcFile;
}
//# sourceMappingURL=override-reviewer.d.ts.map