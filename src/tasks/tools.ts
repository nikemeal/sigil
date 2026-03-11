import type { Tool, ToolResult, Transport } from '../gateway/types.js';
import type { TaskStore, Task } from './store.js';
import type { TaskRunner } from './runner.js';

/**
 * Tools that let the agent manage tasks autonomously.
 *
 * When the agent decides a request needs background work, it can:
 * - Create a task (with steps it plans itself)
 * - Schedule a task for later (one-shot or recurring cron)
 * - Check on / cancel existing tasks
 * - Add steps to a running task
 *
 * This is what turns Sigil from request→response into a genuine coworker.
 */
export function createTaskTools(store: TaskStore, runner: TaskRunner): Tool[] {
  return [
    // ── Create a background task ──────────────────────────────────
    {
      name: 'create_task',
      description: `Create a background task that will be executed autonomously. Use this when:
- The work will take multiple steps or significant time
- You need to do research, then synthesise results
- The user won't want to wait for the full result
- You want to check on something periodically

The task runs in the background. You can tell the user you'll message them when done.
Steps are optional — if omitted, the task planner will break the objective into steps automatically.`,
      parameters: {
        type: 'object',
        properties: {
          objective: {
            type: 'string',
            description: 'What the task should accomplish — be specific and detailed',
          },
          steps: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: specific steps to execute. If omitted, steps are planned automatically.',
          },
          run_at: {
            type: 'string',
            description: 'Optional: ISO datetime to delay execution (e.g., "2025-01-15T09:00:00Z"). If omitted, runs immediately.',
          },
          schedule: {
            type: 'string',
            description: 'Optional: cron expression for recurring tasks (e.g., "0 9 * * 1-5" for weekday mornings). The task will re-run on this schedule.',
          },
        },
        required: ['objective'],
      },
      async execute(params): Promise<ToolResult> {
        const objective = params.objective as string;
        const stepDescs = params.steps as string[] | undefined;
        const runAt = params.run_at as string | undefined;
        const schedule = params.schedule as string | undefined;

        const steps = stepDescs?.map(desc => ({
          id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          description: desc,
          status: 'pending' as const,
        }));

        // Note: replyTransport is set by the agent based on where the message came from
        // For now, default to TUI — the agent wrapper overrides this
        const task = store.create({
          objective,
          replyTransport: (params._replyTransport as Transport) ?? 'tui',
          replyThreadId: params._replyThreadId as string | undefined,
          steps,
          runAt,
          schedule,
        });

        // If no delay, kick it off immediately (async — don't await)
        if (!runAt && !schedule) {
          runner.execute(task.id).catch(err =>
            console.error(`[task-tools] Failed to start task ${task.id}: ${err}`)
          );
        }

        const timing = runAt
          ? `Scheduled for ${runAt}`
          : schedule
            ? `Recurring on schedule: ${schedule}`
            : 'Started immediately';

        return {
          content: `Task created: ${task.id.slice(0, 8)}\nObjective: ${objective}\n${timing}\nSteps: ${task.steps.length || 'auto-planned'}`,
        };
      },
    },

    // ── Schedule a self-generated task ────────────────────────────
    {
      name: 'schedule_self',
      description: `Schedule yourself to do something later. Use this when:
- You want to check back on something ("I'll check the weather tomorrow morning")
- You need to follow up ("I'll remind you about X on Friday")
- You want to run a recurring check ("Monitor Y every day at 9am")

This creates a task that will trigger at the specified time.`,
      parameters: {
        type: 'object',
        properties: {
          objective: { type: 'string', description: 'What to do when the time comes' },
          run_at: { type: 'string', description: 'ISO datetime for one-shot schedule' },
          schedule: { type: 'string', description: 'Cron expression for recurring (e.g., "0 9 * * *")' },
        },
        required: ['objective'],
      },
      async execute(params): Promise<ToolResult> {
        const task = store.create({
          objective: params.objective as string,
          replyTransport: (params._replyTransport as Transport) ?? 'tui',
          replyThreadId: params._replyThreadId as string | undefined,
          runAt: params.run_at as string | undefined,
          schedule: params.schedule as string | undefined,
        });

        return { content: `Scheduled: ${task.id.slice(0, 8)} — "${params.objective}"` };
      },
    },

    // ── List tasks ────────────────────────────────────────────────
    {
      name: 'list_tasks',
      description: 'List current and recent tasks with their status.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['active', 'all'],
            description: '"active" for running/pending/waiting tasks, "all" for everything',
          },
        },
      },
      async execute(params): Promise<ToolResult> {
        const showAll = (params.status as string) === 'all';
        const tasks = showAll ? store.list(20) : store.getActiveTasks();

        if (tasks.length === 0) {
          return { content: 'No tasks found.' };
        }

        const lines = tasks.map(t => {
          const progress = t.steps.length > 0
            ? `[${t.steps.filter(s => s.status === 'completed').length}/${t.steps.length}]`
            : '';
          return `${t.id.slice(0, 8)} | ${t.status.padEnd(10)} | ${progress} ${t.objective.slice(0, 60)}`;
        });

        return { content: `Tasks:\n${lines.join('\n')}` };
      },
    },

    // ── Cancel a task ─────────────────────────────────────────────
    {
      name: 'cancel_task',
      description: 'Cancel a running or scheduled task.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Task ID (first 8 chars is enough)' },
        },
        required: ['task_id'],
      },
      async execute(params): Promise<ToolResult> {
        const prefix = params.task_id as string;
        const tasks = store.list(100);
        const task = tasks.find(t => t.id.startsWith(prefix));

        if (!task) return { content: `No task found matching "${prefix}"`, isError: true };
        if (task.status === 'completed' || task.status === 'cancelled') {
          return { content: `Task ${prefix} is already ${task.status}` };
        }

        store.update(task.id, { status: 'cancelled' });
        return { content: `Cancelled task ${prefix}: "${task.objective}"` };
      },
    },
  ];
}
