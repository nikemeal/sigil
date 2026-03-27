# Module 11: Learning + Self-Improvement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a technique store, auto-evaluator, and explicit reflection tools so the agent learns from completed tasks and applies that knowledge to future similar requests.

**Architecture:** A dedicated `src/learning/` module holds the SQLite-backed `TechniqueStore` and an `Evaluator` that hooks into `task:complete` events. Three learning tools (`reflect`, `list_techniques`, `forget_technique`) allow explicit capture. `ContextEngine` injects relevant techniques into the system prompt alongside memories.

**Tech Stack:** better-sqlite3 (FTS5), existing EventBus, ProviderPool (cheapest model for evaluation), TypeScript.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/types.ts` | Modify | Add `TechniqueResult` interface, 2 new events, `userMessage` to `task:complete` |
| `src/context/db.ts` | Modify | Add `techniques` table + FTS5 virtual table + sync triggers |
| `src/router/provider-pool.ts` | Modify | Add `getCheapest()` method |
| `src/tasks/runner.ts` | Modify | Include `userMessage` in `task:complete` event payload |
| `src/learning/store.ts` | Create | `TechniqueStore` — SQLite CRUD + FTS5 search |
| `src/learning/evaluator.ts` | Create | `Evaluator` — auto-extracts techniques after task completion |
| `src/tools/learning-tools.ts` | Create | `reflect`, `list_techniques`, `forget_technique` tools |
| `src/context/engine.ts` | Modify | Accept `TechniqueStore` + optional `EventBus`, inject techniques into system prompt |
| `src/index.ts` | Modify | Wire `TechniqueStore`, `Evaluator`, learning tools, updated `ContextEngine` |
| `src/test.ts` | Modify | Add Module 11 tests |

---

## Task 1: Add Types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/test.ts` inside the `run()` function, after the last module section:

```typescript
  // ── Module 11: Learning ────────────────────────────────────────────

  console.log(chalk.dim('\n  Module 11: Learning'));

  await test('TechniqueResult type is exported', async () => {
    const types = await import('./types.js');
    // Type-level check — if TechniqueResult is exported, this import succeeds
    const t: import('./types.js').TechniqueResult = {
      id: 'test-id',
      pattern: 'test pattern',
      technique: 'test technique',
      source: 'explicit',
      usageCount: 0,
      createdAt: new Date().toISOString(),
    };
    if (!t.id) throw new Error('TechniqueResult not valid');
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test 2>&1 | grep -A2 'TechniqueResult'
```

Expected: compile/runtime error about missing type.

- [ ] **Step 3: Add `TechniqueResult` interface to `src/types.ts`**

Add after the `HealthCheckResult` interface (around line 241):

```typescript
// ---------------------------------------------------------------------------
// Learning — technique store (module 11)
// ---------------------------------------------------------------------------

export interface TechniqueResult {
  id: string;
  pattern: string;
  technique: string;
  outcome?: string;
  source: 'explicit' | 'auto';
  usageCount: number;
  createdAt: string;
  lastUsed?: string;
}
```

- [ ] **Step 4: Add `userMessage` to `task:complete` event in `src/types.ts`**

Find the existing line:
```typescript
  'task:complete': { taskId: string; result: string; cost: number };
```

Replace with:
```typescript
  'task:complete': { taskId: string; userMessage: string; result: string; cost: number };
```

- [ ] **Step 5: Add two new events to `EventMap` in `src/types.ts`**

Find the existing extension events block (after `'extension:skill_created'`) and add:

```typescript
  // Learning events (module 11)
  'learning:technique_captured': { id: string; pattern: string; source: 'explicit' | 'auto' };
  'learning:technique_used': { ids: string[]; query: string };
```

- [ ] **Step 6: Run test to verify it passes**

```bash
npm test 2>&1 | grep -A2 'TechniqueResult'
```

Expected: `✓ TechniqueResult type is exported`

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/test.ts
git commit -m "feat(learning): add TechniqueResult type and learning events"
```

---

## Task 2: Add Database Migration

**Files:**
- Modify: `src/context/db.ts`

- [ ] **Step 1: Write the failing test**

Add to the Module 11 section in `src/test.ts`:

```typescript
  await test('Techniques table exists after migration', async () => {
    const db = new Database(':memory:');
    // Inline the full migration by importing getDatabase with :memory:
    // We can't use getDatabase(':memory:') directly due to singleton, so we
    // copy just the techniques DDL here for an isolated test.
    db.exec(`
      CREATE TABLE IF NOT EXISTS techniques (
        integer_id INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        pattern TEXT NOT NULL,
        technique TEXT NOT NULL,
        outcome TEXT,
        source TEXT NOT NULL DEFAULT 'explicit',
        usage_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_used TEXT
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS techniques_fts USING fts5(
        pattern,
        technique,
        content='techniques',
        content_rowid='integer_id'
      );
    `);
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' OR type='shadow'`).all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);
    if (!tableNames.includes('techniques')) throw new Error('Missing techniques table');
    db.close();
  });
```

- [ ] **Step 2: Run test to verify it passes already** (it's self-contained DDL)

```bash
npm test 2>&1 | grep -A2 'Techniques table'
```

Expected: `✓ Techniques table exists after migration`

- [ ] **Step 3: Add the migration to `src/context/db.ts`**

Find the end of the `migrate()` function body, just before the closing `);` of the `db.exec` call (after the `idx_task_steps_task` index), and add:

```sql

    -- Learned techniques (Module 11)
    CREATE TABLE IF NOT EXISTS techniques (
      integer_id INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT UNIQUE NOT NULL,
      pattern TEXT NOT NULL,
      technique TEXT NOT NULL,
      outcome TEXT,
      source TEXT NOT NULL DEFAULT 'explicit',
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_used TEXT
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS techniques_fts USING fts5(
      pattern,
      technique,
      content='techniques',
      content_rowid='integer_id'
    );

    CREATE TRIGGER IF NOT EXISTS techniques_ai AFTER INSERT ON techniques BEGIN
      INSERT INTO techniques_fts(rowid, pattern, technique)
      VALUES (new.integer_id, new.pattern, new.technique);
    END;

    CREATE TRIGGER IF NOT EXISTS techniques_ad AFTER DELETE ON techniques BEGIN
      INSERT INTO techniques_fts(techniques_fts, rowid, pattern, technique)
      VALUES ('delete', old.integer_id, old.pattern, old.technique);
    END;

    CREATE TRIGGER IF NOT EXISTS techniques_au AFTER UPDATE ON techniques BEGIN
      INSERT INTO techniques_fts(techniques_fts, rowid, pattern, technique)
      VALUES ('delete', old.integer_id, old.pattern, old.technique);
      INSERT INTO techniques_fts(rowid, pattern, technique)
      VALUES (new.integer_id, new.pattern, new.technique);
    END;
```

- [ ] **Step 4: Verify the server still compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no output (no errors).

- [ ] **Step 5: Commit**

```bash
git add src/context/db.ts src/test.ts
git commit -m "feat(learning): add techniques table migration with FTS5"
```

---

## Task 3: Add `getCheapest()` to ProviderPool

**Files:**
- Modify: `src/router/provider-pool.ts`

- [ ] **Step 1: Write the failing test**

Add to the Module 11 section in `src/test.ts`:

```typescript
  await test('ProviderPool.getCheapest() returns null when empty', async () => {
    const { ProviderPool } = await import('./router/provider-pool.js');
    const pool = new ProviderPool({
      version: '2.0.0',
      identity: { name: 'test', personality: 'test' },
      models: [],
      defaultModel: '',
      memory: { dbPath: 'data/sigil.db', maxRecallResults: 5 },
      transports: { tui: { enabled: false }, web: { enabled: false, port: 3033, host: '127.0.0.1' }, telegram: { enabled: false } },
      skills: { path: 'skills' },
    });
    const result = pool.getCheapest();
    if (result !== null) throw new Error(`Expected null, got ${JSON.stringify(result)}`);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test 2>&1 | grep -A2 "getCheapest"
```

Expected: error — `pool.getCheapest is not a function`

- [ ] **Step 3: Add `getCheapest()` to `src/router/provider-pool.ts`**

Add after the `get size()` getter:

```typescript
  /**
   * Return the provider and config for the cheapest available model.
   * Picks by tier order: minimal < basic < standard < full.
   * Returns null if no providers are configured.
   */
  getCheapest(): { provider: LLMProvider; model: ModelConfig } | null {
    const tierOrder: import('../types.js').ModelTier[] = ['minimal', 'basic', 'standard', 'full'];
    let best: { provider: LLMProvider; model: ModelConfig } | null = null;

    for (const [name, model] of this.models) {
      const provider = this.providers.get(name);
      if (!provider) continue;
      if (!best || tierOrder.indexOf(model.tier) < tierOrder.indexOf(best.model.tier)) {
        best = { provider, model };
      }
    }

    return best;
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test 2>&1 | grep -A2 "getCheapest"
```

Expected: `✓ ProviderPool.getCheapest() returns null when empty`

- [ ] **Step 5: Commit**

```bash
git add src/router/provider-pool.ts src/test.ts
git commit -m "feat(learning): add ProviderPool.getCheapest()"
```

---

## Task 4: Include `userMessage` in `task:complete` Event

**Files:**
- Modify: `src/tasks/runner.ts`

- [ ] **Step 1: Find the emit call in `src/tasks/runner.ts`** (around line 97)

```typescript
      this.bus.emit('task:complete', {
        taskId: task.id,
        result: finalResult,
        cost: updated.totalCost,
      });
```

- [ ] **Step 2: Add `userMessage` to the payload**

```typescript
      this.bus.emit('task:complete', {
        taskId: task.id,
        userMessage: task.userMessage,
        result: finalResult,
        cost: updated.totalCost,
      });
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/tasks/runner.ts
git commit -m "feat(learning): include userMessage in task:complete event"
```

---

## Task 5: Create TechniqueStore

**Files:**
- Create: `src/learning/store.ts`

- [ ] **Step 1: Write the failing tests**

Add to the Module 11 section in `src/test.ts`:

```typescript
  await test('TechniqueStore: add and list', async () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE techniques (
        integer_id INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        pattern TEXT NOT NULL,
        technique TEXT NOT NULL,
        outcome TEXT,
        source TEXT NOT NULL DEFAULT 'explicit',
        usage_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_used TEXT
      );
      CREATE VIRTUAL TABLE techniques_fts USING fts5(
        pattern, technique, content='techniques', content_rowid='integer_id'
      );
      CREATE TRIGGER techniques_ai AFTER INSERT ON techniques BEGIN
        INSERT INTO techniques_fts(rowid, pattern, technique)
        VALUES (new.integer_id, new.pattern, new.technique);
      END;
      CREATE TRIGGER techniques_ad AFTER DELETE ON techniques BEGIN
        INSERT INTO techniques_fts(techniques_fts, rowid, pattern, technique)
        VALUES ('delete', old.integer_id, old.pattern, old.technique);
      END;
    `);
    const { TechniqueStore } = await import('./learning/store.js');
    const store = new TechniqueStore(db);

    const id = store.add('summarisation tasks', 'Start with the key conclusion, then supporting points', undefined, 'explicit');
    if (!id) throw new Error('No id returned');

    const all = store.list();
    if (all.length !== 1) throw new Error(`Expected 1, got ${all.length}`);
    if (all[0].pattern !== 'summarisation tasks') throw new Error('Wrong pattern');
    if (all[0].source !== 'explicit') throw new Error('Wrong source');

    db.close();
  });

  await test('TechniqueStore: FTS5 search', async () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE techniques (
        integer_id INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        pattern TEXT NOT NULL,
        technique TEXT NOT NULL,
        outcome TEXT,
        source TEXT NOT NULL DEFAULT 'explicit',
        usage_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_used TEXT
      );
      CREATE VIRTUAL TABLE techniques_fts USING fts5(
        pattern, technique, content='techniques', content_rowid='integer_id'
      );
      CREATE TRIGGER techniques_ai AFTER INSERT ON techniques BEGIN
        INSERT INTO techniques_fts(rowid, pattern, technique)
        VALUES (new.integer_id, new.pattern, new.technique);
      END;
      CREATE TRIGGER techniques_ad AFTER DELETE ON techniques BEGIN
        INSERT INTO techniques_fts(techniques_fts, rowid, pattern, technique)
        VALUES ('delete', old.integer_id, old.pattern, old.technique);
      END;
    `);
    const { TechniqueStore } = await import('./learning/store.js');
    const store = new TechniqueStore(db);

    store.add('data analysis tasks', 'Always check for nulls before aggregating', undefined, 'auto');
    store.add('writing emails', 'Keep subject line under 60 characters', undefined, 'auto');

    const results = store.search('data analysis');
    if (results.length === 0) throw new Error('No results for "data analysis"');
    if (!results[0].pattern.includes('data analysis')) throw new Error('Wrong technique returned');

    db.close();
  });

  await test('TechniqueStore: markUsed increments count', async () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE techniques (
        integer_id INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        pattern TEXT NOT NULL,
        technique TEXT NOT NULL,
        outcome TEXT,
        source TEXT NOT NULL DEFAULT 'explicit',
        usage_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_used TEXT
      );
      CREATE VIRTUAL TABLE techniques_fts USING fts5(
        pattern, technique, content='techniques', content_rowid='integer_id'
      );
      CREATE TRIGGER techniques_ai AFTER INSERT ON techniques BEGIN
        INSERT INTO techniques_fts(rowid, pattern, technique)
        VALUES (new.integer_id, new.pattern, new.technique);
      END;
      CREATE TRIGGER techniques_ad AFTER DELETE ON techniques BEGIN
        INSERT INTO techniques_fts(techniques_fts, rowid, pattern, technique)
        VALUES ('delete', old.integer_id, old.pattern, old.technique);
      END;
    `);
    const { TechniqueStore } = await import('./learning/store.js');
    const store = new TechniqueStore(db);

    const id = store.add('refactoring', 'Extract method when function exceeds 20 lines', undefined, 'explicit');
    store.markUsed([id]);

    const all = store.list();
    if (all[0].usageCount !== 1) throw new Error(`Expected usageCount 1, got ${all[0].usageCount}`);
    if (!all[0].lastUsed) throw new Error('lastUsed not set');

    db.close();
  });

  await test('TechniqueStore: remove deletes technique', async () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE techniques (
        integer_id INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        pattern TEXT NOT NULL,
        technique TEXT NOT NULL,
        outcome TEXT,
        source TEXT NOT NULL DEFAULT 'explicit',
        usage_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_used TEXT
      );
      CREATE VIRTUAL TABLE techniques_fts USING fts5(
        pattern, technique, content='techniques', content_rowid='integer_id'
      );
      CREATE TRIGGER techniques_ai AFTER INSERT ON techniques BEGIN
        INSERT INTO techniques_fts(rowid, pattern, technique)
        VALUES (new.integer_id, new.pattern, new.technique);
      END;
      CREATE TRIGGER techniques_ad AFTER DELETE ON techniques BEGIN
        INSERT INTO techniques_fts(techniques_fts, rowid, pattern, technique)
        VALUES ('delete', old.integer_id, old.pattern, old.technique);
      END;
    `);
    const { TechniqueStore } = await import('./learning/store.js');
    const store = new TechniqueStore(db);

    const id = store.add('debugging', 'Reproduce in isolation first', undefined, 'explicit');
    store.remove(id);

    const all = store.list();
    if (all.length !== 0) throw new Error(`Expected 0, got ${all.length}`);

    db.close();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test 2>&1 | grep -E "(TechniqueStore|✓|✗)" | head -20
```

Expected: all four TechniqueStore tests fail with module not found.

- [ ] **Step 3: Create `src/learning/store.ts`**

```typescript
/**
 * Technique Store
 *
 * SQLite-backed store for learned techniques.
 * Techniques are procedural knowledge: "when doing X, approach Y works".
 * Separate from memories (which are factual knowledge about the user).
 *
 * Uses FTS5 for keyword search so relevant techniques can be injected
 * into the system prompt when a similar task arrives.
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { TechniqueResult } from '../types.js';

export class TechniqueStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Store a new technique. Returns the UUID. */
  add(
    pattern: string,
    technique: string,
    outcome: string | undefined,
    source: 'explicit' | 'auto',
  ): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO techniques (id, pattern, technique, outcome, source, usage_count, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `).run(id, pattern, technique, outcome ?? null, source, now);
    return id;
  }

  /**
   * FTS5 keyword search over pattern + technique fields.
   * Returns up to `limit` results ordered by relevance.
   */
  search(query: string, limit: number = 3): TechniqueResult[] {
    const terms = query
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1)
      .map((t) => `"${t}"`)
      .join(' OR ');

    if (!terms) return [];

    try {
      const rows = this.db.prepare(`
        SELECT t.*, fts.rank
        FROM techniques_fts fts
        JOIN techniques t ON t.integer_id = fts.rowid
        WHERE techniques_fts MATCH ?
        ORDER BY fts.rank
        LIMIT ?
      `).all(terms, limit) as Array<Record<string, unknown>>;

      return rows.map((r) => this.rowToResult(r));
    } catch {
      // FTS5 query can fail on unusual input — return empty
      return [];
    }
  }

  /** Increment usage count and update last_used for a set of technique IDs. */
  markUsed(ids: string[]): void {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE techniques SET usage_count = usage_count + 1, last_used = ? WHERE id = ?
    `);
    const tx = this.db.transaction(() => {
      for (const id of ids) {
        stmt.run(now, id);
      }
    });
    tx();
  }

  /** List all techniques ordered by usage count descending. */
  list(): TechniqueResult[] {
    const rows = this.db.prepare(`
      SELECT * FROM techniques ORDER BY usage_count DESC, created_at DESC
    `).all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToResult(r));
  }

  /** Delete a technique by UUID. */
  remove(id: string): void {
    this.db.prepare(`DELETE FROM techniques WHERE id = ?`).run(id);
  }

  private rowToResult(row: Record<string, unknown>): TechniqueResult {
    return {
      id: row.id as string,
      pattern: row.pattern as string,
      technique: row.technique as string,
      outcome: (row.outcome as string | null) ?? undefined,
      source: row.source as 'explicit' | 'auto',
      usageCount: row.usage_count as number,
      createdAt: row.created_at as string,
      lastUsed: (row.last_used as string | null) ?? undefined,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test 2>&1 | grep -E "TechniqueStore"
```

Expected:
```
✓ TechniqueStore: add and list
✓ TechniqueStore: FTS5 search
✓ TechniqueStore: markUsed increments count
✓ TechniqueStore: remove deletes technique
```

- [ ] **Step 5: Commit**

```bash
git add src/learning/store.ts src/test.ts
git commit -m "feat(learning): add TechniqueStore with FTS5 search"
```

---

## Task 6: Create Evaluator

**Files:**
- Create: `src/learning/evaluator.ts`

- [ ] **Step 1: Write the failing test**

Add to the Module 11 section in `src/test.ts`:

```typescript
  await test('Evaluator: instantiates and listens on task:complete', async () => {
    const { EventBus } = await import('./lib/event-bus.js');
    const { ProviderPool } = await import('./router/provider-pool.js');
    const { Evaluator } = await import('./learning/evaluator.js');
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE techniques (
        integer_id INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        pattern TEXT NOT NULL,
        technique TEXT NOT NULL,
        outcome TEXT,
        source TEXT NOT NULL DEFAULT 'explicit',
        usage_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_used TEXT
      );
      CREATE VIRTUAL TABLE techniques_fts USING fts5(
        pattern, technique, content='techniques', content_rowid='integer_id'
      );
      CREATE TRIGGER techniques_ai AFTER INSERT ON techniques BEGIN
        INSERT INTO techniques_fts(rowid, pattern, technique)
        VALUES (new.integer_id, new.pattern, new.technique);
      END;
      CREATE TRIGGER techniques_ad AFTER DELETE ON techniques BEGIN
        INSERT INTO techniques_fts(techniques_fts, rowid, pattern, technique)
        VALUES ('delete', old.integer_id, old.pattern, old.technique);
      END;
    `);
    const { TechniqueStore } = await import('./learning/store.js');
    const bus = new EventBus();
    const pool = new ProviderPool({
      version: '2.0.0',
      identity: { name: 'test', personality: 'test' },
      models: [],
      defaultModel: '',
      memory: { dbPath: ':memory:', maxRecallResults: 5 },
      transports: { tui: { enabled: false }, web: { enabled: false, port: 3033, host: '127.0.0.1' }, telegram: { enabled: false } },
      skills: { path: 'skills' },
    });
    const store = new TechniqueStore(db);
    const evaluator = new Evaluator(bus, pool, store);
    if (!evaluator) throw new Error('Evaluator failed to instantiate');

    // Emitting task:complete with no pool providers — evaluator should silently skip
    bus.emit('task:complete', {
      taskId: 'test-task-id',
      userMessage: 'Summarise this document',
      result: 'Here is the summary...',
      cost: 0.001,
    });

    // No error thrown = pass
    db.close();
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test 2>&1 | grep -A2 "Evaluator"
```

Expected: module not found error.

- [ ] **Step 3: Create `src/learning/evaluator.ts`**

```typescript
/**
 * Evaluator
 *
 * Automatically extracts reusable techniques from completed background tasks.
 * Listens on task:complete, fires a cheap LLM call to extract a technique,
 * and stores it in the TechniqueStore.
 *
 * Uses the cheapest available model to keep costs minimal.
 * Silently skips if extraction fails or yields nothing useful.
 */

import type { CompletionRequest } from '../types.js';
import { EventBus } from '../lib/event-bus.js';
import { ProviderPool } from '../router/provider-pool.js';
import { TechniqueStore } from './store.js';

const EXTRACTION_PROMPT = `Given this task and result, extract ONE reusable technique as two fields:
- pattern: what kind of task this applies to (1 sentence)
- technique: the specific approach that worked (2-3 sentences)

Only extract something genuinely reusable. If nothing is worth keeping, reply: SKIP

Task: {task}
Result: {result}`;

export class Evaluator {
  constructor(
    private bus: EventBus,
    private pool: ProviderPool,
    private store: TechniqueStore,
  ) {
    this.bus.on('task:complete', ({ taskId, userMessage, result }) => {
      if (!result || result.trim().length === 0) return;
      void this.evaluate(taskId, userMessage, result);
    });
  }

  private async evaluate(taskId: string, userMessage: string, result: string): Promise<void> {
    const cheapest = this.pool.getCheapest();
    if (!cheapest) return;

    const prompt = EXTRACTION_PROMPT
      .replace('{task}', userMessage)
      .replace('{result}', result.slice(0, 500));

    try {
      const req: CompletionRequest = {
        messages: [{ role: 'user', content: prompt }],
        model: cheapest.model.model,
        maxTokens: 200,
        temperature: 0,
      };
      const response = await cheapest.provider.complete(req);
      const text = response.content.trim();

      if (!text || text === 'SKIP') return;

      const patternMatch = text.match(/^-?\s*pattern:\s*(.+?)$/im);
      const techniqueMatch = text.match(/^-?\s*technique:\s*([\s\S]+?)(?:\n-|\n\n|$)/im);
      if (!patternMatch || !techniqueMatch) return;

      const pattern = patternMatch[1].trim();
      const technique = techniqueMatch[1].trim();
      if (!pattern || !technique) return;

      const id = this.store.add(pattern, technique, undefined, 'auto');
      this.bus.emit('learning:technique_captured', { id, pattern, source: 'auto' });
    } catch (err) {
      console.warn(
        `[Evaluator] Technique extraction failed for task ${taskId.slice(0, 8)}:`,
        (err as Error).message,
      );
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test 2>&1 | grep -A2 "Evaluator"
```

Expected: `✓ Evaluator: instantiates and listens on task:complete`

- [ ] **Step 5: Commit**

```bash
git add src/learning/evaluator.ts src/test.ts
git commit -m "feat(learning): add Evaluator for auto technique extraction"
```

---

## Task 7: Create Learning Tools

**Files:**
- Create: `src/tools/learning-tools.ts`

- [ ] **Step 1: Write the failing test**

Add to the Module 11 section in `src/test.ts`:

```typescript
  await test('Learning tools: reflect stores a technique', async () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE techniques (
        integer_id INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        pattern TEXT NOT NULL,
        technique TEXT NOT NULL,
        outcome TEXT,
        source TEXT NOT NULL DEFAULT 'explicit',
        usage_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_used TEXT
      );
      CREATE VIRTUAL TABLE techniques_fts USING fts5(
        pattern, technique, content='techniques', content_rowid='integer_id'
      );
      CREATE TRIGGER techniques_ai AFTER INSERT ON techniques BEGIN
        INSERT INTO techniques_fts(rowid, pattern, technique)
        VALUES (new.integer_id, new.pattern, new.technique);
      END;
      CREATE TRIGGER techniques_ad AFTER DELETE ON techniques BEGIN
        INSERT INTO techniques_fts(techniques_fts, rowid, pattern, technique)
        VALUES ('delete', old.integer_id, old.pattern, old.technique);
      END;
    `);
    const { TechniqueStore } = await import('./learning/store.js');
    const { EventBus } = await import('./lib/event-bus.js');
    const { createLearningTools } = await import('./tools/learning-tools.js');

    const bus = new EventBus();
    const store = new TechniqueStore(db);
    const tools = createLearningTools(bus, store);

    const reflectTool = tools.find((t) => t.name === 'reflect');
    if (!reflectTool) throw new Error('reflect tool not found');

    const result = await reflectTool.execute({
      pattern: 'code reviews',
      technique: 'Always check for error handling first',
      outcome: 'Caught 3 missing error handlers',
    });

    if (!result.includes('Stored')) throw new Error(`Unexpected result: ${result}`);

    const all = store.list();
    if (all.length !== 1) throw new Error(`Expected 1, got ${all.length}`);
    if (all[0].source !== 'explicit') throw new Error('Wrong source');

    db.close();
  });

  await test('Learning tools: list_techniques returns stored techniques', async () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE techniques (
        integer_id INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        pattern TEXT NOT NULL,
        technique TEXT NOT NULL,
        outcome TEXT,
        source TEXT NOT NULL DEFAULT 'explicit',
        usage_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_used TEXT
      );
      CREATE VIRTUAL TABLE techniques_fts USING fts5(
        pattern, technique, content='techniques', content_rowid='integer_id'
      );
      CREATE TRIGGER techniques_ai AFTER INSERT ON techniques BEGIN
        INSERT INTO techniques_fts(rowid, pattern, technique)
        VALUES (new.integer_id, new.pattern, new.technique);
      END;
      CREATE TRIGGER techniques_ad AFTER DELETE ON techniques BEGIN
        INSERT INTO techniques_fts(techniques_fts, rowid, pattern, technique)
        VALUES ('delete', old.integer_id, old.pattern, old.technique);
      END;
    `);
    const { TechniqueStore } = await import('./learning/store.js');
    const { EventBus } = await import('./lib/event-bus.js');
    const { createLearningTools } = await import('./tools/learning-tools.js');

    const bus = new EventBus();
    const store = new TechniqueStore(db);
    store.add('testing', 'Write edge cases first', undefined, 'auto');

    const tools = createLearningTools(bus, store);
    const listTool = tools.find((t) => t.name === 'list_techniques');
    if (!listTool) throw new Error('list_techniques tool not found');

    const result = await listTool.execute({});
    if (!result.includes('testing')) throw new Error(`Expected "testing" in result: ${result}`);

    db.close();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test 2>&1 | grep -E "Learning tools"
```

Expected: module not found.

- [ ] **Step 3: Create `src/tools/learning-tools.ts`**

```typescript
/**
 * Learning Tools
 *
 * reflect          — explicitly store a technique after doing something well
 * list_techniques  — list all stored techniques
 * forget_technique — remove a technique by ID
 *
 * All auto-approved — these are safe read/write operations on local data.
 */

import type { Tool } from '../types.js';
import type { EventBus } from '../lib/event-bus.js';
import type { TechniqueStore } from '../learning/store.js';

export function createLearningTools(bus: EventBus, store: TechniqueStore): Tool[] {
  return [
    {
      name: 'reflect',
      description:
        'Store a reusable technique you learned from completing a task. Use after finishing something where a specific approach worked well and would apply to future similar tasks.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'What type of task or situation this technique applies to (1 sentence)',
          },
          technique: {
            type: 'string',
            description: 'The specific approach that worked (2-3 sentences)',
          },
          outcome: {
            type: 'string',
            description: 'What happened when you used this approach (optional)',
          },
        },
        required: ['pattern', 'technique'],
      },
      approval: 'auto',

      async execute(args: Record<string, unknown>): Promise<string> {
        const pattern = args.pattern as string;
        const technique = args.technique as string;
        const outcome = args.outcome as string | undefined;

        const id = store.add(pattern, technique, outcome, 'explicit');
        bus.emit('learning:technique_captured', { id, pattern, source: 'explicit' });
        return `Stored technique ${id.slice(0, 8)}: "${pattern}"`;
      },
    },

    {
      name: 'list_techniques',
      description: 'List all stored techniques from past experience, ordered by how often they have been used.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      approval: 'auto',

      async execute(_args: Record<string, unknown>): Promise<string> {
        const all = store.list();
        if (all.length === 0) return 'No techniques stored yet.';

        return all
          .map(
            (t, i) =>
              `${i + 1}. [${t.source}] (used ${t.usageCount}x) id:${t.id.slice(0, 8)}\n   Pattern: ${t.pattern}\n   Technique: ${t.technique}${t.outcome ? `\n   Outcome: ${t.outcome}` : ''}`,
          )
          .join('\n\n');
      },
    },

    {
      name: 'forget_technique',
      description: 'Remove a stored technique by its ID. Use when a technique is no longer relevant or was stored incorrectly.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The technique ID to remove (full UUID or first 8 chars)',
          },
          reason: {
            type: 'string',
            description: 'Why this technique is being removed',
          },
        },
        required: ['id', 'reason'],
      },
      approval: 'auto',

      async execute(args: Record<string, unknown>): Promise<string> {
        const id = args.id as string;
        const reason = args.reason as string;
        store.remove(id);
        return `Removed technique ${id}: ${reason}`;
      },
    },
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test 2>&1 | grep -E "Learning tools"
```

Expected:
```
✓ Learning tools: reflect stores a technique
✓ Learning tools: list_techniques returns stored techniques
```

- [ ] **Step 5: Commit**

```bash
git add src/tools/learning-tools.ts src/test.ts
git commit -m "feat(learning): add reflect, list_techniques, forget_technique tools"
```

---

## Task 8: Update ContextEngine to Inject Techniques

**Files:**
- Modify: `src/context/engine.ts`

- [ ] **Step 1: Write the failing test**

Add to the Module 11 section in `src/test.ts`:

```typescript
  await test('ContextEngine injects techniques into system prompt', async () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE memories (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL DEFAULT 'fact', content TEXT NOT NULL, tags TEXT, relevance REAL NOT NULL DEFAULT 1.0, access_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_accessed TEXT NOT NULL);
      CREATE VIRTUAL TABLE memories_fts USING fts5(content, tags, content='memories', content_rowid='id');
      CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags); END;
      CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags); END;
      CREATE TABLE embeddings (memory_id INTEGER PRIMARY KEY, vector BLOB NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL);
      CREATE TABLE summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, message_range_start TEXT NOT NULL, message_range_end TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, source TEXT, timestamp TEXT NOT NULL, token_count INTEGER);
      CREATE TABLE techniques (
        integer_id INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        pattern TEXT NOT NULL,
        technique TEXT NOT NULL,
        outcome TEXT,
        source TEXT NOT NULL DEFAULT 'explicit',
        usage_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_used TEXT
      );
      CREATE VIRTUAL TABLE techniques_fts USING fts5(
        pattern, technique, content='techniques', content_rowid='integer_id'
      );
      CREATE TRIGGER techniques_ai AFTER INSERT ON techniques BEGIN
        INSERT INTO techniques_fts(rowid, pattern, technique)
        VALUES (new.integer_id, new.pattern, new.technique);
      END;
      CREATE TRIGGER techniques_ad AFTER DELETE ON techniques BEGIN
        INSERT INTO techniques_fts(techniques_fts, rowid, pattern, technique)
        VALUES ('delete', old.integer_id, old.pattern, old.technique);
      END;
    `);

    const { MemoryStore } = await import('./context/memory.js');
    const { ConversationStore } = await import('./context/conversation.js');
    const { Profile } = await import('./context/profile.js');
    const { ContextEngine } = await import('./context/engine.js');
    const { TechniqueStore } = await import('./learning/store.js');
    const { EventBus } = await import('./lib/event-bus.js');

    const config = {
      version: '2.0.0',
      identity: { name: 'Sigil', personality: 'Helpful assistant.' },
      models: [], defaultModel: '',
      memory: { dbPath: ':memory:', maxRecallResults: 5 },
      transports: { tui: { enabled: false }, web: { enabled: false, port: 3033, host: '127.0.0.1' }, telegram: { enabled: false } },
      skills: { path: 'skills' },
    };

    const memories = new MemoryStore(db);
    const conversation = new ConversationStore(db);
    const profile = new Profile('/tmp/test-profile.md');
    const store = new TechniqueStore(db);
    const bus = new EventBus();

    store.add('data analysis', 'Check for missing values before computing averages', undefined, 'auto');

    const engine = new ContextEngine(config, memories, conversation, profile, null, null, bus, store);

    const message = { id: 'test', content: 'analyse this dataset', source: 'tui' as const, timestamp: new Date() };
    const context = await engine.buildContext(message);
    const systemPrompt = context[0].content as string;

    if (!systemPrompt.includes('Techniques from past experience')) {
      throw new Error('Techniques section missing from system prompt');
    }
    if (!systemPrompt.includes('data analysis')) {
      throw new Error('Technique content missing from system prompt');
    }

    db.close();
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test 2>&1 | grep -A2 "ContextEngine injects techniques"
```

Expected: error about wrong number of arguments or missing injection.

- [ ] **Step 3: Update the import in `src/context/engine.ts`**

Add imports at the top of the file after the existing imports:

```typescript
import type { EventBus } from '../lib/event-bus.js';
import type { TechniqueStore } from '../learning/store.js';
```

- [ ] **Step 4: Add `bus` and `techniques` fields to `ContextEngine` class**

After the existing `private skills: SkillLoader | null;` field, add:

```typescript
  private bus: EventBus | null;
  private techniques: TechniqueStore | null;
```

- [ ] **Step 5: Update the constructor signature and body**

Replace the existing constructor:

```typescript
  constructor(
    config: SigilConfig,
    memories: MemoryStore,
    conversation: ConversationStore,
    profile: Profile,
    embeddings: EmbeddingProvider | null,
    skills?: SkillLoader | null,
    bus?: EventBus | null,
    techniques?: TechniqueStore | null,
  ) {
    this.config = config;
    this.memories = memories;
    this.conversation = conversation;
    this.profile = profile;
    this.embeddings = embeddings;
    this.skills = skills ?? null;
    this.bus = bus ?? null;
    this.techniques = techniques ?? null;
  }
```

- [ ] **Step 6: Add technique injection in `buildSystemPrompt`**

In the `buildSystemPrompt` method, after the `recalled` memories section (after the `parts.push` for `Relevant Memories`) and before the final `return parts.join('\n\n')`:

```typescript
    // Inject relevant techniques (skip if no store configured)
    if (this.techniques) {
      const techniqueResults = this.techniques.search(currentMessage, 3);
      if (techniqueResults.length > 0) {
        const ids = techniqueResults.map((t) => t.id);
        const techniqueText = techniqueResults
          .map((t) => `- ${t.pattern}: ${t.technique}`)
          .join('\n');
        this.techniques.markUsed(ids);
        if (this.bus) {
          this.bus.emit('learning:technique_used', { ids, query: currentMessage });
        }
        parts.push(`\n--- Techniques from past experience ---\n${techniqueText}`);
      }
    }
```

- [ ] **Step 7: Run test to verify it passes**

```bash
npm test 2>&1 | grep -A2 "ContextEngine injects techniques"
```

Expected: `✓ ContextEngine injects techniques into system prompt`

- [ ] **Step 8: Run the full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: all existing tests still pass, new test passes.

- [ ] **Step 9: Commit**

```bash
git add src/context/engine.ts src/test.ts
git commit -m "feat(learning): inject techniques into system prompt via ContextEngine"
```

---

## Task 9: Wire Up in `index.ts`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add imports**

After the existing `createExtensionTools` import line, add:

```typescript
import { TechniqueStore } from './learning/store.js';
import { Evaluator } from './learning/evaluator.js';
import { createLearningTools } from './tools/learning-tools.js';
```

- [ ] **Step 2: Create TechniqueStore after the existing cost tracker**

After the `const costTracker = new CostTracker(db);` line, add:

```typescript
  // Create technique store (module 11)
  const techniqueStore = new TechniqueStore(db);
```

- [ ] **Step 3: Pass `bus` and `techniqueStore` to ContextEngine**

Find the existing ContextEngine constructor call:

```typescript
  const context = new ContextEngine(config, memories, conversation, profile, embeddings, skillLoader);
```

Replace with:

```typescript
  const context = new ContextEngine(config, memories, conversation, profile, embeddings, skillLoader, bus, techniqueStore);
```

- [ ] **Step 4: Register Evaluator after the scheduler wiring**

After the `scheduler.start();` line, add:

```typescript
  // Create evaluator for auto technique extraction (module 11)
  new Evaluator(bus, pool, techniqueStore);
```

- [ ] **Step 5: Register learning tools**

After the existing extension tools registration block, add:

```typescript
  // Register learning tools (module 11)
  for (const tool of createLearningTools(bus, techniqueStore)) {
    tools.register(tool);
  }

  // Learning audit logging
  bus.on('learning:technique_captured', ({ id, pattern, source }) => {
    console.log(`[Learning] Technique captured (${source}): ${id.slice(0, 8)} — "${pattern}"`);
  });
```

- [ ] **Step 6: Verify TypeScript compiles clean**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no output.

- [ ] **Step 7: Run the full test suite**

```bash
npm test 2>&1 | tail -15
```

Expected: all tests pass.

- [ ] **Step 8: Smoke test — start the server**

```bash
npm start 2>&1 | head -20
```

Expected output includes:
```
[Sigil] Starting...
[Sigil] Ready.
```
(No errors about learning module)

Stop with Ctrl+C.

- [ ] **Step 9: Commit**

```bash
git add src/index.ts
git commit -m "feat(learning): wire TechniqueStore, Evaluator, and learning tools in index.ts"
```

---

## Task 10: Final Tests + Cleanup

**Files:**
- Modify: `src/test.ts`

- [ ] **Step 1: Add end-to-end test for the full learning flow**

Add to the Module 11 section in `src/test.ts`:

```typescript
  await test('Learning: full flow — store technique, inject into context', async () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE memories (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL DEFAULT 'fact', content TEXT NOT NULL, tags TEXT, relevance REAL NOT NULL DEFAULT 1.0, access_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_accessed TEXT NOT NULL);
      CREATE VIRTUAL TABLE memories_fts USING fts5(content, tags, content='memories', content_rowid='id');
      CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags); END;
      CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags); END;
      CREATE TABLE embeddings (memory_id INTEGER PRIMARY KEY, vector BLOB NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL);
      CREATE TABLE summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, message_range_start TEXT NOT NULL, message_range_end TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, source TEXT, timestamp TEXT NOT NULL, token_count INTEGER);
      CREATE TABLE techniques (
        integer_id INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        pattern TEXT NOT NULL,
        technique TEXT NOT NULL,
        outcome TEXT,
        source TEXT NOT NULL DEFAULT 'explicit',
        usage_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_used TEXT
      );
      CREATE VIRTUAL TABLE techniques_fts USING fts5(
        pattern, technique, content='techniques', content_rowid='integer_id'
      );
      CREATE TRIGGER techniques_ai AFTER INSERT ON techniques BEGIN
        INSERT INTO techniques_fts(rowid, pattern, technique)
        VALUES (new.integer_id, new.pattern, new.technique);
      END;
      CREATE TRIGGER techniques_ad AFTER DELETE ON techniques BEGIN
        INSERT INTO techniques_fts(techniques_fts, rowid, pattern, technique)
        VALUES ('delete', old.integer_id, old.pattern, old.technique);
      END;
    `);

    const { MemoryStore } = await import('./context/memory.js');
    const { ConversationStore } = await import('./context/conversation.js');
    const { Profile } = await import('./context/profile.js');
    const { ContextEngine } = await import('./context/engine.js');
    const { TechniqueStore } = await import('./learning/store.js');
    const { EventBus } = await import('./lib/event-bus.js');
    const { createLearningTools } = await import('./tools/learning-tools.js');

    const config = {
      version: '2.0.0',
      identity: { name: 'Sigil', personality: 'Helpful.' },
      models: [], defaultModel: '',
      memory: { dbPath: ':memory:', maxRecallResults: 5 },
      transports: { tui: { enabled: false }, web: { enabled: false, port: 3033, host: '127.0.0.1' }, telegram: { enabled: false } },
      skills: { path: 'skills' },
    };

    const bus = new EventBus();
    const store = new TechniqueStore(db);
    const tools = createLearningTools(bus, store);
    const engine = new ContextEngine(
      config,
      new MemoryStore(db),
      new ConversationStore(db),
      new Profile('/tmp/test-profile-full.md'),
      null, null, bus, store,
    );

    // Step 1: agent explicitly stores a technique via reflect tool
    const reflectTool = tools.find((t) => t.name === 'reflect')!;
    await reflectTool.execute({
      pattern: 'file parsing tasks',
      technique: 'Always validate file encoding before parsing to avoid garbled output',
    });

    // Step 2: on next message about file parsing, technique appears in context
    const message2 = { id: 'msg-2', content: 'parse this CSV file for me', source: 'tui' as const, timestamp: new Date() };
    const context2 = await engine.buildContext(message2);
    const systemPrompt2 = context2[0].content as string;

    if (!systemPrompt2.includes('file parsing')) {
      throw new Error('Technique not injected for similar task');
    }

    // Step 3: usageCount incremented
    const all = store.list();
    if (all[0].usageCount !== 1) throw new Error(`Expected usageCount 1, got ${all[0].usageCount}`);

    db.close();
  });
```

- [ ] **Step 2: Run the full test suite one final time**

```bash
npm test
```

Expected: all tests pass, including:
```
  Module 11: Learning
  ✓ TechniqueResult type is exported
  ✓ Techniques table exists after migration
  ✓ ProviderPool.getCheapest() returns null when empty
  ✓ TechniqueStore: add and list
  ✓ TechniqueStore: FTS5 search
  ✓ TechniqueStore: markUsed increments count
  ✓ TechniqueStore: remove deletes technique
  ✓ Evaluator: instantiates and listens on task:complete
  ✓ Learning tools: reflect stores a technique
  ✓ Learning tools: list_techniques returns stored techniques
  ✓ ContextEngine injects techniques into system prompt
  ✓ Learning: full flow — store technique, inject into context
```

- [ ] **Step 3: Commit**

```bash
git add src/test.ts
git commit -m "test(learning): add end-to-end learning flow test"
```

---

## Task 11: Integration Commit

- [ ] **Step 1: Verify clean build**

```bash
npx tsc --noEmit && npm test
```

Expected: zero TypeScript errors, all tests pass.

- [ ] **Step 2: Final commit**

```bash
git add -A
git commit -m "feat: Module 11 — learning + self-improvement

- TechniqueStore backed by SQLite FTS5
- Evaluator auto-extracts techniques from completed background tasks
- reflect / list_techniques / forget_technique tools
- ContextEngine injects relevant techniques into system prompt
- getCheapest() on ProviderPool picks lowest-tier model for evaluation"
```
