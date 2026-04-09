/**
 * Updater
 *
 * Applies a git update: pulls from remote, installs dependencies if needed,
 * rebuilds the TypeScript project, runs the OverrideReviewer, then
 * self-restarts the process using spawn + exit.
 *
 * Emits update:applying, update:complete, and update:failed events.
 * Safe to call concurrently — applying flag prevents double-runs.
 */

import { execSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { EventBus } from '../lib/event-bus.js';
import type { ProviderPool } from '../router/provider-pool.js';
import { OverrideReviewer } from './override-reviewer.js';

export class Updater {
  private applying = false;

  constructor(
    private readonly cwd: string,
    private readonly remoteBranch: string,
  ) {}

  async apply(bus: EventBus, pool: ProviderPool): Promise<void> {
    if (this.applying) {
      console.log('[Updater] Update already in progress, skipping.');
      return;
    }
    this.applying = true;

    try {
      bus.emit('update:applying', {});

      const slashIndex = this.remoteBranch.indexOf('/');
      if (slashIndex === -1) {
        throw new Error(
          `Invalid remoteBranch format: "${this.remoteBranch}". Expected "remote/branch" (e.g. "origin/main").`,
        );
      }

      console.log(`[Updater] Applying update from ${this.remoteBranch}...`);

      const previousSha = execSync('git rev-parse HEAD', {
        encoding: 'utf-8',
        stdio: 'pipe',
        cwd: this.cwd,
      }).trim();

      // Record package.json content before pull to detect dependency changes
      const pkgBefore = this.readFile('package.json');

      // Split "origin/main" → remote="origin", branch="main"
      const remote = this.remoteBranch.slice(0, slashIndex);
      const branch = this.remoteBranch.slice(slashIndex + 1);

      execSync(`git pull ${remote} ${branch}`, { stdio: 'pipe', cwd: this.cwd });
      console.log('[Updater] git pull complete.');

      // Re-install dependencies only if package.json changed
      const pkgAfter = this.readFile('package.json');
      if (pkgBefore !== pkgAfter) {
        console.log('[Updater] package.json changed — running npm install...');
        execSync('npm install', { stdio: 'pipe', cwd: this.cwd });
        console.log('[Updater] npm install complete.');
      }

      // Always rebuild (TypeScript source changed)
      console.log('[Updater] Building...');
      execSync('npm run build', { stdio: 'pipe', cwd: this.cwd });
      console.log('[Updater] Build complete.');

      // Review local/ overrides against updated src/
      const reviewer = new OverrideReviewer(this.cwd);
      await reviewer.review(bus, pool);

      const newSha = execSync('git rev-parse HEAD', {
        encoding: 'utf-8',
        stdio: 'pipe',
        cwd: this.cwd,
      }).trim();

      bus.emit('update:complete', { previousSha, newSha });
      console.log(
        `[Updater] Update complete: ${previousSha.slice(0, 7)} → ${newSha.slice(0, 7)}. Restarting...`,
      );

      // Self-restart: spawn a detached copy of this process, then exit
      const child = spawn(process.execPath, process.argv.slice(1), {
        detached: true,
        stdio: 'inherit',
        cwd: this.cwd,
      });
      child.unref();
      process.exit(0);

    } catch (err) {
      this.applying = false;
      const error = (err as Error).message;
      bus.emit('update:failed', { error });
      console.error('[Updater] Update failed:', error);
      throw err;
    }
  }

  private readFile(filename: string): string {
    const filepath = join(this.cwd, filename);
    return existsSync(filepath) ? readFileSync(filepath, 'utf-8') : '';
  }
}
