/**
 * Task Store
 *
 * SQLite-backed persistence for background tasks and their steps.
 * Tasks are created by the gateway, executed by the runner,
 * and managed by the scheduler.
 */
import type Database from 'better-sqlite3';
import type { Task, TaskStep, TaskStatus } from '../types.js';
export declare class TaskStore {
    private db;
    constructor(db: Database.Database);
    /** Create a new task in queued state */
    create(userMessage: string, source: string): Task;
    /** Get a task with all its steps */
    get(taskId: string): Task | null;
    /** List tasks, optionally filtered by status */
    list(status?: TaskStatus): Task[];
    /** Update task status */
    updateStatus(taskId: string, status: TaskStatus): void;
    /** Set the task result */
    setResult(taskId: string, result: string): void;
    /** Add a step to a task */
    addStep(taskId: string, stepNumber: number, description: string, assignedModel: string, assignedTier: string): TaskStep;
    /** Update a step's result and token usage */
    completeStep(stepId: number, result: string, inputTokens: number, outputTokens: number, cost: number): void;
    /** Mark a step as running */
    startStep(stepId: number): void;
    /** Mark a step as error */
    failStep(stepId: number, error: string): void;
    /** Recalculate task totals from steps */
    updateTotals(taskId: string): void;
}
//# sourceMappingURL=store.d.ts.map