/**
 * Diagnosis Tools (Module 9)
 *
 * Scoped, validated tools for self-diagnosis and self-repair.
 * All writes go to local/src/ — upstream src/ is never modified.
 *
 * Tools:
 *   read_source     — read a Sigil source file with override status
 *   apply_patch     — write a patched file to local/src/ (compilation-gated)
 *   list_overrides  — inventory of active local overrides
 *   remove_override — clean up a local override
 */
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { hasLocalOverride, listLocalOverrides } from '../lib/loader.js';
const PROJECT_ROOT = process.cwd();
/** Creates diagnosis tools bound to an event bus */
export function createDiagnosisTools(bus) {
    return [
        {
            name: 'read_source',
            description: 'Read a Sigil source file from src/. Use to examine your own code for diagnosis or understanding. Returns contents with line numbers and indicates if a local override exists.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Path relative to src/, e.g. "gateway/gateway.ts" or "agent/agent.ts"',
                    },
                },
                required: ['path'],
            },
            approval: 'auto',
            async execute(args) {
                const relPath = String(args.path);
                // Normalise: strip leading src/ if provided, strip extension for override check
                const cleaned = relPath.replace(/^src\//, '');
                const modulePath = cleaned.replace(/\.(ts|js)$/, '');
                const filePath = resolve(PROJECT_ROOT, 'src', cleaned.endsWith('.ts') || cleaned.endsWith('.js') ? cleaned : `${cleaned}.ts`);
                if (!existsSync(filePath)) {
                    return `File not found: src/${cleaned}`;
                }
                const content = readFileSync(filePath, 'utf-8');
                const lines = content.split('\n');
                const numbered = lines.map((line, i) => `${String(i + 1).padStart(4)} │ ${line}`).join('\n');
                const overrideStatus = hasLocalOverride(modulePath)
                    ? `⚠ Local override exists at local/src/${modulePath}.ts`
                    : 'No local override';
                return `--- src/${cleaned} (${lines.length} lines) ---\n${overrideStatus}\n\n${numbered}`;
            },
        },
        {
            name: 'apply_patch',
            description: 'Write a patched version of a source file to local/src/. The module loader will use this override instead of the upstream src/ version on next restart. Validates that the patch compiles before accepting it.',
            parameters: {
                type: 'object',
                properties: {
                    modulePath: {
                        type: 'string',
                        description: 'Module path relative to src/, without extension. e.g. "gateway/gateway" or "context/engine"',
                    },
                    content: {
                        type: 'string',
                        description: 'The full patched file content (TypeScript)',
                    },
                    reason: {
                        type: 'string',
                        description: 'Why this patch is needed (for audit trail)',
                    },
                },
                required: ['modulePath', 'content', 'reason'],
            },
            approval: 'auto',
            async execute(args) {
                const modulePath = String(args.modulePath).replace(/^src\//, '').replace(/\.(ts|js)$/, '');
                const content = String(args.content);
                const reason = String(args.reason);
                const patchPath = resolve(PROJECT_ROOT, 'local', 'src', `${modulePath}.ts`);
                // Create directories
                mkdirSync(dirname(patchPath), { recursive: true });
                // Write the patch
                writeFileSync(patchPath, content, 'utf-8');
                // Validate compilation
                try {
                    execSync('npx tsc --noEmit', {
                        cwd: PROJECT_ROOT,
                        timeout: 30_000,
                        stdio: 'pipe',
                    });
                }
                catch (err) {
                    // Compilation failed — remove the patch
                    try {
                        unlinkSync(patchPath);
                    }
                    catch { }
                    const stderr = err.stderr?.toString() ?? '';
                    const summary = stderr.split('\n').slice(0, 10).join('\n');
                    bus.emit('diagnosis:patch_failed', { modulePath, error: summary });
                    return `Patch rejected — compilation failed:\n${summary}\n\nThe patch has been removed. Fix the errors and try again.`;
                }
                bus.emit('diagnosis:patch_applied', { modulePath, reason });
                return `Patch applied: local/src/${modulePath}.ts\nReason: ${reason}\n\nThe override will take effect on next restart. Use list_overrides to see all active patches.`;
            },
        },
        {
            name: 'list_overrides',
            description: 'List all active local overrides in local/src/. Shows which upstream modules have been patched.',
            parameters: {
                type: 'object',
                properties: {},
                required: [],
            },
            approval: 'auto',
            async execute() {
                const overrides = listLocalOverrides();
                if (overrides.length === 0) {
                    return 'No local overrides. All modules are running upstream code from src/.';
                }
                const lines = overrides.map((mod) => {
                    const upstreamExists = existsSync(resolve(PROJECT_ROOT, 'src', `${mod}.ts`));
                    const status = upstreamExists ? 'overrides src/' : 'new module (no upstream)';
                    return `- ${mod} (${status})`;
                });
                return `Active local overrides (${overrides.length}):\n${lines.join('\n')}\n\nTo remove an override: use remove_override with the module path.\nTo restore all upstream: rm -rf local/`;
            },
        },
        {
            name: 'remove_override',
            description: 'Remove a local override, restoring the upstream src/ version. Use when a patch is no longer needed.',
            parameters: {
                type: 'object',
                properties: {
                    modulePath: {
                        type: 'string',
                        description: 'Module path to remove, e.g. "gateway/gateway"',
                    },
                    reason: {
                        type: 'string',
                        description: 'Why the override is being removed',
                    },
                },
                required: ['modulePath', 'reason'],
            },
            approval: 'auto',
            async execute(args) {
                const modulePath = String(args.modulePath).replace(/^src\//, '').replace(/\.(ts|js)$/, '');
                const reason = String(args.reason);
                const patchPath = resolve(PROJECT_ROOT, 'local', 'src', `${modulePath}.ts`);
                if (!existsSync(patchPath)) {
                    return `No override found for ${modulePath}. Nothing to remove.`;
                }
                unlinkSync(patchPath);
                bus.emit('diagnosis:patch_removed', { modulePath, reason });
                return `Override removed: local/src/${modulePath}.ts\nReason: ${reason}\n\nThe upstream src/${modulePath}.ts will be used on next restart.`;
            },
        },
    ];
}
//# sourceMappingURL=diagnosis-tools.js.map