import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { Transport } from '../gateway/types.js';

// ── Task types ──────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';

export interface TaskStep {
  id: string;
  description: string;
  status: TaskStatus;
  result?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface Task {
  id: string;
  /** What the user originally asked for */
  objective: string;
  /** Current status */
  status: TaskStatus;
  /** Where to send updates / final result */
  replyTransport: Transport;
  /** Thread to reply into */
  replyThreadId?: string;
  /** Planned steps the agent broke the work into */
  steps: TaskStep[];
  /** Current step index */
  currentStep: number;
  /** Intermediate context the agent accumulates as it works */
  workingMemory: string;
  /** Cron expression if this task repeats */
  schedule?: string;
  /** When to next run (ISO string) — for one-shot delayed tasks */
  runAt?: string;
  /** Max retries on failure */
  maxRetries: number;
  retryCount: number;
  /** Timestamps */
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

// ── TaskStore ───────────────────────────────────────────────────────

/**
 * Persistent task store backed by SQLite.
 * Tasks survive restarts — the scheduler picks them back up.
 */
export class TaskStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        objective TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        reply_transport TEXT NOT NULL DEFAULT 'tui',
        reply_thread_id TEXT,
        steps TEXT NOT NULL DEFAULT '[]',
        current_step INTEGER NOT NULL DEFAULT 0,
        working_memory TEXT NOT NULL DEFAULT '',
        schedule TEXT,
        run_at TEXT,
        max_retries INTEGER NOT NULL DEFAULT 2,
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_run_at ON tasks(run_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_schedule ON tasks(schedule);
    `);
  }

  create(params: {
    objective: string;
    replyTransport: Transport;
    replyThreadId?: string;
    steps?: TaskStep[];
    schedule?: string;
    runAt?: string;
  }): Task {
    const task: Task = {
      id: randomUUID(),
      objective: params.objective,
      status: 'pending',
      replyTransport: params.replyTransport,
      replyThreadId: params.replyThreadId,
      steps: params.steps ?? [],
      currentStep: 0,
      workingMemory: '',
      schedule: params.schedule,
      runAt: params.runAt,
      maxRetries: 2,
      retryCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.db.prepare(`
      INSERT INTO tasks (id, objective, status, reply_transport, reply_thread_id,
        steps, current_step, working_memory, schedule, run_at,
        max_retries, retry_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id, task.objective, task.status, task.replyTransport,
      task.replyThreadId ?? null, JSON.stringify(task.steps), task.currentStep,
      task.workingMemory, task.schedule ?? null, task.runAt ?? null,
      task.maxRetries, task.retryCount, task.createdAt, task.updatedAt,
    );

    return task;
  }

  get(id: string): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToTask(row) : null;
  }

  update(id: string, updates: Partial<Pick<Task,
    'status' | 'steps' | 'currentStep' | 'workingMemory' |
    'schedule' | 'runAt' | 'retryCount' | 'completedAt'
  >>): void {
    const sets: string[] = ['updated_at = datetime(\'now\')'];
    const values: unknown[] = [];

    if (updates.status !== undefined) { sets.push('status = ?'); values.push(updates.status); }
    if (updates.steps !== undefined) { sets.push('steps = ?'); values.push(JSON.stringify(updates.steps)); }
    if (updates.currentStep !== undefined) { sets.push('current_step = ?'); values.push(updates.currentStep); }
    if (updates.workingMemory !== undefined) { sets.push('working_memory = ?'); values.push(updates.workingMemory); }
    if (updates.schedule !== undefined) { sets.push('schedule = ?'); values.push(updates.schedule); }
    if (updates.runAt !== undefined) { sets.push('run_at = ?'); values.push(updates.runAt); }
    if (updates.retryCount !== undefined) { sets.push('retry_count = ?'); values.push(updates.retryCount); }
    if (updates.completedAt !== undefined) { sets.push('completed_at = ?'); values.push(updates.completedAt); }

    values.push(id);
    this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  /** Get tasks that are due to run now */
  getDueTasks(): Task[] {
    const now = new Date().toISOString();
    const rows = this.db.prepare(`
      SELECT * FROM tasks
      WHERE status IN ('pending', 'waiting')
        AND (run_at IS NOT NULL AND run_at <= ?)
      ORDER BY run_at ASC
    `).all(now) as Array<Record<string, unknown>>;

    return rows.map(r => this.rowToTask(r));
  }

  /** Get recurring tasks that should fire based on their cron schedule */
  getScheduledTasks(): Task[] {
    const rows = this.db.prepare(`
      SELECT * FROM tasks
      WHERE status IN ('pending', 'waiting')
        AND schedule IS NOT NULL
    `).all() as Array<Record<string, unknown>>;

    return rows.map(r => this.rowToTask(r));
  }

  /** Get active (non-terminal) tasks */
  getActiveTasks(): Task[] {
    const rows = this.db.prepare(`
      SELECT * FROM tasks
      WHERE status NOT IN ('completed', 'failed', 'cancelled')
      ORDER BY created_at DESC
    `).all() as Array<Record<string, unknown>>;

    return rows.map(r => this.rowToTask(r));
  }

  /** Get all tasks (for listing) */
  list(limit = 20): Task[] {
    const rows = this.db.prepare(`
      SELECT * FROM tasks ORDER BY updated_at DESC LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;

    return rows.map(r => this.rowToTask(r));
  }

  private rowToTask(row: Record<string, unknown>): Task {
    return {
      id: row.id as string,
      objective: row.objective as string,
      status: row.status as TaskStatus,
      replyTransport: row.reply_transport as Transport,
      replyThreadId: row.reply_thread_id as string | undefined,
      steps: JSON.parse(row.steps as string),
      currentStep: row.current_step as number,
      workingMemory: row.working_memory as string,
      schedule: row.schedule as string | undefined,
      runAt: row.run_at as string | undefined,
      maxRetries: row.max_retries as number,
      retryCount: row.retry_count as number,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      completedAt: row.completed_at as string | undefined,
    };
  }
}
