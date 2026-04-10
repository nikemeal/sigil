/**
 * Task Scheduler
 *
 * Manages the background task queue. Processes one task at a time.
 * On error, retries up to 2 times with backoff.
 */
import { EventBus } from '../lib/event-bus.js';
import { TaskRunner } from './runner.js';
import { TaskStore } from './store.js';
export declare class Scheduler {
    private bus;
    private runner;
    private store;
    private queue;
    private running;
    private processing;
    private retries;
    constructor(bus: EventBus, runner: TaskRunner, store: TaskStore);
    /** Start processing the queue */
    start(): void;
    /** Stop processing (graceful shutdown) */
    stop(): void;
    /** Add a task to the queue */
    enqueue(taskId: string): void;
    /** Get current queue depth */
    get queueSize(): number;
    private processNext;
}
//# sourceMappingURL=scheduler.d.ts.map