/**
 * Health Tools
 *
 * system_health — check the health of all system components
 *
 * Auto-approved — safe read-only operation.
 */
import type { Tool } from '../types.js';
import type { HealthMonitor } from '../health/monitor.js';
/** Creates health tools bound to a health monitor instance */
export declare function createHealthTools(monitor: HealthMonitor): Tool[];
//# sourceMappingURL=health-tools.d.ts.map