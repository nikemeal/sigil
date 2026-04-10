/**
 * Memory Tools
 *
 * remember — store a fact, preference, or note in long-term memory
 * recall — explicitly search memory (beyond automatic context injection)
 * update_profile — update the living profile with new information
 *
 * All auto-approved — these are safe operations.
 */
import type { Tool } from '../types.js';
import type { ContextEngine } from '../context/engine.js';
/** Creates memory tools bound to a context engine instance */
export declare function createMemoryTools(context: ContextEngine): Tool[];
//# sourceMappingURL=memory-tools.d.ts.map