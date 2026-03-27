/**
 * Tool Loader (Module 10)
 *
 * Loads agent-created tools from local/tools/ at startup.
 * Each .ts/.js file should export a Tool object as default or named "tool".
 * Errors are handled per-file — one bad tool doesn't block the rest.
 */

import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Tool } from '../types.js';

const PROJECT_ROOT = process.cwd();
const LOCAL_TOOLS_DIR = resolve(PROJECT_ROOT, 'local', 'tools');

/** Load all tools from local/tools/. Returns successfully loaded tools. */
export async function loadLocalTools(): Promise<Tool[]> {
  if (!existsSync(LOCAL_TOOLS_DIR)) return [];

  const files = readdirSync(LOCAL_TOOLS_DIR).filter((f) => f.endsWith('.ts') || f.endsWith('.js'));
  if (files.length === 0) return [];

  const tools: Tool[] = [];

  for (const file of files) {
    try {
      const tool = await loadSingleTool(resolve(LOCAL_TOOLS_DIR, file));
      tools.push(tool);
    } catch (err) {
      console.warn(`[Tools] Failed to load local/tools/${file}:`, (err as Error).message);
    }
  }

  return tools;
}

/** Dynamically import a single tool file and return the Tool object. */
export async function loadSingleTool(filePath: string): Promise<Tool> {
  // Cache-busting query param so Node doesn't serve stale module
  const url = pathToFileURL(filePath).href + `?t=${Date.now()}`;
  const mod = await import(url);
  const tool = mod.default ?? mod.tool;

  if (!tool?.name || typeof tool.execute !== 'function') {
    throw new Error('File must export a Tool object as default or named "tool"');
  }

  return tool as Tool;
}

/** Get the local tools directory path */
export function getLocalToolsDir(): string {
  return LOCAL_TOOLS_DIR;
}
