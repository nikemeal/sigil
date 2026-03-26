/**
 * Health Check Functions
 *
 * Pure functions that probe individual components and return results.
 * No side effects — the monitor handles alerting and state tracking.
 */

import { statfsSync } from 'node:fs';
import { freemem, totalmem } from 'node:os';
import { dirname } from 'node:path';
import type Database from 'better-sqlite3';
import type { HealthCheckResult } from '../types.js';
import type { ProviderPool } from '../router/provider-pool.js';

const PROVIDER_TIMEOUT_MS = 10_000;
const DISK_DEGRADED_BYTES = 500 * 1024 * 1024;   // 500MB
const DISK_UNHEALTHY_BYTES = 100 * 1024 * 1024;   // 100MB
const MEM_DEGRADED_RATIO = 0.10;   // 10% free
const MEM_UNHEALTHY_RATIO = 0.05;  // 5% free

/** Check all LLM providers in the pool concurrently */
export async function checkProviders(pool: ProviderPool): Promise<HealthCheckResult[]> {
  const names = pool.getModelNames();
  if (names.length === 0) return [];

  const checks = names.map(async (name): Promise<HealthCheckResult> => {
    const start = Date.now();
    const provider = pool.getProviderByName(name);

    if (!provider) {
      return {
        component: `provider:${name}`,
        status: 'unhealthy',
        message: 'Provider not found in pool',
        checkedAt: new Date(),
      };
    }

    try {
      const available = await Promise.race([
        provider.isAvailable(),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), PROVIDER_TIMEOUT_MS)),
      ]);

      return {
        component: `provider:${name}`,
        status: available ? 'healthy' : 'unhealthy',
        message: available ? undefined : 'Provider unreachable or timed out',
        latencyMs: Date.now() - start,
        checkedAt: new Date(),
      };
    } catch (err) {
      return {
        component: `provider:${name}`,
        status: 'unhealthy',
        message: (err as Error).message,
        latencyMs: Date.now() - start,
        checkedAt: new Date(),
      };
    }
  });

  const results = await Promise.allSettled(checks);
  return results.map((r) =>
    r.status === 'fulfilled'
      ? r.value
      : { component: 'provider:unknown', status: 'unhealthy' as const, message: 'Check failed', checkedAt: new Date() },
  );
}

/** Check database connectivity */
export function checkDatabase(db: Database.Database): HealthCheckResult {
  const start = Date.now();
  try {
    db.prepare('SELECT 1').get();
    return {
      component: 'database',
      status: 'healthy',
      latencyMs: Date.now() - start,
      checkedAt: new Date(),
    };
  } catch (err) {
    return {
      component: 'database',
      status: 'unhealthy',
      message: (err as Error).message,
      latencyMs: Date.now() - start,
      checkedAt: new Date(),
    };
  }
}

/** Check disk space on the volume containing the database */
export function checkDiskSpace(dbPath: string): HealthCheckResult {
  try {
    const stats = statfsSync(dirname(dbPath));
    const freeBytes = stats.bsize * stats.bavail;
    const freeMB = Math.round(freeBytes / (1024 * 1024));

    let status: HealthCheckResult['status'] = 'healthy';
    if (freeBytes < DISK_UNHEALTHY_BYTES) status = 'unhealthy';
    else if (freeBytes < DISK_DEGRADED_BYTES) status = 'degraded';

    return {
      component: 'system:disk',
      status,
      message: `${freeMB}MB free`,
      checkedAt: new Date(),
    };
  } catch {
    return {
      component: 'system:disk',
      status: 'unknown',
      message: 'Could not check disk space',
      checkedAt: new Date(),
    };
  }
}

/** Check system memory */
export function checkSystemMemory(): HealthCheckResult {
  const free = freemem();
  const total = totalmem();
  const ratio = free / total;
  const freeMB = Math.round(free / (1024 * 1024));

  let status: HealthCheckResult['status'] = 'healthy';
  if (ratio < MEM_UNHEALTHY_RATIO) status = 'unhealthy';
  else if (ratio < MEM_DEGRADED_RATIO) status = 'degraded';

  return {
    component: 'system:memory',
    status,
    message: `${freeMB}MB free (${Math.round(ratio * 100)}%)`,
    checkedAt: new Date(),
  };
}
