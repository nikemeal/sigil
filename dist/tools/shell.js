/**
 * Shell Exec Tool
 *
 * Runs shell commands. Approval: 'prompt' by default — the user
 * must confirm before execution (can be changed to 'auto' in config).
 *
 * Output is truncated to prevent flooding the context window.
 */
import { execSync } from 'node:child_process';
const MAX_OUTPUT = 4000;
const TIMEOUT_MS = 30000;
export const shellExecTool = {
    name: 'shell_exec',
    description: 'Execute a shell command and return its output. Use for system info, file operations, package management, etc.',
    parameters: {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                description: 'The shell command to execute',
            },
            working_dir: {
                type: 'string',
                description: 'Working directory for the command (optional, defaults to project root)',
            },
        },
        required: ['command'],
    },
    approval: 'prompt',
    async execute(args) {
        const command = args.command;
        const workingDir = args.working_dir ?? process.cwd();
        try {
            const output = execSync(command, {
                cwd: workingDir,
                timeout: TIMEOUT_MS,
                encoding: 'utf-8',
                maxBuffer: 1024 * 1024,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            const trimmed = output.length > MAX_OUTPUT
                ? output.slice(0, MAX_OUTPUT) + `\n... (truncated, ${output.length} total chars)`
                : output;
            return trimmed || '(no output)';
        }
        catch (err) {
            const execErr = err;
            const stderr = execErr.stderr?.slice(0, MAX_OUTPUT) ?? '';
            return `Exit code: ${execErr.status ?? 'unknown'}\n${stderr || execErr.message}`;
        }
    },
};
//# sourceMappingURL=shell.js.map