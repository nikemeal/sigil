/**
 * Task Store
 *
 * SQLite-backed persistence for background tasks and their steps.
 * Tasks are created by the gateway, executed by the runner,
 * and managed by the scheduler.
 */
import { randomUUID } from 'node:crypto';
export class TaskStore {
    db;
    constructor(db) {
        this.db = db;
    }
    /** Create a new task in queued state */
    create(userMessage, source) {
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
    get(taskId) {
        const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
        if (!row)
            return null;
        const stepRows = this.db.prepare('SELECT * FROM task_steps WHERE task_id = ? ORDER BY step_number').all(taskId);
        return {
            id: row.id,
            userMessage: row.user_message,
            status: row.status,
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
    list(status) {
        const query = status
            ? 'SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC'
            : 'SELECT * FROM tasks ORDER BY created_at DESC';
        const rows = (status
            ? this.db.prepare(query).all(status)
            : this.db.prepare(query).all());
        return rows.map((row) => ({
            id: row.id,
            userMessage: row.user_message,
            status: row.status,
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
    updateStatus(taskId, status) {
        const updates = { status };
        if (status === 'running') {
            updates.started_at = new Date().toISOString();
        }
        else if (status === 'complete' || status === 'error') {
            updates.completed_at = new Date().toISOString();
        }
        const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
        this.db.prepare(`UPDATE tasks SET ${setClauses} WHERE id = ?`)
            .run(...Object.values(updates), taskId);
    }
    /** Set the task result */
    setResult(taskId, result) {
        this.db.prepare('UPDATE tasks SET result = ? WHERE id = ?').run(result, taskId);
    }
    /** Add a step to a task */
    addStep(taskId, stepNumber, description, assignedModel, assignedTier) {
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
    completeStep(stepId, result, inputTokens, outputTokens, cost) {
        this.db.prepare(`
      UPDATE task_steps SET status = 'complete', result = ?,
        input_tokens = ?, output_tokens = ?, cost = ?, completed_at = ?
      WHERE id = ?
    `).run(result, inputTokens, outputTokens, cost, new Date().toISOString(), stepId);
    }
    /** Mark a step as running */
    startStep(stepId) {
        this.db.prepare(`
      UPDATE task_steps SET status = 'running', started_at = ? WHERE id = ?
    `).run(new Date().toISOString(), stepId);
    }
    /** Mark a step as error */
    failStep(stepId, error) {
        this.db.prepare(`
      UPDATE task_steps SET status = 'error', result = ?, completed_at = ? WHERE id = ?
    `).run(error, new Date().toISOString(), stepId);
    }
    /** Recalculate task totals from steps */
    updateTotals(taskId) {
        this.db.prepare(`
      UPDATE tasks SET
        total_cost = (SELECT COALESCE(SUM(cost), 0) FROM task_steps WHERE task_id = ?),
        total_tokens = (SELECT COALESCE(SUM(input_tokens + output_tokens), 0) FROM task_steps WHERE task_id = ?)
      WHERE id = ?
    `).run(taskId, taskId, taskId);
    }
}
function toTaskStep(row) {
    return {
        id: row.id,
        taskId: row.task_id,
        stepNumber: row.step_number,
        description: row.description,
        assignedModel: row.assigned_model,
        assignedTier: row.assigned_tier,
        status: row.status,
        result: row.result ?? undefined,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        cost: row.cost,
    };
}
//# sourceMappingURL=store.js.map