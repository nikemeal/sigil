/**
 * Tool Registry
 *
 * Central registry of all tools the agent can use.
 * Converts tools to LLM-compatible definitions and dispatches calls.
 *
 * Tools can be:
 *   - Built-in (shell_exec, file_read, etc.)
 *   - Agent-created (module 10, stored in local/tools/)
 *   - MCP-provided (wishlist)
 */
export class ToolRegistry {
    tools = new Map();
    bus;
    constructor(bus) {
        this.bus = bus;
    }
    /** Register a tool */
    register(tool) {
        if (this.tools.has(tool.name)) {
            console.warn(`[Tools] Overwriting existing tool: ${tool.name}`);
        }
        this.tools.set(tool.name, tool);
        console.log(`[Tools] Registered: ${tool.name} (approval: ${tool.approval})`);
    }
    /** Get a tool by name */
    get(name) {
        return this.tools.get(name);
    }
    /** Get all registered tool names */
    list() {
        return [...this.tools.keys()];
    }
    /** Convert all registered tools to LLM-compatible definitions */
    getDefinitions() {
        return [...this.tools.values()]
            .filter((t) => t.approval !== 'deny')
            .map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
        }));
    }
    /**
     * Execute a tool by name. Handles approval checks and events.
     * Returns the result string, or an error message.
     */
    async execute(name, args, messageId, approver) {
        const tool = this.tools.get(name);
        if (!tool) {
            return `Error: Unknown tool '${name}'. Available tools: ${this.list().join(', ')}`;
        }
        if (tool.approval === 'deny') {
            return `Error: Tool '${name}' is disabled.`;
        }
        // Check approval
        if (tool.approval === 'prompt') {
            this.bus.emit('tool:approval_needed', { messageId, tool: name, args });
            if (approver) {
                const approved = await approver(name, args);
                if (!approved) {
                    this.bus.emit('tool:denied', { messageId, tool: name });
                    return `Tool '${name}' was denied by the user.`;
                }
                this.bus.emit('tool:approved', { messageId, tool: name });
            }
            else {
                // No approver available — auto-approve but log warning
                console.warn(`[Tools] No approver for '${name}', auto-approving.`);
            }
        }
        // Execute
        this.bus.emit('tool:calling', { messageId, tool: name, args });
        try {
            const result = await tool.execute(args);
            this.bus.emit('tool:result', { messageId, tool: name, result: result.slice(0, 200) });
            return result;
        }
        catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            return `Error executing '${name}': ${error}`;
        }
    }
}
//# sourceMappingURL=registry.js.map