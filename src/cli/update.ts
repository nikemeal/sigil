/**
 * Update CLI Handler
 *
 * Handles `node dist/index.js update` and `node dist/index.js update --check`.
 *
 * update --check  → fetch + compare, print status, exit
 * update          → fetch + compare, apply if available, restart
 */

import { loadEnv } from '../lib/env.js';
import { loadConfig } from '../gateway/config.js';
import { ProviderPool } from '../router/provider-pool.js';
import { EventBus } from '../lib/event-bus.js';
import { UpdateChecker } from '../update/checker.js';
import { Updater } from '../update/updater.js';

export async function runUpdateCli(checkOnly: boolean): Promise<void> {
  loadEnv();
  const config = loadConfig();
  const cwd = process.cwd();
  const remoteBranch = config.update.remoteBranch;

  const checker = new UpdateChecker(remoteBranch);

  console.log('[Sigil] Checking for updates...');

  let result;
  try {
    result = checker.check();
  } catch (err) {
    console.error('[Sigil] Update check failed:', (err as Error).message);
    process.exit(1);
  }

  if (!result.hasUpdate) {
    console.log('[Sigil] Already up to date.');
    process.exit(0);
  }

  console.log(
    `[Sigil] Update available: ${result.commitCount} commit(s) behind ` +
    `(${result.currentSha.slice(0, 7)} → ${result.latestSha.slice(0, 7)})`,
  );

  if (checkOnly) {
    process.exit(0);
  }

  console.log('[Sigil] Applying update...');

  const bus = new EventBus();
  const pool = new ProviderPool(config);
  const updater = new Updater(cwd, remoteBranch);

  // Wire audit logging so update progress is visible in CLI
  bus.on('update:override_removed', ({ path, reason }) => {
    console.log(`[Updater] Override removed: ${path} — ${reason}`);
  });
  bus.on('update:override_flagged', ({ path, reason }) => {
    console.warn(`[Updater] Override flagged for review: ${path} — ${reason}`);
  });

  try {
    await updater.apply(bus, pool);
  } catch (err) {
    console.error('[Sigil] Update failed:', (err as Error).message);
    process.exit(1);
  }
}
