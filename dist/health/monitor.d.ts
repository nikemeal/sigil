/**
 * Health Monitor
 *
 * Periodic + event-driven health checks for all system components.
 * Alerts on state transitions only (healthy→unhealthy, not every check).
 * Emits reconnect requests for transports that go down.
 */
import type Database from 'better-sqlite3';
import type { ComponentStatus, HealthCheckResult } from '../types.js';
import type { EventBus } from '../lib/event-bus.js';
import type { ProviderPool } from '../router/provider-pool.js';
export declare class HealthMonitor {
    private bus;
    private pool;
    private db;
    private dbPath;
    private intervalMs;
    private timer;
    private running;
    private componentState;
    private lastAlertTime;
    private lastResults;
    private unsubscribers;
    constructor(bus: EventBus, pool: ProviderPool, db: Database.Database, dbPath: string, intervalMs?: number);
    start(): void;
    stop(): void;
    /** Run all health checks and process results */
    checkAll(): Promise<HealthCheckResult[]>;
    /** Get current component state map */
    getStatus(): Map<string, ComponentStatus>;
    /** Get results from last check */
    getLastResults(): HealthCheckResult[];
    /** Update component state and alert on transitions */
    private updateState;
}
//# sourceMappingURL=monitor.d.ts.map