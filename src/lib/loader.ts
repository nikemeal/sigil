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

import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Project root — where sigil.toml, src/, and local/ live */
const PROJECT_ROOT = process.cwd();

/**
 * Dynamically import a module, checking local/src/ override first.
 *
 * @param modulePath - Path relative to src/, without extension.
 *                     e.g. 'gateway/gateway' or 'agent/providers/anthropic'
 * @returns The imported module
 */
export async function loadModule<T = Record<string, unknown>>(modulePath: string): Promise<T> {
  // Check for local override first
  const localTsPath = resolve(PROJECT_ROOT, 'local', 'src', `${modulePath}.ts`);
  const localJsPath = resolve(PROJECT_ROOT, 'local', 'src', `${modulePath}.js`);

  // In dev (tsx), look for .ts files. In production (compiled), look for .js files.
  if (existsSync(localTsPath)) {
    return await import(pathToFileURL(localTsPath).href) as T;
  }
  if (existsSync(localJsPath)) {
    return await import(pathToFileURL(localJsPath).href) as T;
  }

  // Fall back to upstream src/ (source for dev, dist for production)
  const srcTsPath = resolve(PROJECT_ROOT, 'src', `${modulePath}.ts`);
  const srcJsPath = resolve(PROJECT_ROOT, 'dist', `${modulePath}.js`);

  if (existsSync(srcTsPath)) {
    return await import(pathToFileURL(srcTsPath).href) as T;
  }
  if (existsSync(srcJsPath)) {
    return await import(pathToFileURL(srcJsPath).href) as T;
  }

  throw new Error(`[Loader] Module not found: ${modulePath} (checked local/src/ and src/)`);
}

/**
 * Check if a local override exists for a given module path.
 * Useful for self-diagnosis: "which modules have been patched?"
 */
export function hasLocalOverride(modulePath: string): boolean {
  const localTsPath = resolve(PROJECT_ROOT, 'local', 'src', `${modulePath}.ts`);
  const localJsPath = resolve(PROJECT_ROOT, 'local', 'src', `${modulePath}.js`);
  return existsSync(localTsPath) || existsSync(localJsPath);
}

/**
 * List all local overrides. Returns module paths relative to src/.
 * Used by the updater (module 12) to review overrides after an update.
 */
export function listLocalOverrides(): string[] {
  const localSrcDir = resolve(PROJECT_ROOT, 'local', 'src');
  if (!existsSync(localSrcDir)) return [];

  const overrides: string[] = [];
  walkDir(localSrcDir, localSrcDir, overrides);
  return overrides;
}

/** Recursively walk a directory and collect .ts/.js file paths */
function walkDir(dir: string, root: string, results: string[]): void {
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walkDir(full, root, results);
      } else if (entry.endsWith('.ts') || entry.endsWith('.js')) {
        const relative = full.slice(root.length + 1).replace(/\.(ts|js)$/, '');
        results.push(relative);
      }
    }
  } catch {
    // Directory doesn't exist or isn't readable — that's fine
  }
}
