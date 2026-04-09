# Module 12: Auto-Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sigil can check for updates from its git remote, apply them autonomously (git pull + rebuild + self-restart), and review local/ overrides after each update using a cheap LLM call.

**Architecture:** Four components — `UpdateChecker` (git fetch + compare), `Updater` (pull + build + restart), `OverrideReviewer` (LLM-based local/ audit), and `update-tools.ts` (agent-accessible tools). CLI subcommand detection added to `src/index.ts` entry point. Scheduled check uses `setInterval` inside `UpdateChecker`.

**Tech Stack:** Node.js `child_process.execSync` for git/npm commands, `child_process.spawn` for self-restart, `node:fs` for override scanning, existing `ProviderPool.getCheapest()` for LLM calls.

---

## File Map

```
src/update/
  checker.ts              ← new: UpdateChecker + parseDuration
  updater.ts              ← new: Updater (git pull + build + restart)
  override-reviewer.ts    ← new: OverrideReviewer (LLM override audit)
src/tools/
  update-tools.ts         ← new: check_for_updates, apply_update tools
src/cli/
  update.ts               ← new: sigil update / sigil update --check CLI
src/types.ts              ← add UpdateConfig, UpdateCheckResult, update events
src/gateway/config.ts     ← add [update] config section with defaults
sigil.example.toml        ← add commented [update] section
src/index.ts              ← CLI subcommand detection + wiring
src/test.ts               ← Module 12 tests
```

---

### Task 1: Types + Config

**Files:**
- Modify: `src/types.ts`
- Modify: `src/gateway/config.ts`
- Modify: `sigil.example.toml`
- Test: `src/test.ts`

- [ ] **Step 1: Add types to `src/types.ts`**

Add after the `TechniqueResult` interface (around line 256) and add events to `EventMap`:

```typescript
// ---------------------------------------------------------------------------
// Auto-Updater (module 12)
// ---------------------------------------------------------------------------

export interface UpdateConfig {
  /** Whether to auto-check for updates on a schedule */
  enabled: boolean;
  /** How often to check — e.g. "24h", "30m", "7d" */
  checkInterval: string;
  /** Remote tracking branch — e.g. "origin/main" */
  remoteBranch: string;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentSha: string;
  latestSha: string;
  commitCount: number;
}
```

Add `update: UpdateConfig;` to the `SigilConfig` interface (after `skills: SkillsConfig;`):

```typescript
export interface SigilConfig {
  version: string;
  identity: IdentityConfig;
  models: ModelConfig[];
  defaultModel: string;
  memory: MemoryConfig;
  transports: TransportsConfig;
  skills: SkillsConfig;
  update: UpdateConfig;
}
```

Add to `EventMap` after the learning events section:

```typescript
  // Auto-updater events (module 12)
  'update:available':        { currentSha: string; latestSha: string; commitCount: number };
  'update:applying':         {};
  'update:complete':         { previousSha: string; newSha: string };
  'update:failed':           { error: string };
  'update:override_removed': { path: string; reason: string };
  'update:override_flagged': { path: string; reason: string };
```

- [ ] **Step 2: Update `src/gateway/config.ts`**

Add update defaults to `DEFAULTS` (after `skills`):

```typescript
  update: {
    enabled: true,
    checkInterval: '24h',
    remoteBranch: 'origin/main',
  },
```

Add `SigilConfig` import update — add `UpdateConfig` to the import line at the top:

```typescript
import type { SigilConfig, ModelConfig, MemoryConfig, SkillsConfig, UpdateConfig } from '../types.js';
```

Add parsing in `mergeConfig`. After the `skills` parsing block, add:

```typescript
  const update = parsed.update as Record<string, unknown> | undefined;
```

Add to the returned object (after `skills: {...}`):

```typescript
    update: {
      enabled: (update?.enabled as boolean) ?? true,
      checkInterval: (update?.check_interval as string) ?? '24h',
      remoteBranch: (update?.remote_branch as string) ?? 'origin/main',
    },
```

- [ ] **Step 3: Update `sigil.example.toml`**

Add this section at the end of the file:

```toml
# ── Auto-Updater ─────────────────────────────────────────────────────
# Sigil can check for and apply updates from its git remote automatically.
# [update]
# enabled = true
# check_interval = "24h"     # how often to check: h (hours), m (minutes), d (days)
# remote_branch = "origin/main"
```

- [ ] **Step 4: Write failing tests in `src/test.ts`**

Add a new section before the `// ── Summary` comment at the bottom of the `run()` function:

```typescript
  // ── Module 12: Auto-Updater ────────────────────────────────────────

  console.log(chalk.dim('\n  Module 12: Auto-Updater'));

  await test('Update config: loads defaults when [update] section absent', async () => {
    const { loadConfig } = await import('./gateway/config.js');
    // loadConfig reads from sigil.toml — if not present, returns defaults
    // We test the defaults are what we expect by inspecting what mergeConfig returns
    // for an empty object. Since mergeConfig is private, we test via the exported
    // UpdateConfig shape by constructing one directly.
    const defaultConfig = {
      enabled: true,
      checkInterval: '24h',
      remoteBranch: 'origin/main',
    };
    if (defaultConfig.enabled !== true) throw new Error('Default enabled should be true');
    if (defaultConfig.checkInterval !== '24h') throw new Error('Default checkInterval should be 24h');
    if (defaultConfig.remoteBranch !== 'origin/main') throw new Error('Default remoteBranch should be origin/main');
  });

  await test('parseDuration: "24h" → 86400000', async () => {
    const { parseDuration } = await import('./update/checker.js');
    const result = parseDuration('24h');
    if (result !== 86_400_000) throw new Error(`Expected 86400000, got ${result}`);
  });

  await test('parseDuration: "30m" → 1800000', async () => {
    const { parseDuration } = await import('./update/checker.js');
    const result = parseDuration('30m');
    if (result !== 1_800_000) throw new Error(`Expected 1800000, got ${result}`);
  });

  await test('parseDuration: "7d" → 604800000', async () => {
    const { parseDuration } = await import('./update/checker.js');
    const result = parseDuration('7d');
    if (result !== 604_800_000) throw new Error(`Expected 604800000, got ${result}`);
  });

  await test('parseDuration: throws on invalid format', async () => {
    const { parseDuration } = await import('./update/checker.js');
    let threw = false;
    try { parseDuration('1week'); } catch { threw = true; }
    if (!threw) throw new Error('Expected parseDuration to throw on "1week"');
  });

  await test('OverrideReviewer: no-op when local/ directory is missing', async () => {
    const { OverrideReviewer } = await import('./update/override-reviewer.js');
    const { EventBus } = await import('./lib/event-bus.js');
    const bus = new EventBus();
    const events: string[] = [];
    bus.on('update:override_removed', ({ path }) => events.push(`removed:${path}`));
    bus.on('update:override_flagged', ({ path }) => events.push(`flagged:${path}`));

    // Use a temp dir with no local/ subdirectory
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const tmpDir = mkdtempSync(tmpdir() + '/sigil-test-');

    const reviewer = new OverrideReviewer(tmpDir);
    await reviewer.review(bus, null as never); // pool unused when no files
    if (events.length !== 0) throw new Error(`Expected no events, got ${events.join(', ')}`);

    const { rmSync } = await import('node:fs');
    rmSync(tmpDir, { recursive: true });
  });

  await test('OverrideReviewer: removes override when src file not found', async () => {
    const { OverrideReviewer } = await import('./update/override-reviewer.js');
    const { EventBus } = await import('./lib/event-bus.js');
    const { mkdtempSync, mkdirSync, writeFileSync, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const bus = new EventBus();
    const removed: string[] = [];
    bus.on('update:override_removed', ({ path }) => removed.push(path));

    // Set up temp dir with local/tools/custom.js but no src/tools/custom.ts
    const tmpDir = mkdtempSync(tmpdir() + '/sigil-test-');
    mkdirSync(join(tmpDir, 'local', 'tools'), { recursive: true });
    writeFileSync(join(tmpDir, 'local', 'tools', 'custom.js'), 'module.exports = {}');
    // No src/ directory at all

    const reviewer = new OverrideReviewer(tmpDir);
    await reviewer.review(bus, null as never);

    if (removed.length !== 1) throw new Error(`Expected 1 removed override, got ${removed.length}`);
    if (removed[0] !== 'tools/custom.js') throw new Error(`Expected "tools/custom.js", got "${removed[0]}"`);
    if (existsSync(join(tmpDir, 'local', 'tools', 'custom.js'))) {
      throw new Error('Override file should have been deleted');
    }

    const { rmSync } = await import('node:fs');
    rmSync(tmpDir, { recursive: true });
  });

  await test('Update tools: check_for_updates and apply_update created', async () => {
    const { EventBus } = await import('./lib/event-bus.js');
    const { UpdateChecker } = await import('./update/checker.js');
    const { Updater } = await import('./update/updater.js');
    const { createUpdateTools } = await import('./tools/update-tools.js');

    const bus = new EventBus();
    const checker = new UpdateChecker('origin/main');
    const updater = new Updater(process.cwd(), 'origin/main');
    const tools = createUpdateTools(bus, checker, updater, null as never);

    if (tools.length !== 2) throw new Error(`Expected 2 tools, got ${tools.length}`);
    const names = tools.map((t) => t.name);
    if (!names.includes('check_for_updates')) throw new Error('Missing check_for_updates tool');
    if (!names.includes('apply_update')) throw new Error('Missing apply_update tool');
    if (tools.every((t) => t.approval !== 'auto')) throw new Error('Tools should be auto-approved');
  });
```

- [ ] **Step 5: Run tests to verify they fail**

```bash
npm test 2>&1 | tail -30
```

Expected: Tests in Module 12 section fail with import errors (files don't exist yet).

- [ ] **Step 6: Commit types + config**

```bash
git add src/types.ts src/gateway/config.ts sigil.example.toml src/test.ts
git commit -m "feat(module-12): types, config, and test scaffolding for auto-updater"
```

---

### Task 2: UpdateChecker

**Files:**
- Create: `src/update/checker.ts`
- Test: `src/test.ts` (already written above)

- [ ] **Step 1: Create `src/update/checker.ts`**

```typescript
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
```

- [ ] **Step 2: Run parseDuration tests**

```bash
npm test 2>&1 | grep -A 2 "parseDuration"
```

Expected: All 4 parseDuration tests pass. The OverrideReviewer and update-tools tests still fail (files don't exist).

- [ ] **Step 3: Commit**

```bash
git add src/update/checker.ts
git commit -m "feat(module-12): UpdateChecker — git fetch + compare + scheduled checks"
```

---

### Task 3: OverrideReviewer

**Files:**
- Create: `src/update/override-reviewer.ts`
- Test: `src/test.ts` (already written)

- [ ] **Step 1: Create `src/update/override-reviewer.ts`**

```typescript
/**
 * Override Reviewer
 *
 * After a git pull, scans local/ for agent-created overrides and compares
 * each one against the updated src/ file using a cheap LLM call.
 *
 * Decisions:
 *   (a) still valid  → keep, no event
 *   (b) stale        → delete override, emit update:override_removed
 *   (c) unclear      → keep, emit update:override_flagged
 *
 * If no src/ match exists (file was deleted/moved), the override is removed
 * automatically without an LLM call.
 */

import { readdirSync, statSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { CompletionRequest } from '../types.js';
import type { ProviderPool } from '../router/provider-pool.js';
import type { EventBus } from '../lib/event-bus.js';

const REVIEW_PROMPT = `The local override was written to patch the original source file. Given the updated source below, is this override:
(a) still valid - the patch is still needed and compatible
(b) stale - the source has changed enough that the override is superseded or incompatible
(c) unclear - you cannot determine without more context

Reply with just the letter: a, b, or c. Then one sentence of reasoning.

Updated source:
{source}

Local override:
{override}`;

export class OverrideReviewer {
  private readonly localDir: string;
  private readonly srcDir: string;

  constructor(private readonly cwd: string) {
    this.localDir = join(cwd, 'local');
    this.srcDir = join(cwd, 'src');
  }

  async review(bus: EventBus, pool: ProviderPool): Promise<void> {
    const files = this.scanLocal();
    if (files.length === 0) return;

    const cheapest = pool ? pool.getCheapest() : null;

    for (const localPath of files) {
      const relPath = relative(this.localDir, localPath);
      const srcPath = this.findSrcFile(relPath);

      if (!srcPath) {
        // Source was deleted or moved — remove override unconditionally
        try {
          unlinkSync(localPath);
          bus.emit('update:override_removed', {
            path: relPath,
            reason: 'Source file no longer exists',
          });
          console.log(`[Updater] Override removed (no source): ${relPath}`);
        } catch (err) {
          console.warn(`[Updater] Failed to remove override ${relPath}:`, (err as Error).message);
        }
        continue;
      }

      if (!cheapest) {
        // No model available — flag for manual review
        bus.emit('update:override_flagged', {
          path: relPath,
          reason: 'No model available for automated review',
        });
        console.warn(`[Updater] Override flagged (no model): ${relPath}`);
        continue;
      }

      try {
        const srcContent = readFileSync(srcPath, 'utf-8').slice(0, 3000);
        const overrideContent = readFileSync(localPath, 'utf-8').slice(0, 3000);

        const prompt = REVIEW_PROMPT
          .replace('{source}', srcContent)
          .replace('{override}', overrideContent);

        const req: CompletionRequest = {
          messages: [{ role: 'user', content: prompt }],
          model: cheapest.model.model,
          maxTokens: 100,
          temperature: 0,
        };

        const response = await cheapest.provider.complete(req);
        const text = response.content.trim();
        const letter = text[0]?.toLowerCase();
        const reasoning = text.slice(1).replace(/^[.,:]\s*/, '').trim() || 'No reason given';

        if (letter === 'b') {
          unlinkSync(localPath);
          bus.emit('update:override_removed', { path: relPath, reason: reasoning });
          console.log(`[Updater] Override removed (stale): ${relPath}`);
        } else if (letter === 'c') {
          bus.emit('update:override_flagged', { path: relPath, reason: reasoning });
          console.warn(`[Updater] Override flagged for review: ${relPath}`);
        }
        // letter === 'a': still valid, do nothing

      } catch (err) {
        const error = (err as Error).message;
        bus.emit('update:override_flagged', {
          path: relPath,
          reason: `Review failed: ${error}`,
        });
        console.warn(`[Updater] Override review failed for ${relPath}:`, error);
      }
    }
  }

  private scanLocal(): string[] {
    if (!existsSync(this.localDir)) return [];
    return this.scanDir(this.localDir);
  }

  private scanDir(dir: string): string[] {
    const results: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        results.push(...this.scanDir(full));
      } else {
        results.push(full);
      }
    }
    return results;
  }

  /**
   * Find the src/ counterpart to a local/ file path.
   * Tries both .ts and .js extensions since local/ overrides may use .js
   * while src/ uses .ts.
   */
  private findSrcFile(relPath: string): string | null {
    const candidates = [
      join(this.srcDir, relPath),
      join(this.srcDir, relPath.replace(/\.js$/, '.ts')),
      join(this.srcDir, relPath.replace(/\.ts$/, '.js')),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }
}
```

- [ ] **Step 2: Run OverrideReviewer tests**

```bash
npm test 2>&1 | grep -A 2 "OverrideReviewer"
```

Expected: Both OverrideReviewer tests pass. The update-tools test still fails.

- [ ] **Step 3: Commit**

```bash
git add src/update/override-reviewer.ts
git commit -m "feat(module-12): OverrideReviewer — LLM-based local/ override audit post-update"
```

---

### Task 4: Updater

**Files:**
- Create: `src/update/updater.ts`

- [ ] **Step 1: Create `src/update/updater.ts`**

```typescript
/**
 * Updater
 *
 * Applies a git update: pulls from remote, installs dependencies if needed,
 * rebuilds the TypeScript project, runs the OverrideReviewer, then
 * self-restarts the process using spawn + exit.
 *
 * Emits update:applying, update:complete, and update:failed events.
 * Safe to call from CLI or event handler — applying flag prevents double-runs.
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

    const previousSha = execSync('git rev-parse HEAD', {
      encoding: 'utf-8',
      stdio: 'pipe',
      cwd: this.cwd,
    }).trim();

    try {
      bus.emit('update:applying', {});
      console.log(`[Updater] Applying update from ${this.remoteBranch}...`);

      // Record package.json content before pull to detect dependency changes
      const pkgBefore = this.readFile('package.json');

      // Split "origin/main" → remote="origin", branch="main"
      const slashIndex = this.remoteBranch.indexOf('/');
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
```

- [ ] **Step 2: Run tests — Updater has no direct unit tests (requires git + spawn), verify existing tests still pass**

```bash
npm test 2>&1 | tail -10
```

Expected: All previously passing tests still pass. Module 12 tests for update-tools still fail.

- [ ] **Step 3: Commit**

```bash
git add src/update/updater.ts
git commit -m "feat(module-12): Updater — git pull + build + override review + self-restart"
```

---

### Task 5: Update Tools

**Files:**
- Create: `src/tools/update-tools.ts`
- Test: `src/test.ts` (already written)

- [ ] **Step 1: Create `src/tools/update-tools.ts`**

```typescript
/**
 * Update Tools
 *
 * Exposes update checking and applying as agent tools.
 * The agent can call check_for_updates to see if an update is available,
 * and apply_update to pull + rebuild + restart autonomously.
 */

import type { Tool } from '../types.js';
import type { EventBus } from '../lib/event-bus.js';
import type { UpdateChecker } from '../update/checker.js';
import type { Updater } from '../update/updater.js';
import type { ProviderPool } from '../router/provider-pool.js';

export function createUpdateTools(
  bus: EventBus,
  checker: UpdateChecker,
  updater: Updater,
  pool: ProviderPool,
): Tool[] {
  return [
    {
      name: 'check_for_updates',
      description:
        'Check whether a newer version of Sigil is available from the remote git repository. Returns update status and commit count.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      approval: 'auto',
      async execute() {
        try {
          const result = checker.check();
          if (!result.hasUpdate) {
            return 'Sigil is up to date.';
          }
          return (
            `Update available: ${result.commitCount} commit(s) behind. ` +
            `Current: ${result.currentSha.slice(0, 7)}, Latest: ${result.latestSha.slice(0, 7)}.`
          );
        } catch (err) {
          return `Update check failed: ${(err as Error).message}`;
        }
      },
    },
    {
      name: 'apply_update',
      description:
        'Apply the latest update from the remote git repository. Pulls changes, rebuilds, reviews local overrides, and restarts Sigil. The process will restart — the current session will end.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      approval: 'auto',
      async execute() {
        try {
          // apply() restarts the process — this return is never reached if successful
          await updater.apply(bus, pool);
          return 'Update applied. Sigil is restarting...';
        } catch (err) {
          return `Update failed: ${(err as Error).message}`;
        }
      },
    },
  ];
}
```

- [ ] **Step 2: Run all Module 12 tests**

```bash
npm test 2>&1 | grep -A 2 "Module 12"
```

Expected: All 8 Module 12 tests pass.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: All tests pass (Module 12 section included).

- [ ] **Step 4: Commit**

```bash
git add src/tools/update-tools.ts
git commit -m "feat(module-12): update tools — check_for_updates, apply_update"
```

---

### Task 6: CLI Handler

**Files:**
- Create: `src/cli/update.ts`

- [ ] **Step 1: Create `src/cli/` directory and `src/cli/update.ts`**

```typescript
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

  // Wire audit logging so update progress is visible
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/cli/update.ts
git commit -m "feat(module-12): update CLI handler — sigil update / sigil update --check"
```

---

### Task 7: Wiring in `src/index.ts`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add CLI subcommand detection at the top of `main()`**

In `src/index.ts`, add this as the very first thing inside `main()` (before `console.log('[Sigil] Starting...')`):

```typescript
  // Handle CLI subcommands before starting the full service
  const subcommand = process.argv[2];
  if (subcommand === 'update') {
    const { runUpdateCli } = await import('./cli/update.js');
    const checkOnly = process.argv.includes('--check');
    await runUpdateCli(checkOnly);
    return;
  }
```

- [ ] **Step 2: Add imports**

Add to the imports section at the top of `src/index.ts` (after the existing imports):

```typescript
import { UpdateChecker, parseDuration } from './update/checker.js';
import { Updater } from './update/updater.js';
import { createUpdateTools } from './tools/update-tools.js';
```

- [ ] **Step 3: Add wiring after the learning tools section**

After the `// Register learning tools (module 11)` block and before `// Learning audit logging`, add:

```typescript
  // Create auto-updater components (module 12)
  const updateChecker = new UpdateChecker(config.update.remoteBranch);
  const updater = new Updater(process.cwd(), config.update.remoteBranch);

  // Register update tools
  for (const tool of createUpdateTools(bus, updateChecker, updater, pool)) {
    tools.register(tool);
  }

  // Start scheduled update checks if enabled
  if (config.update.enabled) {
    updateChecker.start(bus, parseDuration(config.update.checkInterval));
  }

  // Update audit logging
  bus.on('update:available', ({ commitCount, latestSha }) => {
    console.log(`[Updater] Update available: ${commitCount} commit(s) behind (${latestSha.slice(0, 7)})`);
  });
  bus.on('update:applying', () => {
    console.log('[Updater] Applying update...');
  });
  bus.on('update:complete', ({ previousSha, newSha }) => {
    console.log(`[Updater] Updated: ${previousSha.slice(0, 7)} → ${newSha.slice(0, 7)}`);
  });
  bus.on('update:failed', ({ error }) => {
    console.warn(`[Updater] Update failed: ${error}`);
  });
  bus.on('update:override_removed', ({ path, reason }) => {
    console.log(`[Updater] Override removed: ${path} — ${reason}`);
  });
  bus.on('update:override_flagged', ({ path, reason }) => {
    console.warn(`[Updater] Override flagged for review: ${path} — ${reason}`);
  });
```

- [ ] **Step 4: Add `updateChecker.stop()` to the shutdown handler**

Inside the `shutdown` function, after `scheduler.stop()`:

```typescript
    updateChecker.stop();
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1
```

Expected: No errors.

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 7: Build**

```bash
npm run build 2>&1 | tail -5
```

Expected: Build completes with no errors.

- [ ] **Step 8: Smoke test CLI handler**

```bash
node dist/index.js update --check 2>&1
```

Expected: `[Sigil] Checking for updates...` followed by either `[Sigil] Already up to date.` or an update available message. The process exits without starting the full service.

- [ ] **Step 9: Commit**

```bash
git add src/index.ts
git commit -m "feat(module-12): wire auto-updater — scheduler, tools, CLI detection, audit logs"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ UpdateChecker — git fetch + compare → Task 2
- ✅ Updater — git pull + npm install + build + restart → Task 4
- ✅ OverrideReviewer — LLM scan of local/ post-update → Task 3
- ✅ update-tools — check_for_updates, apply_update → Task 5
- ✅ CLI — sigil update / sigil update --check → Task 6
- ✅ Scheduled check — start/stop with 5-min initial delay → Task 2, wired in Task 7
- ✅ Config — [update] section with defaults → Task 1
- ✅ 6 new events in EventMap → Task 1
- ✅ Applying flag prevents double-run → Task 4 (`this.applying`)
- ✅ package.json diff check before npm install → Task 4
- ✅ Failure emits update:failed and does not crash service → Task 4 catch block
- ✅ updateChecker.stop() in shutdown → Task 7

**Type consistency:**
- `UpdateCheckResult` defined in Task 1, used in Task 2 `check()` return type ✅
- `UpdateConfig` defined in Task 1, used in `SigilConfig` and config.ts ✅
- `parseDuration` exported from checker.ts, imported in index.ts ✅
- `OverrideReviewer.review(bus, pool)` signature consistent across Task 3 + Task 4 ✅
- `createUpdateTools(bus, checker, updater, pool)` consistent across Task 5 + Task 7 ✅
