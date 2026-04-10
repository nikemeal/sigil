/**
 * File Operation Tools
 *
 * file_read, file_write, list_dir.
 * file_read and list_dir are auto-approved (read-only, safe).
 * file_write requires prompt approval.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
const MAX_READ_SIZE = 50000;
export const fileReadTool = {
    name: 'file_read',
    description: 'Read the contents of a file. Returns the file text. Use for reading configs, logs, code, etc.',
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'File path (absolute or relative to project root)',
            },
            offset: {
                type: 'string',
                description: 'Line number to start from (optional, 1-indexed)',
            },
            limit: {
                type: 'string',
                description: 'Maximum number of lines to return (optional)',
            },
        },
        required: ['path'],
    },
    approval: 'auto',
    async execute(args) {
        const filePath = resolve(process.cwd(), args.path);
        if (!existsSync(filePath)) {
            return `Error: File not found: ${filePath}`;
        }
        try {
            const content = readFileSync(filePath, 'utf-8');
            if (content.length > MAX_READ_SIZE) {
                return content.slice(0, MAX_READ_SIZE) + `\n... (truncated, ${content.length} total chars)`;
            }
            // Apply offset/limit if specified
            const offset = parseInt(args.offset, 10) || 0;
            const limit = parseInt(args.limit, 10) || 0;
            if (offset > 0 || limit > 0) {
                const lines = content.split('\n');
                const start = Math.max(0, offset - 1);
                const end = limit > 0 ? start + limit : lines.length;
                return lines.slice(start, end).join('\n');
            }
            return content;
        }
        catch (err) {
            return `Error reading file: ${err.message}`;
        }
    },
};
export const fileWriteTool = {
    name: 'file_write',
    description: 'Write content to a file. Creates the file and parent directories if they don\'t exist. Use for saving notes, configs, data.',
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'File path (absolute or relative to project root)',
            },
            content: {
                type: 'string',
                description: 'Content to write to the file',
            },
            append: {
                type: 'string',
                description: 'If "true", append to file instead of overwriting',
            },
        },
        required: ['path', 'content'],
    },
    approval: 'prompt',
    async execute(args) {
        const filePath = resolve(process.cwd(), args.path);
        const content = args.content;
        const append = args.append === 'true' || args.append === true;
        try {
            const dir = dirname(filePath);
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }
            if (append && existsSync(filePath)) {
                const existing = readFileSync(filePath, 'utf-8');
                writeFileSync(filePath, existing + content, 'utf-8');
            }
            else {
                writeFileSync(filePath, content, 'utf-8');
            }
            return `File written: ${filePath} (${content.length} chars)`;
        }
        catch (err) {
            return `Error writing file: ${err.message}`;
        }
    },
};
export const listDirTool = {
    name: 'list_dir',
    description: 'List files and directories at a given path. Shows names, sizes, and types.',
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Directory path (absolute or relative to project root)',
            },
        },
        required: ['path'],
    },
    approval: 'auto',
    async execute(args) {
        const dirPath = resolve(process.cwd(), args.path);
        if (!existsSync(dirPath)) {
            return `Error: Directory not found: ${dirPath}`;
        }
        try {
            const entries = readdirSync(dirPath);
            const lines = entries.map((name) => {
                try {
                    const fullPath = join(dirPath, name);
                    const stat = statSync(fullPath);
                    const type = stat.isDirectory() ? 'dir' : 'file';
                    const size = stat.isDirectory() ? '' : ` (${formatSize(stat.size)})`;
                    return `${type === 'dir' ? '📁' : '📄'} ${name}${size}`;
                }
                catch {
                    return `❓ ${name}`;
                }
            });
            return lines.join('\n') || '(empty directory)';
        }
        catch (err) {
            return `Error listing directory: ${err.message}`;
        }
    },
};
function formatSize(bytes) {
    if (bytes < 1024)
        return `${bytes}B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
//# sourceMappingURL=file-ops.js.map