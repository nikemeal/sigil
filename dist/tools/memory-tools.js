/**
 * Memory Tools
 *
 * remember — store a fact, preference, or note in long-term memory
 * recall — explicitly search memory (beyond automatic context injection)
 * update_profile — update the living profile with new information
 *
 * All auto-approved — these are safe operations.
 */
/** Creates memory tools bound to a context engine instance */
export function createMemoryTools(context) {
    return [
        {
            name: 'remember',
            description: 'Store a fact, preference, or note in long-term memory. Use when the user tells you something worth remembering across sessions.',
            parameters: {
                type: 'object',
                properties: {
                    content: {
                        type: 'string',
                        description: 'The fact, preference, or note to remember',
                    },
                    type: {
                        type: 'string',
                        description: 'Type of memory',
                        enum: ['fact', 'preference', 'note'],
                    },
                    tags: {
                        type: 'string',
                        description: 'Comma-separated tags for categorisation (optional)',
                    },
                },
                required: ['content'],
            },
            approval: 'auto',
            async execute(args) {
                const content = args.content;
                const type = args.type ?? 'fact';
                const tags = args.tags ? args.tags.split(',').map((t) => t.trim()) : [];
                const id = await context.remember(content, type, tags);
                return `Stored memory #${id}: "${content}"`;
            },
        },
        {
            name: 'recall',
            description: 'Search long-term memory for facts, preferences, or notes. Use when you need to look up something specific that might have been mentioned before.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'What to search for in memory',
                    },
                    limit: {
                        type: 'string',
                        description: 'Maximum number of results (optional, default 5)',
                    },
                },
                required: ['query'],
            },
            approval: 'auto',
            async execute(args) {
                const query = args.query;
                const limit = parseInt(args.limit, 10) || 5;
                const results = await context.recall(query, limit);
                if (results.length === 0) {
                    return 'No matching memories found.';
                }
                return results
                    .map((r, i) => `${i + 1}. [${r.memory.type}] ${r.memory.content} (relevance: ${r.score.toFixed(2)})`)
                    .join('\n');
            },
        },
        {
            name: 'update_profile',
            description: 'Update the user profile with new information. The profile is always visible in your context. Use for key, always-relevant facts about the user.',
            parameters: {
                type: 'object',
                properties: {
                    content: {
                        type: 'string',
                        description: 'The complete new profile content (markdown format). Include all existing info plus your updates.',
                    },
                },
                required: ['content'],
            },
            approval: 'auto',
            async execute(args) {
                const content = args.content;
                context.getProfile().update(content);
                return 'Profile updated.';
            },
        },
    ];
}
//# sourceMappingURL=memory-tools.js.map