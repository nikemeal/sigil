/**
 * Tool Loader (Module 10)
 *
 * Loads agent-created tools from local/tools/ at startup.
 * Each .ts/.js file should export a Tool object as default or named "tool".
 * Errors are handled per-file — one bad tool doesn't block the rest.
 */
import type { Tool } from '../types.js';
/** Load all tools from local/tools/. Returns successfully loaded tools. */
export declare function loadLocalTools(): Promise<Tool[]>;
/** Dynamically import a single tool file and return the Tool object. */
export declare function loadSingleTool(filePath: string): Promise<Tool>;
/** Get the local tools directory path */
export declare function getLocalToolsDir(): string;
//# sourceMappingURL=tool-loader.d.ts.map