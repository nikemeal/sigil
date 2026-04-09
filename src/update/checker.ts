/**
 * Update Checker
 *
 * Checks whether a newer version of Sigil is available by comparing
 * the local HEAD to a remote tracking branch. Runs git fetch + rev-parse.
 *
 * Also provides parseDuration() for converting config strings like "24h"
 * to milliseconds.
 */

import { execSync } from 'node:child_process';
import type { UpdateCheckResult } from '../types.js';
import type { EventBus } from '../lib/event-bus.js';

const INITIAL_DELAY_MS = 5 * 60 * 1000; // 5 minutes

/** Convert duration string ("24h", "30m", "7d") to milliseconds. */
export function parseDuration(s: string): number {
  const match = s.match(/^(\d+)(h|m|d)$/);
  if (!match) {
    throw new Error(`Invalid duration: "${s}". Use format like "24h", "30m", "7d".`);
  }
  const n = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === 'h') return n * 60 * 60 * 1000;
  if (unit === 'm') return n * 60 * 1000;
  return n * 24 * 60 * 60 * 1000; // 'd'
}

export class UpdateChecker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly remoteBranch: string) {}

  /**
   * Check whether an update is available.
   * Runs git fetch then compares HEAD to the remote tracking branch.
   * Throws if not in a git repository or git is unavailable.
   */
  check(): UpdateCheckResult {
    try {
      execSync('git fetch origin', { stdio: 'pipe' });
    } catch (err) {
      throw new Error(`git fetch failed: ${(err as Error).message}`);
    }

    const currentSha = execSync('git rev-parse HEAD', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    const latestSha = execSync(`git rev-parse ${this.remoteBranch}`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();

    if (currentSha === latestSha) {
      return { hasUpdate: false, currentSha, latestSha, commitCount: 0 };
    }

    const countStr = execSync(`git rev-list HEAD..${this.remoteBranch} --count`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();

    return {
      hasUpdate: true,
      currentSha,
      latestSha,
      commitCount: parseInt(countStr, 10),
    };
  }

  /**
   * Start scheduled checks. Waits INITIAL_DELAY_MS before the first check,
   * then checks every intervalMs. Emits update:available when an update is found.
   */
  start(bus: EventBus, intervalMs: number): void {
    this.initialTimer = setTimeout(() => {
      void this.checkAndEmit(bus);
      this.timer = setInterval(() => {
        void this.checkAndEmit(bus);
      }, intervalMs);
    }, INITIAL_DELAY_MS);
  }

  stop(): void {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async checkAndEmit(bus: EventBus): Promise<void> {
    try {
      const result = this.check();
      if (result.hasUpdate) {
        bus.emit('update:available', {
          currentSha: result.currentSha,
          latestSha: result.latestSha,
          commitCount: result.commitCount,
        });
      }
    } catch (err) {
      console.warn('[Updater] Scheduled check failed:', (err as Error).message);
    }
  }
}
