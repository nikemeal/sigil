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
import type { Tool, ToolDefinition } from '../types.js';
import { EventBus } from '../lib/event-bus.js';
export declare class ToolRegistry {
    private tools;
    private bus;
    constructor(bus: EventBus);
    /** Register a tool */
    register(tool: Tool): void;
    /** Get a tool by name */
    get(name: string): Tool | undefined;
    /** Get all registered tool names */
    list(): string[];
    /** Convert all registered tools to LLM-compatible definitions */
    getDefinitions(): ToolDefinition[];
    /**
     * Execute a tool by name. Handles approval checks and events.
     * Returns the result string, or an error message.
     */
    execute(name: string, args: Record<string, unknown>, messageId: string, approver?: (tool: string, args: Record<string, unknown>) => Promise<boolean>): Promise<string>;
}
//# sourceMappingURL=registry.d.ts.map