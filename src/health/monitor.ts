import type { Tool, ToolResult } from '../gateway/types.js';
import type { OllamaProvider } from '../agent/providers/ollama.js';

// ── Types ───────────────────────────────────────────────────────

export type ComponentStatus = 'healthy' | 'degraded' | 'down' | 'unchecked';

export interface HealthResult {
  component: string;
  status: ComponentStatus;
  message: string;
  latencyMs?: number;
  lastChecked: Date;
}

export interface HealthReport {
  overall: ComponentStatus;
  components: HealthResult[];
  timestamp: Date;
  uptimeSeconds: number;
}

type CheckFn = () => Promise<HealthResult>;
type HealFn = () => Promise<boolean>;

interface MonitoredComponent {
  name: string;
  check: CheckFn;
  heal?: HealFn;
  lastResult?: HealthResult;
}

// ── HealthMonitor ───────────────────────────────────────────────

/**
 * Central health monitoring system for Sigil.
 *
 * Components register check functions (and optional heal functions).
 * The monitor can be triggered:
 *  - On a schedule (default: every 60 minutes)
 *  - On demand via the health_check tool
 *  - By the agent when a user reports a problem
 *
 * When a component is detected as down, the monitor:
 *  1. Logs the failure
 *  2. Attempts to heal if a heal function is registered
 *  3. Re-checks after healing
 *  4. Notifies via callback if still down after healing
 */
export class HealthMonitor {
  private components = new Map<string, MonitoredComponent>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private startTime = Date.now();
  private onAlert?: (report: HealthReport) => void;

  constructor(onAlert?: (report: HealthReport) => void) {
    this.onAlert = onAlert;
  }

  /** Register a component to monitor */
  register(name: string, check: CheckFn, heal?: HealFn): void {
    this.components.set(name, { name, check, heal });
  }

  /** Run all health checks */
  async checkAll(): Promise<HealthReport> {
    const results: HealthResult[] = [];

    for (const [, component] of this.components) {
      try {
        const result = await component.check();
        component.lastResult = result;

        // If down and we have a heal function, try to fix it
        if (result.status === 'down' && component.heal) {
          console.log(`[health] ${component.name} is down, attempting heal...`);
          const healed = await component.heal();

          if (healed) {
            // Re-check after healing
            const recheck = await component.check();
            component.lastResult = recheck;
            results.push({
              ...recheck,
              message: `${recheck.message} (auto-healed from: ${result.message})`,
            });
            continue;
          }
        }

        results.push(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const failResult: HealthResult = {
          component: component.name,
          status: 'down',
          message: `Check failed: ${message}`,
          lastChecked: new Date(),
        };
        component.lastResult = failResult;
        results.push(failResult);
      }
    }

    const overall = this.deriveOverall(results);
    const report: HealthReport = {
      overall,
      components: results,
      timestamp: new Date(),
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
    };

    // Alert if anything is down
    if (overall === 'down' || overall === 'degraded') {
      this.onAlert?.(report);
    }

    return report;
  }

  /** Check a single component by name */
  async checkOne(name: string): Promise<HealthResult | null> {
    const component = this.components.get(name);
    if (!component) return null;

    const result = await component.check();
    component.lastResult = result;

    // Try healing if down
    if (result.status === 'down' && component.heal) {
      console.log(`[health] ${name} is down, attempting heal...`);
      const healed = await component.heal();
      if (healed) {
        const recheck = await component.check();
        component.lastResult = recheck;
        return {
          ...recheck,
          message: `${recheck.message} (auto-healed from: ${result.message})`,
        };
      }
    }

    return result;
  }

  /** Get the last known status without re-checking */
  getLastReport(): HealthReport {
    const results = Array.from(this.components.values())
      .map(c => c.lastResult ?? {
        component: c.name,
        status: 'unchecked' as ComponentStatus,
        message: 'Not yet checked',
        lastChecked: new Date(),
      });

    return {
      overall: this.deriveOverall(results),
      components: results,
      timestamp: new Date(),
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  /** Start periodic health checks */
  startSchedule(intervalMs = 60 * 60 * 1000): void {
    // Run immediately on start
    this.checkAll().then(report => {
      this.logReport(report);
    });

    this.interval = setInterval(async () => {
      const report = await this.checkAll();
      this.logReport(report);
    }, intervalMs);

    const mins = Math.round(intervalMs / 60_000);
    console.log(`[health] Scheduled checks every ${mins} minutes`);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private deriveOverall(results: HealthResult[]): ComponentStatus {
    if (results.some(r => r.status === 'down')) return 'degraded';
    if (results.some(r => r.status === 'degraded')) return 'degraded';
    if (results.every(r => r.status === 'healthy')) return 'healthy';
    return 'unchecked';
  }

  private logReport(report: HealthReport): void {
    const icon = report.overall === 'healthy' ? '✓' : report.overall === 'degraded' ? '⚠' : '✗';
    const details = report.components
      .map(c => `${c.component}=${c.status}`)
      .join(', ');
    console.log(`[health] ${icon} ${report.overall} (${details})`);
  }
}

// ── Built-in checks ─────────────────────────────────────────────

/** Check if Ollama is reachable and the model is loaded */
export function ollamaCheck(provider: OllamaProvider): CheckFn {
  return async () => {
    const start = Date.now();
    const result = await provider.healthCheck();
    const latency = Date.now() - start;

    return {
      component: 'ollama',
      status: result.ok ? 'healthy' : 'down',
      message: result.ok ? `Connected (${latency}ms)` : result.error!,
      latencyMs: latency,
      lastChecked: new Date(),
    };
  };
}

/** Check if the Anthropic API is reachable */
export function anthropicCheck(apiKey: string): CheckFn {
  return async () => {
    const start = Date.now();
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const latency = Date.now() - start;

      // 200 = working, 401 = bad key, 429 = rate limited but reachable
      if (res.status === 200 || res.status === 429) {
        return {
          component: 'anthropic',
          status: 'healthy',
          message: `API reachable (${latency}ms)`,
          latencyMs: latency,
          lastChecked: new Date(),
        };
      }

      if (res.status === 401) {
        return {
          component: 'anthropic',
          status: 'down',
          message: 'Invalid API key',
          latencyMs: latency,
          lastChecked: new Date(),
        };
      }

      return {
        component: 'anthropic',
        status: 'degraded',
        message: `Unexpected status: ${res.status}`,
        latencyMs: latency,
        lastChecked: new Date(),
      };
    } catch (err) {
      const latency = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      return {
        component: 'anthropic',
        status: 'down',
        message: `Unreachable: ${message}`,
        latencyMs: latency,
        lastChecked: new Date(),
      };
    }
  };
}

/** Check Telegram bot connectivity */
export function telegramCheck(tokenEnv: string): CheckFn {
  return async () => {
    const token = process.env[tokenEnv];
    if (!token) {
      return {
        component: 'telegram',
        status: 'down',
        message: `No token (${tokenEnv} not set)`,
        lastChecked: new Date(),
      };
    }

    const start = Date.now();
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
        signal: AbortSignal.timeout(10_000),
      });
      const latency = Date.now() - start;

      if (res.ok) {
        const data = await res.json() as { result?: { username?: string } };
        return {
          component: 'telegram',
          status: 'healthy',
          message: `Bot @${data.result?.username} connected (${latency}ms)`,
          latencyMs: latency,
          lastChecked: new Date(),
        };
      }

      return {
        component: 'telegram',
        status: 'down',
        message: `API returned ${res.status}`,
        latencyMs: latency,
        lastChecked: new Date(),
      };
    } catch (err) {
      const latency = Date.now() - start;
      return {
        component: 'telegram',
        status: 'down',
        message: `Unreachable: ${err instanceof Error ? err.message : err}`,
        latencyMs: latency,
        lastChecked: new Date(),
      };
    }
  };
}

/** Check system resources (memory, disk) */
export function systemCheck(): CheckFn {
  return async () => {
    const { execSync } = await import('node:child_process');

    try {
      // Memory usage
      const memInfo = process.memoryUsage();
      const heapMB = Math.round(memInfo.heapUsed / 1024 / 1024);
      const rssMB = Math.round(memInfo.rss / 1024 / 1024);

      // Disk usage on data directory
      let diskMsg = '';
      try {
        const df = execSync("df -h --output=pcent . | tail -1", { encoding: 'utf-8' }).trim();
        const pct = parseInt(df);
        diskMsg = `disk: ${df}`;
        if (pct > 90) {
          return {
            component: 'system',
            status: 'degraded',
            message: `Low disk space (${df}). Memory: heap=${heapMB}MB, rss=${rssMB}MB`,
            lastChecked: new Date(),
          };
        }
      } catch {
        diskMsg = 'disk: unknown';
      }

      return {
        component: 'system',
        status: 'healthy',
        message: `heap=${heapMB}MB, rss=${rssMB}MB, ${diskMsg}`,
        lastChecked: new Date(),
      };
    } catch (err) {
      return {
        component: 'system',
        status: 'degraded',
        message: `Check error: ${err instanceof Error ? err.message : err}`,
        lastChecked: new Date(),
      };
    }
  };
}

/** Check SQLite database integrity */
export function databaseCheck(dbPath: string): CheckFn {
  return async () => {
    try {
      const Database = (await import('better-sqlite3')).default;
      const start = Date.now();
      const db = new Database(dbPath, { readonly: true });
      const result = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
      const latency = Date.now() - start;
      db.close();

      const ok = result.integrity_check === 'ok';
      return {
        component: 'database',
        status: ok ? 'healthy' : 'degraded',
        message: ok ? `Integrity OK (${latency}ms)` : `Integrity issue: ${result.integrity_check}`,
        latencyMs: latency,
        lastChecked: new Date(),
      };
    } catch (err) {
      return {
        component: 'database',
        status: 'down',
        message: `Cannot open: ${err instanceof Error ? err.message : err}`,
        lastChecked: new Date(),
      };
    }
  };
}

// ── Health check tool (exposed to the agent) ─────────────────────

export function createHealthTool(monitor: HealthMonitor): Tool {
  return {
    name: 'health_check',
    description: `Run health checks on Sigil's systems. Use this when:
- The user reports something isn't working ("I'm not getting Telegram messages")
- You want to verify all systems are operational
- You notice unusual errors or timeouts

Can check all systems or a specific component.`,
    parameters: {
      type: 'object',
      properties: {
        component: {
          type: 'string',
          description: 'Specific component to check (ollama, anthropic, telegram, system, database), or omit to check all',
        },
      },
    },
    async execute(params): Promise<ToolResult> {
      const component = params.component as string | undefined;

      if (component) {
        const result = await monitor.checkOne(component);
        if (!result) {
          return { content: `Unknown component: "${component}". Available: ollama, anthropic, telegram, system, database` };
        }

        const icon = result.status === 'healthy' ? '✓' : result.status === 'degraded' ? '⚠' : '✗';
        return {
          content: `${icon} ${result.component}: ${result.status}\n${result.message}${result.latencyMs ? ` (${result.latencyMs}ms)` : ''}`,
        };
      }

      // Check all
      const report = await monitor.checkAll();
      const uptime = formatUptime(report.uptimeSeconds);

      const lines = report.components.map(r => {
        const icon = r.status === 'healthy' ? '✓' : r.status === 'degraded' ? '⚠' : '✗';
        return `${icon} ${r.component}: ${r.status} — ${r.message}`;
      });

      return {
        content: `Overall: ${report.overall} | Uptime: ${uptime}\n\n${lines.join('\n')}`,
      };
    },
  };
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
