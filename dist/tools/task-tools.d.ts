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
export declare function createTaskTools(taskStore: TaskStore, scheduler: Scheduler): Tool[];
//# sourceMappingURL=task-tools.d.ts.map