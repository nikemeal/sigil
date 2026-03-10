import { readFileSync, readdirSync, existsSync, watch } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import type { Tool, ToolResult } from '../gateway/types.js';

interface Skill {
  name: string;
  description: string;
  content: string;
  filePath: string;
  loadedAt: Date;
}

/**
 * SkillLoader manages skill files (markdown knowledge packs) and
 * tool definitions (TypeScript/JS modules) from the skills directory.
 *
 * Skills are hot-reloaded — drop a new .md or .ts file in /skills/
 * and it's available immediately, no restart needed.
 *
 * Two types:
 *  - .md files → knowledge injected into system prompt (passive skills)
 *  - .tool.ts/.tool.js files → registered as executable tools (active skills)
 */
export class SkillLoader {
  private skillsDir: string;
  private skills = new Map<string, Skill>();
  private watcher: ReturnType<typeof watch> | null = null;
  private onToolAdded?: (tool: Tool) => void;

  constructor(skillsDir = './skills') {
    this.skillsDir = resolve(skillsDir);
  }

  /** Load all skills and start watching for changes */
  start(onToolAdded?: (tool: Tool) => void): void {
    this.onToolAdded = onToolAdded;
    this.loadAll();
    this.watchForChanges();
  }

  /** Get all loaded knowledge skills (for system prompt injection) */
  getKnowledge(): Map<string, string> {
    const knowledge = new Map<string, string>();
    for (const [name, skill] of this.skills) {
      knowledge.set(name, skill.content);
    }
    return knowledge;
  }

  /** Get a specific skill */
  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /** List all loaded skills */
  list(): Array<{ name: string; description: string; loadedAt: Date }> {
    return Array.from(this.skills.values()).map(s => ({
      name: s.name,
      description: s.description,
      loadedAt: s.loadedAt,
    }));
  }

  /** Load all skills from disk */
  private loadAll(): void {
    if (!existsSync(this.skillsDir)) {
      console.log(`[skills] No skills directory at ${this.skillsDir}`);
      return;
    }

    const files = readdirSync(this.skillsDir);
    let loaded = 0;

    for (const file of files) {
      if (file.startsWith('.') || file.startsWith('_')) continue;

      if (file.endsWith('.md')) {
        this.loadMarkdownSkill(file);
        loaded++;
      }
      // TODO: .tool.ts / .tool.js for executable tool skills
    }

    if (loaded > 0) {
      console.log(`[skills] Loaded ${loaded} skill(s): ${Array.from(this.skills.keys()).join(', ')}`);
    }
  }

  /** Load a markdown knowledge skill */
  private loadMarkdownSkill(filename: string): void {
    const filePath = join(this.skillsDir, filename);
    const content = readFileSync(filePath, 'utf-8');
    const name = filename.replace('.md', '');

    // Extract description from first paragraph or heading
    const firstLine = content.split('\n').find(l => l.trim() && !l.startsWith('#')) ?? '';
    const description = firstLine.slice(0, 200);

    this.skills.set(name, {
      name,
      description,
      content,
      filePath,
      loadedAt: new Date(),
    });
  }

  /** Watch the skills directory for changes */
  private watchForChanges(): void {
    if (!existsSync(this.skillsDir)) return;

    try {
      this.watcher = watch(this.skillsDir, { persistent: false }, (eventType, filename) => {
        if (!filename) return;

        const filePath = join(this.skillsDir, filename);

        if (filename.endsWith('.md')) {
          if (existsSync(filePath)) {
            console.log(`[skills] Reloading skill: ${filename}`);
            this.loadMarkdownSkill(filename);
          } else {
            const name = filename.replace('.md', '');
            this.skills.delete(name);
            console.log(`[skills] Removed skill: ${name}`);
          }
        }
      });

      console.log(`[skills] Watching ${this.skillsDir} for changes`);
    } catch {
      console.warn('[skills] Could not set up file watcher');
    }
  }

  stop(): void {
    this.watcher?.close();
  }
}

/**
 * Tool that lets the agent manage its own skills.
 */
export function createSkillManagementTool(loader: SkillLoader): Tool {
  return {
    name: 'manage_skills',
    description: `View and manage loaded skills. Skills are knowledge packs (.md files) in the skills directory that extend your capabilities.`,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'view', 'create'],
          description: 'list: show all skills. view: show a skill\'s content. create: write a new skill file.',
        },
        name: { type: 'string', description: 'Skill name (for view/create)' },
        content: { type: 'string', description: 'Skill content in markdown (for create)' },
      },
      required: ['action'],
    },
    async execute(params): Promise<ToolResult> {
      const action = params.action as string;

      if (action === 'list') {
        const skills = loader.list();
        if (skills.length === 0) return { content: 'No skills loaded.' };
        return {
          content: skills.map(s => `- ${s.name}: ${s.description}`).join('\n'),
        };
      }

      if (action === 'view') {
        const skill = loader.getSkill(params.name as string);
        if (!skill) return { content: `Skill "${params.name}" not found`, isError: true };
        return { content: skill.content };
      }

      if (action === 'create') {
        const name = params.name as string;
        const content = params.content as string;
        if (!name || !content) {
          return { content: 'Both name and content are required', isError: true };
        }

        // Write the skill file — the watcher will pick it up
        const { writeFileSync } = await import('node:fs');
        const filePath = join(loader['skillsDir'], `${name}.md`);
        writeFileSync(filePath, content, 'utf-8');

        return { content: `Created skill "${name}" at ${filePath}. It will be auto-loaded.` };
      }

      return { content: `Unknown action: ${action}`, isError: true };
    },
  };
}
