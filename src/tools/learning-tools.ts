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

export function createLearningTools(bus: EventBus, store: TechniqueStore): Tool[] {
  return [
    {
      name: 'reflect',
      description:
        'Store a reusable technique you learned from completing a task. Use after finishing something where a specific approach worked well and would apply to future similar tasks.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'What type of task or situation this technique applies to (1 sentence)',
          },
          technique: {
            type: 'string',
            description: 'The specific approach that worked (2-3 sentences)',
          },
          outcome: {
            type: 'string',
            description: 'What happened when you used this approach (optional)',
          },
        },
        required: ['pattern', 'technique'],
      },
      approval: 'auto',

      async execute(args: Record<string, unknown>): Promise<string> {
        const pattern = args.pattern as string;
        const technique = args.technique as string;
        const outcome = args.outcome as string | undefined;

        const id = store.add(pattern, technique, outcome, 'explicit');
        bus.emit('learning:technique_captured', { id, pattern, source: 'explicit' });
        return `Stored technique ${id.slice(0, 8)}: "${pattern}"`;
      },
    },

    {
      name: 'list_techniques',
      description: 'List all stored techniques from past experience, ordered by how often they have been used.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      approval: 'auto',

      async execute(_args: Record<string, unknown>): Promise<string> {
        const all = store.list();
        if (all.length === 0) return 'No techniques stored yet.';

        return all
          .map(
            (t, i) =>
              `${i + 1}. [${t.source}] (used ${t.usageCount}x) id:${t.id.slice(0, 8)}\n   Pattern: ${t.pattern}\n   Technique: ${t.technique}${t.outcome ? `\n   Outcome: ${t.outcome}` : ''}`,
          )
          .join('\n\n');
      },
    },

    {
      name: 'forget_technique',
      description: 'Remove a stored technique by its ID. Use when a technique is no longer relevant or was stored incorrectly.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The technique ID to remove (full UUID)',
          },
          reason: {
            type: 'string',
            description: 'Why this technique is being removed',
          },
        },
        required: ['id', 'reason'],
      },
      approval: 'auto',

      async execute(args: Record<string, unknown>): Promise<string> {
        const id = args.id as string;
        const reason = args.reason as string;
        store.remove(id);
        return `Removed technique ${id}: ${reason}`;
      },
    },
  ];
}
