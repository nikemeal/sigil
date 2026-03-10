import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool, ToolResult } from '../gateway/types.js';

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_MAX_OUTPUT = 50_000;

export function createShellTool(options?: {
  allowedDirs?: string[];
  timeoutMs?: number;
}): Tool {
  const timeout = options?.timeoutMs ?? DEFAULT_TIMEOUT;

  return {
    name: 'shell_exec',
    description:
      'Execute a shell command and return its output. Use for file operations, system info, running scripts, etc. Commands run as the current user.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the command (optional)',
        },
      },
      required: ['command'],
    },

    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const command = params.command as string;
      const cwd = (params.cwd as string) ?? process.cwd();

      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd,
          timeout,
          maxBuffer: DEFAULT_MAX_OUTPUT * 2,
          env: { ...process.env, TERM: 'dumb' },
        });

        const output = [
          stdout ? `stdout:\n${stdout.slice(0, DEFAULT_MAX_OUTPUT)}` : '',
          stderr ? `stderr:\n${stderr.slice(0, DEFAULT_MAX_OUTPUT)}` : '',
        ]
          .filter(Boolean)
          .join('\n\n');

        return { content: output || '(no output)' };
      } catch (err: unknown) {
        const error = err as { code?: number; stdout?: string; stderr?: string; message?: string };
        const parts = [
          `Exit code: ${error.code ?? 'unknown'}`,
          error.stdout ? `stdout:\n${error.stdout.slice(0, DEFAULT_MAX_OUTPUT)}` : '',
          error.stderr ? `stderr:\n${error.stderr.slice(0, DEFAULT_MAX_OUTPUT)}` : '',
        ].filter(Boolean);

        return {
          content: parts.join('\n\n') || error.message || 'Command failed',
          isError: true,
        };
      }
    },
  };
}
