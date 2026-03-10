import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { Tool, ToolResult } from '../gateway/types.js';

export function createFileReadTool(): Tool {
  return {
    name: 'file_read',
    description: 'Read the contents of a file. Returns the text content.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to read' },
        maxChars: { type: 'number', description: 'Max characters to return (default: 50000)' },
      },
      required: ['path'],
    },
    async execute(params) {
      const filePath = resolve(params.path as string);
      const maxChars = (params.maxChars as number) ?? 50_000;
      const content = await readFile(filePath, 'utf-8');
      const truncated = content.length > maxChars;
      return {
        content: truncated
          ? `${content.slice(0, maxChars)}\n\n--- truncated (${content.length} chars total) ---`
          : content,
      };
    },
  };
}

export function createFileWriteTool(): Tool {
  return {
    name: 'file_write',
    description: 'Write content to a file. Creates parent directories if needed.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to write to' },
        content: { type: 'string', description: 'Content to write' },
        append: { type: 'boolean', description: 'Append instead of overwrite (default: false)' },
      },
      required: ['path', 'content'],
    },
    async execute(params) {
      const filePath = resolve(params.path as string);
      const content = params.content as string;
      const append = (params.append as boolean) ?? false;

      await mkdir(dirname(filePath), { recursive: true });

      if (append) {
        const existing = await readFile(filePath, 'utf-8').catch(() => '');
        await writeFile(filePath, existing + content, 'utf-8');
      } else {
        await writeFile(filePath, content, 'utf-8');
      }

      return { content: `Wrote ${content.length} chars to ${filePath}` };
    },
  };
}

export function createListDirTool(): Tool {
  return {
    name: 'list_dir',
    description: 'List files and directories at a path.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to list' },
      },
      required: ['path'],
    },
    async execute(params) {
      const dirPath = resolve(params.path as string);
      const entries = await readdir(dirPath, { withFileTypes: true });
      const lines = entries.map(e => {
        const type = e.isDirectory() ? 'dir' : 'file';
        return `[${type}] ${e.name}`;
      });
      return { content: lines.join('\n') || '(empty directory)' };
    },
  };
}
