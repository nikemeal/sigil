/**
 * Task Store
 *
 * SQLite-backed persistence for background tasks and their steps.
 * Tasks are created by the gateway, executed by the runner,
 * and managed by the scheduler.
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Task, TaskStep, TaskStatus } from '../types.js';

export class TaskStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Create a new task in queued state */
  create(userMessage: string, source: string): Task {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO tasks (id, user_message, status, source, created_at)
      VALUES (?, ?, 'queued', ?, ?)
    `).run(id, userMessage, source, now);

    return {
      id,
      userMessage,
      status: 'queued',
      createdAt: new Date(now),
      totalCost: 0,
      totalTokens: 0,
      source,
      steps: [],
    };
  }

  /** Get a task with all its steps */
  get(taskId: string): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
    if (!row) return null;

    const stepRows = this.db.prepare(
      'SELECT * FROM task_steps WHERE task_id = ? ORDER BY step_number'
    ).all(taskId) as StepRow[];

    return {
      id: row.id,
      userMessage: row.user_message,
      status: row.status as TaskStatus,
      result: row.result ?? undefined,
      createdAt: new Date(row.created_at),
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      totalCost: row.total_cost,
      totalTokens: row.total_tokens,
      source: row.source,
      steps: stepRows.map(toTaskStep),
    };
  }

  /** List tasks, optionally filtered by status */
  list(status?: TaskStatus): Task[] {
    const query = status
      ? 'SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC'
      : 'SELECT * FROM tasks ORDER BY created_at DESC';
    const rows = (status
      ? this.db.prepare(query).all(status)
      : this.db.prepare(query).all()) as TaskRow[];

    return rows.map((row) => ({
      id: row.id,
      userMessage: row.user_message,
      status: row.status as TaskStatus,
      result: row.result ?? undefined,
      createdAt: new Date(row.created_at),
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      totalCost: row.total_cost,
      totalTokens: row.total_tokens,
      source: row.source,
      steps: [],
    }));
  }

  /** Update task status */
  updateStatus(taskId: string, status: TaskStatus): void {
    const updates: Record<string, string | null> = { status };

    if (status === 'running') {
      updates.started_at = new Date().toISOString();
    } else if (status === 'complete' || status === 'error') {
      updates.completed_at = new Date().toISOString();
    }

    const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
    this.db.prepare(`UPDATE tasks SET ${setClauses} WHERE id = ?`)
      .run(...Object.values(updates), taskId);
  }

  /** Set the task result */
  setResult(taskId: string, result: string): void {
    this.db.prepare('UPDATE tasks SET result = ? WHERE id = ?').run(result, taskId);
  }

  /** Add a step to a task */
  addStep(taskId: string, stepNumber: number, description: string, assignedModel: string, assignedTier: string): TaskStep {
    const result = this.db.prepare(`
      INSERT INTO task_steps (task_id, step_number, description, assigned_model, assigned_tier, status)
      VALUES (?, ?, ?, ?, ?, 'queued')
    `).run(taskId, stepNumber, description, assignedModel, assignedTier);

    return {
      id: Number(result.lastInsertRowid),
      taskId,
      stepNumber,
      description,
      assignedModel,
      assignedTier,
      status: 'queued',
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
    };
  }

  /** Update a step's result and token usage */
  completeStep(stepId: number, result: string, inputTokens: number, outputTokens: number, cost: number): void {
    this.db.prepare(`
      UPDATE task_steps SET status = 'complete', result = ?,
        input_tokens = ?, output_tokens = ?, cost = ?, completed_at = ?
      WHERE id = ?
    `).run(result, inputTokens, outputTokens, cost, new Date().toISOString(), stepId);
  }

  /** Mark a step as running */
  startStep(stepId: number): void {
    this.db.prepare(`
      UPDATE task_steps SET status = 'running', started_at = ? WHERE id = ?
    `).run(new Date().toISOString(), stepId);
  }

  /** Mark a step as error */
  failStep(stepId: number, error: string): void {
    this.db.prepare(`
      UPDATE task_steps SET status = 'error', result = ?, completed_at = ? WHERE id = ?
    `).run(error, new Date().toISOString(), stepId);
  }

  /** Recalculate task totals from steps */
  updateTotals(taskId: string): void {
    this.db.prepare(`
      UPDATE tasks SET
        total_cost = (SELECT COALESCE(SUM(cost), 0) FROM task_steps WHERE task_id = ?),
        total_tokens = (SELECT COALESCE(SUM(input_tokens + output_tokens), 0) FROM task_steps WHERE task_id = ?)
      WHERE id = ?
    `).run(taskId, taskId, taskId);
  }
}

// -- Row types for SQLite results --

interface TaskRow {
  id: string;
  user_message: string;
  status: string;
  result: string | null;
  source: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  total_cost: number;
  total_tokens: number;
}

interface StepRow {
  id: number;
  task_id: string;
  step_number: number;
  description: string;
  assigned_model: string;
  assigned_tier: string;
  status: string;
  result: string | null;
  input_tokens: number;
  output_tokens: number;
  cost: number;
  started_at: string | null;
  completed_at: string | null;
}

function toTaskStep(row: StepRow): TaskStep {
  return {
    id: row.id,
    taskId: row.task_id,
    stepNumber: row.step_number,
    description: row.description,
    assignedModel: row.assigned_model,
    assignedTier: row.assigned_tier,
    status: row.status as TaskStatus,
    result: row.result ?? undefined,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cost: row.cost,
  };
}
