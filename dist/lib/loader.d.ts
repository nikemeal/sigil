/**
 * Module Loader with local/ Override Support
 *
 * Checks local/src/ first, falls back to src/. This is the foundation
 * for self-repair (module 9): the agent writes patches to local/src/
 * which take priority over upstream src/ code.
 *
 * Why this matters:
 *   - `sigil update` only touches src/, so no merge conflicts ever
 *   - Self-repair is safe: worst case, `rm -rf local/` restores upstream
 *   - Agent-created tools persist in local/tools/ across updates
 *
 * Usage:
 *   const module = await loadModule('gateway/gateway');
 *   // Checks local/src/gateway/gateway.ts first, then src/gateway/gateway.ts
 */
/**
 * Dynamically import a module, checking local/src/ override first.
 *
 * @param modulePath - Path relative to src/, without extension.
 *                     e.g. 'gateway/gateway' or 'agent/providers/anthropic'
 * @returns The imported module
 */
export declare function loadModule<T = Record<string, unknown>>(modulePath: string): Promise<T>;
/**
 * Check if a local override exists for a given module path.
 * Useful for self-diagnosis: "which modules have been patched?"
 */
export declare function hasLocalOverride(modulePath: string): boolean;
/**
 * List all local overrides. Returns module paths relative to src/.
 * Used by the updater (module 12) to review overrides after an update.
 */
export declare function listLocalOverrides(): string[];
//# sourceMappingURL=loader.d.ts.map