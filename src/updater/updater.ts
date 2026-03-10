import { execSync } from 'node:child_process';
import type { Tool, ToolResult } from '../gateway/types.js';

// ── Types ───────────────────────────────────────────────────────

export interface UpdateConfig {
  /** Allow Sigil to auto-update without prompting */
  autoUpdate: boolean;
  /** Cron interval for checking (ms). Default: 1 hour */
  checkIntervalMs: number;
  /** Working directory (where the git repo lives) */
  repoDir: string;
  /** Branch to track */
  branch: string;
}

export interface UpdateStatus {
  currentCommit: string;
  currentBranch: string;
  remoteCommit: string | null;
  behind: number;
  hasUpdate: boolean;
  lastChecked: Date;
  lastUpdated: Date | null;
  autoUpdate: boolean;
}

// ── Updater ─────────────────────────────────────────────────────

/**
 * Handles checking for updates, pulling changes, and restarting Sigil.
 *
 * Three modes:
 *  - Auto-update ON:  checks on a schedule, pulls + restarts automatically
 *  - Auto-update OFF: checks on schedule, notifies user if update available
 *  - Manual: user asks the agent to check/update via tool
 *
 * The restart is done by exiting the process cleanly and relying on
 * systemd to bring it back up. The new code runs on restart.
 */
export class Updater {
  private config: UpdateConfig;
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastChecked: Date | null = null;
  private lastUpdated: Date | null = null;
  private onNotify?: (message: string) => void;

  constructor(config: UpdateConfig, onNotify?: (message: string) => void) {
    this.config = config;
    this.onNotify = onNotify;
  }

  /** Start the scheduled update checker */
  startSchedule(): void {
    const mode = this.config.autoUpdate ? 'auto-update' : 'notify-only';
    const mins = Math.round(this.config.checkIntervalMs / 60_000);
    console.log(`[updater] Started (${mode}, checking every ${mins}m)`);

    // Check shortly after startup (30 second delay to let everything init)
    setTimeout(() => this.scheduledCheck(), 30_000);

    this.interval = setInterval(() => this.scheduledCheck(), this.config.checkIntervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /** Check if updates are available */
  async checkForUpdates(): Promise<UpdateStatus> {
    const repoDir = this.config.repoDir;

    try {
      // Fetch latest from remote (without merging)
      this.git('fetch origin --quiet');

      const currentCommit = this.git('rev-parse HEAD').trim();
      const currentBranch = this.git('rev-parse --abbrev-ref HEAD').trim();
      const remoteRef = `origin/${this.config.branch}`;
      const remoteCommit = this.git(`rev-parse ${remoteRef}`).trim();
      const behindCount = parseInt(
        this.git(`rev-list --count HEAD..${remoteRef}`).trim() || '0'
      );

      this.lastChecked = new Date();

      return {
        currentCommit: currentCommit.slice(0, 8),
        currentBranch,
        remoteCommit: remoteCommit.slice(0, 8),
        behind: behindCount,
        hasUpdate: behindCount > 0,
        lastChecked: this.lastChecked,
        lastUpdated: this.lastUpdated,
        autoUpdate: this.config.autoUpdate,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[updater] Check failed: ${message}`);
      throw new Error(`Update check failed: ${message}`);
    }
  }

  /** Pull changes, install deps, and restart */
  async applyUpdate(): Promise<string> {
    try {
      // Check for local changes that would block a pull
      const status = this.git('status --porcelain').trim();
      if (status) {
        return `Cannot update: there are local changes.\n${status}\nStash or commit them first.`;
      }

      // Pull
      const pullOutput = this.git(`pull origin ${this.config.branch} --ff-only`);
      console.log(`[updater] Pulled: ${pullOutput.trim()}`);

      // Install any new dependencies
      console.log('[updater] Installing dependencies...');
      execSync('npm install --production=false', {
        cwd: this.config.repoDir,
        timeout: 120_000,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // Get the new commit for logging
      const newCommit = this.git('rev-parse --short HEAD').trim();
      const commitMsg = this.git('log -1 --pretty=%s').trim();

      this.lastUpdated = new Date();

      // Schedule restart — give time for the response to be sent
      const restartMsg = `Updated to ${newCommit}: "${commitMsg}". Restarting in 3 seconds...`;
      console.log(`[updater] ${restartMsg}`);

      setTimeout(() => {
        console.log('[updater] Restarting...');
        // Exit cleanly — systemd will restart us with the new code
        process.exit(0);
      }, 3000);

      return restartMsg;

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[updater] Update failed: ${message}`);
      return `Update failed: ${message}`;
    }
  }

  /** Scheduled check — auto-updates or notifies depending on config */
  private async scheduledCheck(): Promise<void> {
    try {
      const status = await this.checkForUpdates();

      if (!status.hasUpdate) return;

      const summary = `Update available: ${status.behind} commit(s) behind ${this.config.branch}`;

      if (this.config.autoUpdate) {
        console.log(`[updater] ${summary} — auto-updating...`);
        this.onNotify?.(`${summary}. Applying update now...`);
        await this.applyUpdate();
      } else {
        console.log(`[updater] ${summary}`);
        this.onNotify?.(`${summary}. Run \`sigil update\` or ask me to update.`);
      }
    } catch (err) {
      // Quiet failure on scheduled checks — don't spam logs
      console.warn(`[updater] Scheduled check failed: ${err}`);
    }
  }

  /** Run a git command in the repo directory */
  private git(command: string): string {
    return execSync(`git ${command}`, {
      cwd: this.config.repoDir,
      timeout: 30_000,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  }
}

// ── Update tool (exposed to the agent) ──────────────────────────

export function createUpdateTools(updater: Updater): Tool[] {
  return [
    {
      name: 'check_updates',
      description: `Check if there are any updates available for Sigil. Shows the current
version, remote version, and how many commits behind.`,
      parameters: { type: 'object', properties: {} },
      async execute(): Promise<ToolResult> {
        try {
          const status = await updater.checkForUpdates();

          if (!status.hasUpdate) {
            return {
              content: `Up to date. Current: ${status.currentCommit} on ${status.currentBranch}. Auto-update: ${status.autoUpdate ? 'on' : 'off'}`,
            };
          }

          return {
            content: [
              `Update available: ${status.behind} commit(s) behind.`,
              `Current: ${status.currentCommit} → Remote: ${status.remoteCommit}`,
              `Branch: ${status.currentBranch}`,
              `Auto-update: ${status.autoUpdate ? 'on' : 'off'}`,
              '',
              status.autoUpdate
                ? 'Auto-update is enabled — this will be applied automatically.'
                : 'Ask me to "apply the update" or run `sigil update` from the CLI.',
            ].join('\n'),
          };
        } catch (err) {
          return {
            content: `Failed to check: ${err instanceof Error ? err.message : err}`,
            isError: true,
          };
        }
      },
    },
    {
      name: 'apply_update',
      description: `Pull the latest code, install dependencies, and restart Sigil.
Use this when the user asks to update, or when check_updates shows an available update.
Sigil will restart automatically after updating — the conversation will briefly disconnect.`,
      parameters: { type: 'object', properties: {} },
      async execute(): Promise<ToolResult> {
        const result = await updater.applyUpdate();
        return { content: result };
      },
    },
  ];
}
