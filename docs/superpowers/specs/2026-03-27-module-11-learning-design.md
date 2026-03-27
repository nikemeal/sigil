# Module 11: Learning + Self-Improvement — Design Spec

**Date:** 2026-03-27
**Status:** Approved

---

## Overview

The agent learns from completed tasks and applies that knowledge to future similar tasks. Two capture paths: explicit (agent uses `reflect` tool) and automatic (evaluator fires after every background task completes). Techniques are retrieved via FTS5 search and injected into the system prompt alongside memories.

**Test:** Same task twice — the second run references a stored technique from the first.

---

## Data Model

### SQLite table: `techniques`

| field | type | notes |
|---|---|---|
| `id` | TEXT PK | UUID |
| `pattern` | TEXT | what type of task/situation this applies to |
| `technique` | TEXT | the approach that worked |
| `outcome` | TEXT | nullable — what happened (optional) |
| `source` | TEXT | `'explicit'` or `'auto'` |
| `usageCount` | INTEGER | incremented on each context injection |
| `createdAt` | TEXT | ISO timestamp |
| `lastUsed` | TEXT | nullable — when last retrieved |

FTS5 virtual table indexed on `pattern + technique` for keyword search, matching the existing memory store pattern.

---

## Components

### `src/learning/store.ts` — TechniqueStore

SQLite-backed store. Methods:

- `add(pattern, technique, outcome?, source)` → `id`
- `search(query, limit)` → `TechniqueResult[]`
- `markUsed(id)` → updates `usageCount` and `lastUsed`
- `list()` → all techniques ordered by `usageCount desc`
- `remove(id)` → delete

### `src/learning/evaluator.ts` — Evaluator

Listens on `task:complete`. For each completed task (status `complete`, non-empty result):

1. Picks cheapest available model (`basic` tier preferred, fallback to any)
2. Fires a single LLM call with this prompt:

```
Given this task and result, extract ONE reusable technique as two fields:
- pattern: what kind of task this applies to (1 sentence)
- technique: the specific approach that worked (2-3 sentences)

Only extract something genuinely reusable. If nothing is worth keeping, reply: SKIP

Task: <userMessage>
Result: <result, first 500 chars>
```

3. If model returns `SKIP` or malformed output → nothing stored, no error
4. Otherwise stores with `source: 'auto'`, emits `learning:technique_captured`
5. If LLM call fails → logs warning, never blocks task completion

### `src/tools/learning-tools.ts` — Learning Tools

Three tools registered at startup:

**`reflect`**
- Args: `pattern` (string), `technique` (string), `outcome` (string, optional)
- Stores with `source: 'explicit'`
- Returns stored ID
- Approval: `auto`

**`list_techniques`**
- No args
- Returns all techniques: ID, pattern snippet, source, usage count
- Approval: `auto`

**`forget_technique`**
- Args: `id` (string), `reason` (string)
- Removes technique by ID
- Approval: `auto`

### `ContextEngine` — Technique Injection

`TechniqueStore` added as nullable constructor parameter (after `SkillLoader`).

In `buildSystemPrompt`, when `includeMemories` is true and techniques store is present:
- Searches store with current message content, limit 3
- Calls `markUsed` on each result
- Injects into system prompt as:

```
## Techniques from past experience
- [pattern]: [technique]
```

Emits `learning:technique_used` with injected IDs and query.

---

## Event Bus Additions

`TechniqueResult` interface (added to `types.ts`):

```typescript
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

Two new events added to `EventMap` in `types.ts`:

```typescript
'learning:technique_captured': { id: string; pattern: string; source: 'auto' | 'explicit' }
'learning:technique_used': { ids: string[]; query: string }
```

---

## Wiring (`index.ts`)

In order, after the existing task system wiring:

1. `const techniqueStore = new TechniqueStore(db)`
2. `new Evaluator(bus, pool, techniqueStore)` — starts listening immediately
3. Pass `techniqueStore` to `ContextEngine` constructor
4. `createLearningTools(techniqueStore)` → register each tool
5. Audit log `learning:technique_captured` to console

---

## File Map

```
src/learning/
  store.ts          ← TechniqueStore
  evaluator.ts      ← auto-evaluates task:complete, stores techniques
src/tools/
  learning-tools.ts ← reflect, list_techniques, forget_technique
src/types.ts        ← two new events, TechniqueResult type
src/context/engine.ts ← accepts TechniqueStore, injects into system prompt
src/index.ts        ← wires everything together
```

---

## Design Principles Applied

- Techniques are procedural knowledge ("how to do X"), kept separate from factual memories ("user's birthday is May 15")
- Auto-eval uses cheapest available model — never burns expensive tokens on reflection
- SKIP path ensures noise-free store — bad LLM output is silently dropped
- `ContextEngine` injection is conditional on `includeMemories` — techniques don't bleed into casual chat requests
- All writes go through the store — nothing is written ad-hoc
