import type { Tool, ToolResult } from '../gateway/types.js';
import type { ContextEngine } from '../context/engine.js';

export function createMemoryTools(context: ContextEngine): Tool[] {
  return [
    {
      name: 'remember',
      description:
        'Store a fact, preference, or note in long-term memory. Use this when the user tells you something worth remembering, or when you learn something important about them.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'What to remember' },
          type: {
            type: 'string',
            enum: ['fact', 'preference', 'note'],
            description: 'Type of memory: fact (about the user/world), preference (likes/dislikes), note (general)',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags for categorization (e.g., ["dnd", "campaign"])',
          },
        },
        required: ['content'],
      },
      async execute(params): Promise<ToolResult> {
        const content = params.content as string;
        const type = (params.type as 'fact' | 'preference' | 'note') ?? 'fact';
        const tags = (params.tags as string[]) ?? [];
        const id = context.remember(content, type, tags);
        return { content: `Stored memory #${id}: "${content}"` };
      },
    },
    {
      name: 'recall',
      description: 'Search long-term memory for relevant information.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for' },
          limit: { type: 'number', description: 'Max results (default: 5)' },
        },
        required: ['query'],
      },
      async execute(params): Promise<ToolResult> {
        const query = params.query as string;
        const limit = (params.limit as number) ?? 5;
        const memories = context.getMemory().recall(query, limit);

        if (memories.length === 0) {
          return { content: 'No relevant memories found.' };
        }

        const lines = memories.map(
          m => `[#${m.id} | ${m.type}] ${m.content} (tags: ${m.tags.join(', ') || 'none'})`
        );
        return { content: lines.join('\n') };
      },
    },
  ];
}
