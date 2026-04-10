/**
 * Health Monitor
 *
 * Periodic + event-driven health checks for all system components.
 * Alerts on state transitions only (healthy→unhealthy, not every check).
 * Emits reconnect requests for transports that go down.
 */
import { checkProviders, checkDatabase, checkDiskSpace, checkSystemMemory } from './checks.js';
const INITIAL_DELAY_MS = 5_000;
const ALERT_COOLDOWN_MS = 300_000; // 5 minutes
export class HealthMonitor {
    bus;
    pool;
    db;
    dbPath;
    intervalMs;
    timer = null;
    running = false;
    componentState = new Map();
    lastAlertTime = new Map();
    lastResults = [];
    unsubscribers = [];
    constructor(bus, pool, db, dbPath, intervalMs = 60_000) {
        this.bus = bus;
        this.pool = pool;
        this.db = db;
        this.dbPath = dbPath;
        this.intervalMs = intervalMs;
    }
    start() {
        if (this.running)
            return;
        this.running = true;
        // Subscribe to transport events for immediate detection
        this.unsubscribers.push(this.bus.on('transport:connected', ({ type, id }) => {
            this.updateState(`transport:${type}`, 'healthy', `Connected (${id})`);
        }));
        this.unsubscribers.push(this.bus.on('transport:disconnected', ({ type }) => {
            this.updateState(`transport:${type}`, 'unhealthy', 'Disconnected');
            // Request reconnect for Telegram after a brief delay
            if (type === 'telegram') {
                setTimeout(() => {
                    if (!this.running)
                        return;
                    const current = this.componentState.get('transport:telegram');
                    if (current === 'unhealthy') {
                        this.bus.emit('health:reconnect_requested', { transport: 'telegram' });
                    }
                }, 5_000);
            }
        }));
        this.unsubscribers.push(this.bus.on('system:error', ({ component }) => {
            if (component) {
                this.updateState(component, 'unhealthy', 'System error reported');
            }
        }));
        // Initial check after a delay (let system stabilize)
        setTimeout(() => {
            if (!this.running)
                return;
            this.checkAll().catch((err) => console.error('[Health] Initial check failed:', err.message));
        }, INITIAL_DELAY_MS);
        // Periodic checks
        this.timer = setInterval(() => {
            if (!this.running)
                return;
            this.checkAll().catch((err) => console.error('[Health] Periodic check failed:', err.message));
        }, this.intervalMs);
        console.log(`[Health] Monitor started (interval: ${this.intervalMs / 1000}s)`);
    }
    stop() {
        this.running = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        for (const unsub of this.unsubscribers)
            unsub();
        this.unsubscribers = [];
        console.log('[Health] Monitor stopped');
    }
    /** Run all health checks and process results */
    async checkAll() {
        const results = [];
        // Run checks concurrently where possible
        const [providerResults] = await Promise.all([
            checkProviders(this.pool),
        ]);
        results.push(...providerResults);
        results.push(checkDatabase(this.db));
        results.push(checkDiskSpace(this.dbPath));
        results.push(checkSystemMemory());
        // Process state transitions
        for (const result of results) {
            this.updateState(result.component, result.status, result.message);
        }
        this.lastResults = results;
        this.bus.emit('health:check_complete', { results, timestamp: new Date() });
        // Log summary
        const unhealthy = results.filter((r) => r.status === 'unhealthy');
        const degraded = results.filter((r) => r.status === 'degraded');
        if (unhealthy.length > 0 || degraded.length > 0) {
            console.log(`[Health] ${unhealthy.length} unhealthy, ${degraded.length} degraded, ` +
                `${results.length - unhealthy.length - degraded.length} healthy`);
        }
        return results;
    }
    /** Get current component state map */
    getStatus() {
        return new Map(this.componentState);
    }
    /** Get results from last check */
    getLastResults() {
        return [...this.lastResults];
    }
    /** Update component state and alert on transitions */
    updateState(component, newStatus, message) {
        const previous = this.componentState.get(component) ?? 'unknown';
        this.componentState.set(component, newStatus);
        // No alert if state hasn't changed
        if (previous === newStatus)
            return;
        // Check cooldown
        const now = Date.now();
        const lastAlert = this.lastAlertTime.get(component) ?? 0;
        if (now - lastAlert < ALERT_COOLDOWN_MS)
            return;
        // Determine severity based on transition
        let severity;
        if (newStatus === 'healthy') {
            severity = 'info';
        }
        else if (newStatus === 'degraded') {
            severity = 'warn';
        }
        else {
            severity = 'error';
        }
        // Format alert message
        const direction = newStatus === 'healthy' ? 'recovered' : newStatus;
        const detail = message ? `: ${message}` : '';
        const content = `${component} ${direction}${detail}`;
        console.log(`[Health] ${severity.toUpperCase()}: ${content}`);
        this.bus.emit('broadcast:notification', { content, severity });
        this.lastAlertTime.set(component, now);
    }
}
//# sourceMappingURL=monitor.js.map