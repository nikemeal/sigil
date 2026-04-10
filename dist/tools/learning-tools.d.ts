/**
 * Learning Tools
 *
 * reflect          — explicitly store a technique after doing something well
 * list_techniques  — list all stored techniques
 * forget_technique — remove a technique by ID
 *
 * All auto-approved — these are safe read/write operations on local data.
 */
import type { Tool } from '../types.js';
import type { EventBus } from '../lib/event-bus.js';
import type { TechniqueStore } from '../learning/store.js';
export declare function createLearningTools(bus: EventBus, store: TechniqueStore): Tool[];
//# sourceMappingURL=learning-tools.d.ts.map