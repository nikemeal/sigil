# Module 12: Auto-Updater — Design Spec

**Date:** 2026-04-09
**Status:** Approved

---

## Overview

Sigil updates itself from git. Two triggers: `sigil update` CLI command and a scheduled background check. After each update, an autonomous override reviewer compares `local/` overrides against the updated `src/` files, removes stale ones, and flags uncertain ones. The running process restarts itself after a successful update.

---

## Architecture

Four components following the existing layered pattern (HealthMonitor, Evaluator):

- **`UpdateChecker`** — runs `git fetch`, compares local HEAD to `origin/main`. Returns whether an update is available and how many commits behind. Fires `update:available` when found. Runs on a `setInterval` for scheduled checks.
- **`Updater`** — performs the update: `git pull`, `npm install` (if `package.json` changed), `npm run build`, then triggers override review and self-restarts.
- **`OverrideReviewer`** — post-update, scans `local/` and compares each override against the corresponding updated `src/` file using the cheapest available model. Removes stale overrides autonomously, emits events for flagged ones.
- **`update-tools.ts`** — exposes `check_for_updates` and `apply_update` as agent tools so the agent can trigger or inspect updates mid-conversation.

Scheduled check and CLI both route through the same `UpdateChecker` + `Updater` path — no duplicated logic.

---

## Config

New `[update]` section in `sigil.toml` (and `sigil.example.toml`):

```toml
[update]
enabled = true
checkInterval = "24h"    # how often to auto-check (parsed as ms)
remoteBranch = "origin/main"
```

`checkInterval` is a human-readable duration string, parsed to milliseconds. Default: `"24h"`. Supported units: `h` (hours), `m` (minutes), `d` (days). Parsed inline — no external library. Example: `"24h"` → `86400000`.

---

## Update Flow

Triggered by scheduler or `sigil update` CLI:

1. **`UpdateChecker.check()`** — runs `git fetch origin`, then compares `git rev-parse HEAD` vs `git rev-parse origin/main`. Returns `{ hasUpdate, currentSha, latestSha, commitCount }`. If `hasUpdate` is false, stops here.
2. Emit `update:available { currentSha, latestSha, commitCount }` — logged to console.
3. **`Updater.apply()`**:
   - Emit `update:applying {}`
   - `git pull origin/main`
   - Check if `package.json` changed in the pull — if yes, run `npm install`
   - Run `npm run build` (always — TypeScript must be recompiled)
   - Run `OverrideReviewer.review()`
   - Emit `update:complete { previousSha, newSha }`
   - Self-restart: `spawn(process.execPath, process.argv.slice(1), { detached: true, stdio: 'inherit' }).unref(); process.exit(0)`

4. The new process starts clean with updated `dist/`. `local/` and `data/` are untouched (gitignored).

**Failure handling:** Any step that throws emits `update:failed { error }` and aborts. The running process continues serving — no partial state.

---

## Override Review

Runs automatically after every successful `git pull`, before self-restart:

1. Scan `local/` recursively for all files.
2. For each override, find the corresponding `src/` file (same relative path, e.g. `local/tools/shell.js` → `src/tools/shell.ts`).
3. Three cases:
   - **No matching `src/` file** — source was deleted or moved. Remove override automatically. Emit `update:override_removed { path, reason }`.
   - **Matching `src/` exists** — send both files to cheapest available model with prompt:
     ```
     The local override was written to patch the original source file. Given the updated source below, is this override:
     (a) still valid - the patch is still needed and compatible
     (b) stale - the source has changed enough that the override is superseded or incompatible
     (c) unclear - you cannot determine without more context

     Reply with just the letter: a, b, or c. Then one sentence of reasoning.

     Updated source:
     <src file contents>

     Local override:
     <local file contents>
     ```
     - **(a) still valid** — keep it, no event.
     - **(b) stale** — remove automatically. Emit `update:override_removed { path, reason }`.
     - **(c) unclear** — keep it. Emit `update:override_flagged { path, reason }`.
4. Flagged overrides are logged at startup so the agent can surface them when relevant. They do not block restart.

---

## CLI

New `sigil update` subcommand alongside `sigil start`:

- `sigil update` — check for update and apply if available. Prints result and exits.
- `sigil update --check` — check only, print status (`Up to date` or `Update available: N commits behind`), exit.

Handled in `src/cli/update.ts`. Entry point detects the `update` argument before starting the full service.

---

## Scheduling

`UpdateChecker` manages its own `setInterval` internally when `config.update.enabled` is `true`:

- Waits 5 minutes after startup before first check (allows service to fully boot).
- Checks every `checkInterval` thereafter.
- No dependency on the existing `Scheduler` — updates don't need task queue semantics.
- If a check finds an update while a previous apply is in progress, the second trigger is a no-op.

---

## Event Bus Additions

New events added to `EventMap` in `types.ts`:

```typescript
'update:available':        { currentSha: string; latestSha: string; commitCount: number }
'update:applying':         {}
'update:complete':         { previousSha: string; newSha: string }
'update:failed':           { error: string }
'update:override_removed': { path: string; reason: string }
'update:override_flagged': { path: string; reason: string }
```

---

## Tools

**`check_for_updates`**
- No args
- Runs `UpdateChecker.check()`, returns status: up to date or available with commit count
- Approval: `auto`

**`apply_update`**
- No args
- Runs `Updater.apply()` — triggers full update + override review + restart
- Approval: `auto`

---

## File Map

```
src/update/
  checker.ts              ← UpdateChecker (git fetch + compare)
  updater.ts              ← Updater (pull + install + build + restart)
  override-reviewer.ts    ← OverrideReviewer (LLM-based override audit)
src/tools/
  update-tools.ts         ← check_for_updates, apply_update tools
src/cli/
  update.ts               ← sigil update CLI handler
src/types.ts              ← 6 new events
src/gateway/config.ts     ← [update] config section + parsing
src/index.ts              ← wiring: UpdateChecker, Updater, OverrideReviewer, tools, audit logs
```

---

## Design Principles Applied

- **Fully autonomous** — stale overrides removed without human approval; uncertain ones flagged but never blocking.
- **Single update path** — CLI and scheduler both call the same `UpdateChecker` + `Updater` — no logic duplication.
- **Cheap model for review** — `OverrideReviewer` uses `pool.getCheapest()`, same pattern as `Evaluator`.
- **Safe failure** — any update step failure emits an event and aborts; the running service is unaffected.
- **`local/` and `data/` untouched** — gitignored, never affected by git pull.
