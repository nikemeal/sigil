/**
 * Update Checker
 *
 * Checks whether a newer version of Sigil is available by comparing
 * the local HEAD to a remote tracking branch. Runs git fetch + rev-parse.
 *
 * Also provides parseDuration() for converting config strings like "24h"
 * to milliseconds.
 */
import type { UpdateCheckResult } from '../types.js';
import type { EventBus } from '../lib/event-bus.js';
/** Convert duration string ("24h", "30m", "7d") to milliseconds. */
export declare function parseDuration(s: string): number;
export declare class UpdateChecker {
    private readonly remoteBranch;
    private timer;
    private initialTimer;
    private running;
    constructor(remoteBranch: string);
    /**
     * Check whether an update is available.
     * Runs git fetch then compares HEAD to the remote tracking branch.
     * Throws if not in a git repository or git is unavailable.
     */
    check(): UpdateCheckResult;
    /**
     * Start scheduled checks. Waits INITIAL_DELAY_MS before the first check,
     * then checks every intervalMs. Emits update:available when an update is found.
     */
    start(bus: EventBus, intervalMs: number): void;
    stop(): void;
    private checkAndEmit;
}
//# sourceMappingURL=checker.d.ts.map