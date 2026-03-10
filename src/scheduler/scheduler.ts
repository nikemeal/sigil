import cron from 'node-cron';
import type { TaskStore } from '../tasks/store.js';
import type { TaskRunner } from '../tasks/runner.js';

/**
 * Scheduler ticks every 30 seconds, checking for:
 * 1. One-shot tasks whose run_at time has passed
 * 2. Recurring tasks whose cron schedule matches now
 *
 * Also handles the heartbeat — the agent's "pulse" that lets it
 * proactively do things without being prompted.
 */
export class Scheduler {
  private store: TaskStore;
  private runner: TaskRunner;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private cronJobs = new Map<string, cron.ScheduledTask>();
  private timezone: string;

  constructor(store: TaskStore, runner: TaskRunner, timezone = 'Europe/London') {
    this.store = store;
    this.runner = runner;
    this.timezone = timezone;
  }

  start(): void {
    console.log(`[scheduler] Starting (timezone: ${this.timezone})`);

    // Tick every 30 seconds for one-shot delayed tasks
    this.tickInterval = setInterval(() => this.tick(), 30_000);

    // Initial tick on startup to catch anything that was due while stopped
    this.tick();

    // Set up cron watchers for recurring tasks
    this.syncCronJobs();
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    for (const [, job] of this.cronJobs) {
      job.stop();
    }
    this.cronJobs.clear();
    console.log('[scheduler] Stopped');
  }

  /** Check for one-shot tasks that are due */
  private tick(): void {
    const dueTasks = this.store.getDueTasks();
    for (const task of dueTasks) {
      if (!task.schedule) {
        // One-shot delayed task — execute it
        console.log(`[scheduler] Task ${task.id.slice(0, 8)} is due, executing...`);
        this.runner.execute(task.id).catch(err =>
          console.error(`[scheduler] Failed to execute task ${task.id}: ${err}`)
        );
      }
    }
  }

  /** Sync cron jobs with stored recurring tasks */
  syncCronJobs(): void {
    const scheduled = this.store.getScheduledTasks();

    // Stop jobs for tasks that no longer exist or are cancelled
    for (const [taskId, job] of this.cronJobs) {
      if (!scheduled.find(t => t.id === taskId)) {
        job.stop();
        this.cronJobs.delete(taskId);
      }
    }

    // Create jobs for new recurring tasks
    for (const task of scheduled) {
      if (this.cronJobs.has(task.id)) continue;
      if (!task.schedule || !cron.validate(task.schedule)) continue;

      const job = cron.schedule(task.schedule, () => {
        console.log(`[scheduler] Cron trigger for task ${task.id.slice(0, 8)}: ${task.objective.slice(0, 40)}`);
        // For recurring tasks, create a fresh execution each time
        const newTask = this.store.create({
          objective: task.objective,
          replyTransport: task.replyTransport,
          replyThreadId: task.replyThreadId,
        });
        this.runner.execute(newTask.id).catch(err =>
          console.error(`[scheduler] Cron execution failed: ${err}`)
        );
      }, { timezone: this.timezone });

      this.cronJobs.set(task.id, job);
      console.log(`[scheduler] Registered cron "${task.schedule}" for task ${task.id.slice(0, 8)}`);
    }
  }
}
