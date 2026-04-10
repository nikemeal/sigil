/**
 * Updater
 *
 * Applies a git update: pulls from remote (which includes pre-compiled dist/),
 * installs dependencies if package.json changed, runs the OverrideReviewer,
 * then self-restarts the process using spawn + exit.
 *
 * No TypeScript compilation step — dist/ is committed to the repo so git pull
 * delivers updated JS directly.
 *
 * Emits update:applying, update:complete, and update:failed events.
 * Safe to call concurrently — applying flag prevents double-runs.
 */
import type { EventBus } from '../lib/event-bus.js';
import type { ProviderPool } from '../router/provider-pool.js';
export declare class Updater {
    private readonly cwd;
    private readonly remoteBranch;
    private applying;
    constructor(cwd: string, remoteBranch: string);
    apply(bus: EventBus, pool: ProviderPool): Promise<void>;
    private readFile;
}
//# sourceMappingURL=updater.d.ts.map