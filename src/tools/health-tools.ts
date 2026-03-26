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
export function createHealthTools(monitor: HealthMonitor): Tool[] {
  return [
    {
      name: 'system_health',
      description: 'Check the health status of all system components (LLM providers, database, transports, disk, memory). Use when the user asks about system status, health, uptime, or if something seems broken.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      approval: 'auto',

      async execute(): Promise<string> {
        const results = await monitor.checkAll();

        if (results.length === 0) return 'No health checks available.';

        const unhealthy = results.filter((r) => r.status === 'unhealthy');
        const degraded = results.filter((r) => r.status === 'degraded');
        const healthy = results.filter((r) => r.status === 'healthy');

        const lines: string[] = ['System Health Check:'];

        if (unhealthy.length > 0) {
          lines.push('\nUNHEALTHY:');
          for (const r of unhealthy) lines.push(formatResult(r));
        }

        if (degraded.length > 0) {
          lines.push('\nDEGRADED:');
          for (const r of degraded) lines.push(formatResult(r));
        }

        if (healthy.length > 0) {
          lines.push('\nHEALTHY:');
          for (const r of healthy) lines.push(formatResult(r));
        }

        // Add transport status from state map
        const state = monitor.getStatus();
        const transportEntries = [...state.entries()].filter(([k]) => k.startsWith('transport:'));
        if (transportEntries.length > 0) {
          lines.push('\nTRANSPORTS:');
          for (const [name, status] of transportEntries) {
            lines.push(`- ${name}: ${status}`);
          }
        }

        return lines.join('\n');
      },
    },
  ];
}

function formatResult(r: { component: string; message?: string; latencyMs?: number }): string {
  const latency = r.latencyMs !== undefined ? ` (${r.latencyMs}ms)` : '';
  const detail = r.message ? ` — ${r.message}` : '';
  return `- ${r.component}${detail}${latency}`;
}
