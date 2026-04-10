/**
 * Update Tools
 *
 * Exposes update checking and applying as agent tools.
 * The agent can call check_for_updates to see if an update is available,
 * and apply_update to pull + rebuild + restart autonomously.
 */
import type { Tool } from '../types.js';
import type { EventBus } from '../lib/event-bus.js';
import type { UpdateChecker } from '../update/checker.js';
import type { Updater } from '../update/updater.js';
import type { ProviderPool } from '../router/provider-pool.js';
export declare function createUpdateTools(bus: EventBus, checker: UpdateChecker, updater: Updater, pool: ProviderPool): Tool[];
//# sourceMappingURL=update-tools.d.ts.map