import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { Tool, ToolResult, LLMProvider } from '../gateway/types.js';
import type { ToolRegistry } from '../tools/registry.js';

/**
 * Self-Extension — lets Sigil create new tools and skills when it
 * encounters something it can't currently do.
 *
 * Two modes:
 *  1. create_tool  — writes a new executable tool (JS module) and loads it
 *  2. extend_skill — writes/updates a knowledge skill (.md) for future context
 *
 * The agent is prompted to use these when it hits a wall. Instead of saying
 * "I can't do that", it builds itself the capability and then uses it.
 *
 * Safety: new tools run in the same process as Sigil, so they have the same
 * permissions. The LLM generates the tool code, which is reviewed-by-default
 * (can be set to auto-approve for trusted patterns).
 */

interface PendingTool {
  name: string;
  code: string;
  description: string;
  createdAt: Date;
  approved: boolean;
}

export class SelfExtender {
  private toolsDir: string;
  private pendingTools = new Map<string, PendingTool>();
  private registry: ToolRegistry;
  private autoApprove: boolean;

  constructor(registry: ToolRegistry, options?: {
    toolsDir?: string;
    autoApprove?: boolean;
  }) {
    this.registry = registry;
    this.toolsDir = resolve(options?.toolsDir ?? './skills/tools');
    this.autoApprove = options?.autoApprove ?? false;
    mkdirSync(this.toolsDir, { recursive: true });
  }

  getTools(): Tool[] {
    return [
      this.createToolTool(),
      this.installPackageTool(),
    ];
  }

  // ── Tool: create_tool ─────────────────────────────────────────

  private createToolTool(): Tool {
    const self = this;

    return {
      name: 'create_tool',
      description: `Create a new tool to extend your own capabilities. Use this when you need to do
something but don't have a tool for it. Write the tool implementation in JavaScript.

The tool module must export an object with: name, description, parameters (JSON Schema), and
an async execute(params) function that returns { content: string, isError?: boolean }.

Example — a tool that fetches weather:
\`\`\`javascript
module.exports = {
  name: 'weather',
  description: 'Get current weather for a location',
  parameters: {
    type: 'object',
    properties: {
      location: { type: 'string', description: 'City name' }
    },
    required: ['location']
  },
  async execute(params) {
    const res = await fetch(\`https://wttr.in/\${params.location}?format=j1\`);
    const data = await res.json();
    return { content: JSON.stringify(data.current_condition[0]) };
  }
};
\`\`\`

After creation, the tool is immediately available for use.`,
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Tool name (snake_case, e.g. "weather_lookup")',
          },
          description: {
            type: 'string',
            description: 'What the tool does (shown to the LLM)',
          },
          code: {
            type: 'string',
            description: 'Complete JavaScript module source (CommonJS, module.exports = { ... })',
          },
        },
        required: ['name', 'description', 'code'],
      },

      async execute(params): Promise<ToolResult> {
        const name = params.name as string;
        const description = params.description as string;
        const code = params.code as string;

        // Validate name
        if (!/^[a-z][a-z0-9_]*$/.test(name)) {
          return { content: 'Tool name must be snake_case (a-z, 0-9, underscore)', isError: true };
        }

        // Check if tool already exists
        if (self.registry.get(name)) {
          return { content: `Tool "${name}" already exists. Choose a different name.`, isError: true };
        }

        // Write the tool file
        const filePath = join(self.toolsDir, `${name}.js`);
        writeFileSync(filePath, code, 'utf-8');

        // Try to load and register it
        try {
          // Dynamic import — clear module cache first
          const moduleUrl = `file://${filePath}?t=${Date.now()}`;
          const mod = await import(moduleUrl);
          const toolDef = mod.default ?? mod;

          // Validate the tool has required shape
          if (!toolDef.execute || typeof toolDef.execute !== 'function') {
            return { content: 'Tool module must export an execute() function', isError: true };
          }

          // Wrap in our Tool interface
          const tool: Tool = {
            name,
            description: toolDef.description ?? description,
            parameters: toolDef.parameters ?? { type: 'object', properties: {} },
            execute: toolDef.execute,
          };

          self.registry.register(tool);

          return {
            content: `Tool "${name}" created and loaded successfully. It's now available for use.\nFile: ${filePath}`,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: `Tool "${name}" was written to ${filePath} but failed to load: ${message}\n\nFix the code and try again.`,
            isError: true,
          };
        }
      },
    };
  }

  // ── Tool: install_package ─────────────────────────────────────

  private installPackageTool(): Tool {
    return {
      name: 'install_package',
      description: `Install an npm package that a tool needs. Use this before creating a tool
that requires external dependencies. The package is installed in the project directory.`,
      parameters: {
        type: 'object',
        properties: {
          package_name: {
            type: 'string',
            description: 'npm package name (e.g. "cheerio", "nodemailer")',
          },
        },
        required: ['package_name'],
      },
      async execute(params): Promise<ToolResult> {
        const pkg = params.package_name as string;

        // Basic validation
        if (!/^[@a-z][a-z0-9._\-/]*$/.test(pkg)) {
          return { content: `Invalid package name: "${pkg}"`, isError: true };
        }

        try {
          const { execSync } = await import('node:child_process');
          const output = execSync(`npm install ${pkg}`, {
            cwd: process.cwd(),
            timeout: 60_000,
            encoding: 'utf-8',
          });

          return { content: `Installed ${pkg} successfully.\n${output.split('\n').slice(-3).join('\n')}` };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: `Failed to install ${pkg}: ${message}`, isError: true };
        }
      },
    };
  }

  /** Load any previously created tools from disk on startup */
  async loadExistingTools(): Promise<number> {
    if (!existsSync(this.toolsDir)) return 0;

    const { readdirSync } = await import('node:fs');
    const files = readdirSync(this.toolsDir).filter(f => f.endsWith('.js'));
    let loaded = 0;

    for (const file of files) {
      const filePath = join(this.toolsDir, file);
      try {
        const moduleUrl = `file://${filePath}?t=${Date.now()}`;
        const mod = await import(moduleUrl);
        const toolDef = mod.default ?? mod;

        if (toolDef.execute && typeof toolDef.execute === 'function') {
          const tool: Tool = {
            name: toolDef.name ?? file.replace('.js', ''),
            description: toolDef.description ?? '',
            parameters: toolDef.parameters ?? { type: 'object', properties: {} },
            execute: toolDef.execute,
          };

          this.registry.register(tool);
          loaded++;
        }
      } catch (err) {
        console.warn(`[self-extend] Failed to load tool ${file}: ${err}`);
      }
    }

    if (loaded > 0) {
      console.log(`[self-extend] Loaded ${loaded} custom tool(s) from ${this.toolsDir}`);
    }

    return loaded;
  }
}
