/**
 * Task Scheduler
 *
 * Manages the background task queue. Processes one task at a time.
 * On error, retries up to 2 times with backoff.
 */
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 5000;
export class Scheduler {
    bus;
    runner;
    store;
    queue = [];
    running = false;
    processing = false;
    retries = new Map();
    constructor(bus, runner, store) {
        this.bus = bus;
        this.runner = runner;
        this.store = store;
    }
    /** Start processing the queue */
    start() {
        this.running = true;
        console.log('[Scheduler] Started');
        // Resume any tasks that were left running (e.g. after crash)
        const stale = this.store.list('running');
        for (const task of stale) {
            console.log(`[Scheduler] Re-queuing stale task ${task.id.slice(0, 8)}`);
            this.store.updateStatus(task.id, 'queued');
            this.queue.push(task.id);
        }
        // Also pick up queued tasks from DB
        const queued = this.store.list('queued');
        for (const task of queued) {
            if (!this.queue.includes(task.id)) {
                this.queue.push(task.id);
            }
        }
        if (this.queue.length > 0) {
            console.log(`[Scheduler] ${this.queue.length} task(s) in queue`);
            this.processNext();
        }
    }
    /** Stop processing (graceful shutdown) */
    stop() {
        this.running = false;
        console.log('[Scheduler] Stopped');
    }
    /** Add a task to the queue */
    enqueue(taskId) {
        this.queue.push(taskId);
        console.log(`[Scheduler] Enqueued task ${taskId.slice(0, 8)} (queue: ${this.queue.length})`);
        if (this.running && !this.processing) {
            this.processNext();
        }
    }
    /** Get current queue depth */
    get queueSize() {
        return this.queue.length;
    }
    async processNext() {
        if (!this.running || this.processing || this.queue.length === 0)
            return;
        this.processing = true;
        const taskId = this.queue.shift();
        try {
            const task = this.store.get(taskId);
            if (!task) {
                console.warn(`[Scheduler] Task ${taskId.slice(0, 8)} not found, skipping`);
                this.processing = false;
                this.processNext();
                return;
            }
            await this.runner.run(task);
            // Check if the task failed and retry if needed
            const updated = this.store.get(taskId);
            if (updated?.status === 'error') {
                const attempts = (this.retries.get(taskId) ?? 0) + 1;
                if (attempts <= MAX_RETRIES) {
                    console.log(`[Scheduler] Retrying task ${taskId.slice(0, 8)} (attempt ${attempts}/${MAX_RETRIES})`);
                    this.retries.set(taskId, attempts);
                    this.store.updateStatus(taskId, 'queued');
                    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempts));
                    this.queue.push(taskId);
                }
                else {
                    console.error(`[Scheduler] Task ${taskId.slice(0, 8)} exhausted retries`);
                    this.retries.delete(taskId);
                }
            }
            else {
                this.retries.delete(taskId);
            }
        }
        catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            console.error(`[Scheduler] Unexpected error for task ${taskId.slice(0, 8)}: ${error}`);
        }
        this.processing = false;
        this.processNext();
    }
}
//# sourceMappingURL=scheduler.js.map