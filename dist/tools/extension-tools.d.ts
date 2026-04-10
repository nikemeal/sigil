/**
 * Extension Tools (Module 10)
 *
 * Let the agent create new tools and skills at runtime.
 *
 * Tools:
 *   create_tool       — write a new tool to local/tools/, validate, register immediately
 *   create_skill      — write a new skill markdown file to skills/
 *   list_custom_tools  — list agent-created tools in local/tools/
 */
import type { Tool } from '../types.js';
import type { EventBus } from '../lib/event-bus.js';
import type { ToolRegistry } from './registry.js';
/** Creates extension tools bound to an event bus and tool registry */
export declare function createExtensionTools(bus: EventBus, registry: ToolRegistry): Tool[];
//# sourceMappingURL=extension-tools.d.ts.map