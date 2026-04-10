/**
 * Health Check Functions
 *
 * Pure functions that probe individual components and return results.
 * No side effects — the monitor handles alerting and state tracking.
 */
import type Database from 'better-sqlite3';
import type { HealthCheckResult } from '../types.js';
import type { ProviderPool } from '../router/provider-pool.js';
/** Check all LLM providers in the pool concurrently */
export declare function checkProviders(pool: ProviderPool): Promise<HealthCheckResult[]>;
/** Check database connectivity */
export declare function checkDatabase(db: Database.Database): HealthCheckResult;
/** Check disk space on the volume containing the database */
export declare function checkDiskSpace(dbPath: string): HealthCheckResult;
/** Check system memory */
export declare function checkSystemMemory(): HealthCheckResult;
//# sourceMappingURL=checks.d.ts.map