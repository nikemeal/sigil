/**
 * Task Tools
 *
 * create_task — create a background task for complex, time-consuming work
 * list_tasks — report on active and recent background tasks
 *
 * Both auto-approved — the agent decides when to use them.
 */

import type { Tool } from '../types.js';
import type { TaskStore } from '../tasks/store.js';
import type { Scheduler } from '../tasks/scheduler.js';

/** Creates task tools bound to a task store and scheduler */
export function createTaskTools(taskStore: TaskStore, scheduler: Scheduler): Tool[] {
  return [
    {
      name: 'create_task',
      description: 'Create a background task for complex, time-consuming work. Use when a request involves research, multi-step analysis, deep investigation, or anything that benefits from dedicated background processing. Do NOT use for simple questions, quick lookups, or conversational replies.',
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'Clear, self-contained description of the work to do in the background',
          },
        },
        required: ['description'],
      },
      approval: 'auto',

      async execute(args: Record<string, unknown>): Promise<string> {
        const description = args.description as string;
        const task = taskStore.create(description, 'agent');
        scheduler.enqueue(task.id);
        return `Background task created. Use this to inform the user naturally that you'll get back to them.`;
      },
    },

    {
      name: 'list_tasks',
      description: 'List background tasks. Use when the user asks about active work, running tasks, or what you are working on in the background.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description: 'Filter by status (optional — omit to show active + recent)',
            enum: ['queued', 'running', 'complete', 'error'],
          },
          limit: {
            type: 'string',
            description: 'Maximum number of results (optional, default 10)',
          },
        },
        required: [],
      },
      approval: 'auto',

      async execute(args: Record<string, unknown>): Promise<string> {
        const limit = parseInt(args.limit as string, 10) || 10;

        if (args.status) {
          const tasks = taskStore.list(args.status as 'queued' | 'running' | 'complete' | 'error')
            .slice(0, limit);
          if (tasks.length === 0) return `No ${args.status} tasks.`;
          return tasks.map((t) => formatTask(t)).join('\n');
        }

        // Default: show active tasks + recent completed
        const running = taskStore.list('running');
        const queued = taskStore.list('queued');
        const completed = taskStore.list('complete').slice(0, 5);

        const active = [...running, ...queued];
        const lines: string[] = [];

        if (active.length > 0) {
          lines.push('**Active tasks:**');
          for (const t of active) lines.push(formatTask(t));
        }

        if (completed.length > 0) {
          if (lines.length > 0) lines.push('');
          lines.push('**Recent completed:**');
          for (const t of completed) lines.push(formatTask(t));
        }

        if (lines.length === 0) return 'No background tasks.';
        return lines.join('\n');
      },
    },
  ];
}

function formatTask(t: { id: string; userMessage: string; status: string; createdAt: Date; completedAt?: Date }): string {
  const id = t.id.slice(0, 8);
  const desc = t.userMessage.length > 60 ? t.userMessage.slice(0, 57) + '...' : t.userMessage;
  const time = t.completedAt
    ? `completed ${timeAgo(t.completedAt)}`
    : `started ${timeAgo(t.createdAt)}`;
  return `- [${id}] ${t.status}: "${desc}" (${time})`;
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
