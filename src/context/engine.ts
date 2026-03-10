import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { Message, SigilConfig } from '../gateway/types.js';
import { MemoryStore } from './memory.js';

interface ContextWindow {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

interface ConversationThread {
  id: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export class ContextEngine {
  private memory: MemoryStore;
  private threads = new Map<string, ConversationThread>();
  private config: SigilConfig;
  private skills: Map<string, string> = new Map();

  constructor(config: SigilConfig) {
    this.config = config;
    this.memory = new MemoryStore(resolve(config.memory.dbPath));
    this.loadSkills();
  }

  /** Load skill files from /skills/ directory */
  private loadSkills(): void {
    const skillsDir = resolve('skills');
    if (!existsSync(skillsDir)) return;

    const files = readdirSync(skillsDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const name = file.replace('.md', '');
      const content = readFileSync(join(skillsDir, file), 'utf-8');
      this.skills.set(name, content);
    }

    if (this.skills.size > 0) {
      console.log(`Loaded ${this.skills.size} skill(s): ${Array.from(this.skills.keys()).join(', ')}`);
    }
  }

  /** Build the full context window for a message */
  async assemble(message: Message): Promise<ContextWindow> {
    // Get or create thread
    const threadId = message.threadId ?? message.source;
    const thread = this.getOrCreateThread(threadId);

    // Recall relevant memories
    const memories = this.memory.recall(message.content, this.config.memory.maxRecall);

    // Build system prompt
    const system = this.buildSystemPrompt(memories);

    // Add the new user message to the thread
    thread.messages.push({ role: 'user', content: message.content });

    // Keep conversation history manageable (last 50 turns)
    const recentMessages = thread.messages.slice(-50);

    return { system, messages: recentMessages };
  }

  /** Store the assistant's response in the thread */
  storeResponse(threadId: string, content: string): void {
    const thread = this.threads.get(threadId);
    if (thread) {
      thread.messages.push({ role: 'assistant', content });
      // Persist to SQLite
      this.memory.saveConversation(thread.id, thread.messages);
    }
  }

  /** Extract and store a memory from conversation */
  remember(content: string, type: 'fact' | 'preference' | 'note' = 'fact', tags: string[] = []): number {
    return this.memory.remember(content, type, tags);
  }

  /** Get the memory store directly (for the memory tool) */
  getMemory(): MemoryStore {
    return this.memory;
  }

  private buildSystemPrompt(memories: Array<{ content: string }>): string {
    const parts: string[] = [];

    // Identity
    parts.push(`# Identity\nYou are ${this.config.identity.name}.\n\n${this.config.identity.personality}`);

    // Current time
    parts.push(`\n# Current Time\n${new Date().toLocaleString('en-GB', { timeZone: this.config.scheduler.timezone })}`);

    // Memories
    if (memories.length > 0) {
      parts.push('\n# Relevant Memories');
      for (const mem of memories) {
        parts.push(`- ${mem.content}`);
      }
    }

    // Skills
    if (this.skills.size > 0) {
      parts.push('\n# Available Knowledge');
      for (const [name, content] of this.skills) {
        parts.push(`\n## ${name}\n${content}`);
      }
    }

    // Tool guidance
    parts.push(`
# Tool Usage
You have access to tools. Use them proactively — don't ask for permission to do things you can do.
If the user asks you to remember something, use the remember tool.
If a task needs a shell command, run it. If you need to read or write files, do it.
Be direct. Get things done. Report back concisely.

# Autonomous Behaviour
For complex or time-consuming requests, use create_task to work in the background.
Tell the user you'll work on it and message them when done. Don't make them wait.
Use schedule_self to set up future check-ins, follow-ups, or recurring work.

# Self-Improvement
Before starting complex work, use recall_techniques to check if you've learned good
approaches for similar tasks. After completing significant work, use log_attempt to
self-evaluate and save_technique if you found an effective approach.

If you score below 6 on a self-evaluation, iterate: try a different approach, re-evaluate,
and converge on something better before delivering. You get better over time.

# Self-Extension
If you need a capability you don't have, build it:
1. Use create_tool to write a new tool (JavaScript module)
2. Use install_package first if you need an npm dependency
3. The new tool is immediately available after creation

Don't say "I can't do that" — figure out how to give yourself the ability, then do it.
`);

    return parts.join('\n');
  }

  private getOrCreateThread(id: string): ConversationThread {
    let thread = this.threads.get(id);
    if (!thread) {
      // Try loading from persistent storage
      const saved = this.memory.loadConversation(id);
      thread = {
        id,
        messages: (saved as Array<{ role: 'user' | 'assistant'; content: string }>) ?? [],
      };
      this.threads.set(id, thread);
    }
    return thread;
  }

  close(): void {
    this.memory.close();
  }
}
