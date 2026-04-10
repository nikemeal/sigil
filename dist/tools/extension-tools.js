/**
 * Extension Tools (Module 10)
 *
 * Let the agent create new tools and skills at runtime.
 *
 * Tools:
 *   create_tool       — write a new tool to local/tools/, validate, register immediately
 *   create_skill      — write a new skill markdown file to skills/
 *   list_custom_tools  — list agent-created tools in local/tools/
 */
import { writeFileSync, existsSync, readdirSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { loadSingleTool, getLocalToolsDir } from '../lib/tool-loader.js';
const PROJECT_ROOT = process.cwd();
/** Creates extension tools bound to an event bus and tool registry */
export function createExtensionTools(bus, registry) {
    return [
        {
            name: 'create_tool',
            description: 'Create a new tool that extends your capabilities. The tool is written to local/tools/, validated for compilation, and registered immediately — no restart needed. Use this when you need a capability you don\'t have (API calls, data processing, custom commands, etc.).',
            parameters: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'Tool name in snake_case, e.g. "bitcoin_price" or "weather_lookup"',
                    },
                    description: {
                        type: 'string',
                        description: 'What the tool does — this is shown to you in future conversations',
                    },
                    parameters: {
                        type: 'string',
                        description: 'JSON schema string for the tool parameters, e.g. \'{ "type": "object", "properties": { "query": { "type": "string", "description": "Search query" } }, "required": ["query"] }\'',
                    },
                    code: {
                        type: 'string',
                        description: 'The async function body. Receives `args` (Record<string, unknown>). Must return a string. Can use Node.js built-ins. Example: \'const res = await fetch("https://api.example.com"); return await res.text();\'',
                    },
                    approval: {
                        type: 'string',
                        description: 'Approval level: "auto" (no confirmation) or "prompt" (ask user). Default: "auto"',
                    },
                },
                required: ['name', 'description', 'parameters', 'code'],
            },
            approval: 'auto',
            async execute(args) {
                const name = String(args.name).replace(/[^a-z0-9_]/g, '_');
                const description = String(args.description);
                const parametersStr = String(args.parameters);
                const code = String(args.code);
                const approval = args.approval === 'prompt' ? 'prompt' : 'auto';
                // Validate parameters JSON
                let parametersObj;
                try {
                    parametersObj = JSON.parse(parametersStr);
                }
                catch {
                    return 'Error: parameters must be valid JSON. Provide a JSON schema object.';
                }
                // Generate the TypeScript file
                const fileContent = `/**
 * Agent-created tool: ${name}
 * Created: ${new Date().toISOString()}
 */

import type { Tool } from '../../src/types.js';

const tool: Tool = {
  name: '${name}',
  description: ${JSON.stringify(description)},
  parameters: ${JSON.stringify(parametersObj, null, 2)},
  approval: '${approval}',
  async execute(args: Record<string, unknown>): Promise<string> {
    ${code}
  },
};

export default tool;
`;
                const toolsDir = getLocalToolsDir();
                const filePath = resolve(toolsDir, `${name}.ts`);
                // Create directory
                mkdirSync(toolsDir, { recursive: true });
                // Write file
                writeFileSync(filePath, fileContent, 'utf-8');
                // Validate compilation
                try {
                    execSync('node_modules/.bin/tsc --noEmit', {
                        cwd: PROJECT_ROOT,
                        timeout: 30_000,
                        stdio: 'pipe',
                    });
                }
                catch (err) {
                    // Remove invalid file
                    try {
                        unlinkSync(filePath);
                    }
                    catch { }
                    const stderr = err.stderr?.toString() ?? '';
                    const summary = stderr.split('\n').slice(0, 10).join('\n');
                    return `Tool rejected — compilation failed:\n${summary}\n\nFix the errors and try again.`;
                }
                // Dynamically import and register
                try {
                    const tool = await loadSingleTool(filePath);
                    registry.register(tool);
                    bus.emit('extension:tool_created', { name, path: `local/tools/${name}.ts` });
                    return `Tool "${name}" created and registered. You can use it immediately.\nFile: local/tools/${name}.ts`;
                }
                catch (err) {
                    try {
                        unlinkSync(filePath);
                    }
                    catch { }
                    return `Tool file compiled but failed to load: ${err.message}`;
                }
            },
        },
        {
            name: 'create_skill',
            description: 'Create a new skill file. Skills are markdown documents with knowledge, workflows, or guidance that get injected into your context when relevant. They persist across restarts and are matched by trigger keywords.',
            parameters: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'Skill name (kebab-case), e.g. "deployment-process" or "code-review-checklist"',
                    },
                    description: {
                        type: 'string',
                        description: 'One-line description of what this skill covers',
                    },
                    triggers: {
                        type: 'string',
                        description: 'Comma-separated trigger words that activate this skill, e.g. "deploy, deployment, release, ship"',
                    },
                    content: {
                        type: 'string',
                        description: 'The skill content in markdown',
                    },
                },
                required: ['name', 'description', 'triggers', 'content'],
            },
            approval: 'auto',
            async execute(args) {
                const name = String(args.name);
                const description = String(args.description);
                const triggers = String(args.triggers);
                const content = String(args.content);
                const skillsDir = resolve(PROJECT_ROOT, 'skills');
                mkdirSync(skillsDir, { recursive: true });
                const filePath = resolve(skillsDir, `${name}.md`);
                const fileContent = `---
name: ${name}
description: ${description}
triggers: [${triggers.split(',').map((t) => t.trim()).join(', ')}]
---

${content}
`;
                writeFileSync(filePath, fileContent, 'utf-8');
                bus.emit('extension:skill_created', { name, path: `skills/${name}.md` });
                return `Skill "${name}" created at skills/${name}.md\nIt will be automatically matched when messages contain: ${triggers}\n\nSkills are active immediately — no restart needed.`;
            },
        },
        {
            name: 'list_custom_tools',
            description: 'List agent-created tools in local/tools/. Shows which custom tools exist and whether they are currently registered.',
            parameters: {
                type: 'object',
                properties: {},
                required: [],
            },
            approval: 'auto',
            async execute() {
                const toolsDir = getLocalToolsDir();
                if (!existsSync(toolsDir)) {
                    return 'No custom tools. Use create_tool to build new capabilities.';
                }
                const files = readdirSync(toolsDir).filter((f) => f.endsWith('.ts') || f.endsWith('.js'));
                if (files.length === 0) {
                    return 'No custom tools. Use create_tool to build new capabilities.';
                }
                const lines = files.map((file) => {
                    const toolName = file.replace(/\.(ts|js)$/, '');
                    const registered = registry.get(toolName) !== undefined;
                    const status = registered ? 'registered' : 'not loaded';
                    return `- ${toolName} (${status}) — local/tools/${file}`;
                });
                return `Custom tools (${files.length}):\n${lines.join('\n')}`;
            },
        },
    ];
}
//# sourceMappingURL=extension-tools.js.map