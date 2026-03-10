import type { Tool, ToolSchema, ToolResult } from '../gateway/types.js';

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      console.warn(`Tool "${tool.name}" already registered, overwriting.`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getSchemas(): ToolSchema[] {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  async execute(name: string, params: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { content: `Unknown tool: ${name}`, isError: true };
    }

    try {
      return await tool.execute(params);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Tool "${name}" failed: ${message}`, isError: true };
    }
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }
}
