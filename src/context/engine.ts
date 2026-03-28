/**
 * Context Engine
 *
 * Assembles the full context window for each LLM request.
 * Pulls together:
 *   - Agent identity and personality (from config)
 *   - Living profile (always present)
 *   - Recalled memories (searched per-message via FTS5 + vectors)
 *   - Conversation history (recent verbatim + compressed older)
 *   - Current message
 *
 * This is the brain's working memory — everything the LLM sees.
 */

import type { LLMMessage, SigilConfig, Message } from '../types.js';
import { MemoryStore, type MemorySearchResult } from './memory.js';
import { ConversationStore } from './conversation.js';
import { Profile } from './profile.js';
import { type EmbeddingProvider } from './embeddings.js';
import { type TrimConfig } from '../router/trimmer.js';
import { type SkillLoader } from './skills.js';
import type { EventBus } from '../lib/event-bus.js';
import type { TechniqueStore } from '../learning/store.js';

export class ContextEngine {
  private config: SigilConfig;
  private memories: MemoryStore;
  private conversation: ConversationStore;
  private profile: Profile;
  private embeddings: EmbeddingProvider | null;
  private skills: SkillLoader | null;
  private bus: EventBus | null;
  private techniques: TechniqueStore | null;

  constructor(
    config: SigilConfig,
    memories: MemoryStore,
    conversation: ConversationStore,
    profile: Profile,
    embeddings: EmbeddingProvider | null,
    skills?: SkillLoader | null,
    bus?: EventBus | null,
    techniques?: TechniqueStore | null,
  ) {
    this.config = config;
    this.memories = memories;
    this.conversation = conversation;
    this.profile = profile;
    this.embeddings = embeddings;
    this.skills = skills ?? null;
    this.bus = bus ?? null;
    this.techniques = techniques ?? null;
  }

  /**
   * Build the full message array for an LLM request.
   * This is called once per incoming message.
   * Optional trimConfig controls how much context to include.
   */
  async buildContext(message: Message, trimConfig?: TrimConfig): Promise<LLMMessage[]> {
    const messages: LLMMessage[] = [];

    // 1. System prompt (identity + profile + optionally memories)
    const includeMemories = trimConfig ? trimConfig.includeMemories : true;
    const systemPrompt = await this.buildSystemPrompt(
      includeMemories ? message.content : null,
    );
    messages.push({ role: 'system', content: systemPrompt });

    // 2. Conversation history (trimmed based on config)
    const maxHistory = trimConfig?.maxHistory ?? 20;
    const recent = this.conversation.getRecent(maxHistory);
    for (const msg of recent) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // 3. Current message
    messages.push({ role: 'user', content: message.content });

    return messages;
  }

  /**
   * Record a message in conversation history.
   * Called for both user messages and assistant responses.
   */
  recordMessage(id: string, role: 'user' | 'assistant', content: string, source?: string): void {
    this.conversation.addMessage(id, role, content, source);
  }

  /**
   * Store a memory. Optionally generates an embedding if provider is available.
   */
  async remember(content: string, type: 'fact' | 'preference' | 'note' = 'fact', tags: string[] = []): Promise<number> {
    const id = this.memories.store(content, type, tags);

    // Generate embedding if available
    if (this.embeddings) {
      try {
        const vector = await this.embeddings.embed(content);
        this.memories.storeEmbedding(id, vector, this.config.memory.embeddingModel!);
      } catch (err) {
        console.warn('[Context] Failed to generate embedding:', (err as Error).message);
        // Memory is still stored, just without vector search
      }
    }

    return id;
  }

  /** Search memories by query */
  async recall(query: string, limit?: number): Promise<MemorySearchResult[]> {
    let queryVector: number[] | null = null;

    if (this.embeddings) {
      try {
        queryVector = await this.embeddings.embed(query);
      } catch {
        // Fall back to FTS5 only
      }
    }

    return this.memories.search(query, queryVector, limit ?? this.config.memory.maxRecallResults);
  }

  /** Get the profile instance (for direct read/write) */
  getProfile(): Profile {
    return this.profile;
  }

  /** Get the memory store (for diagnostics) */
  getMemories(): MemoryStore {
    return this.memories;
  }

  /** Get the conversation store */
  getConversation(): ConversationStore {
    return this.conversation;
  }

  /**
   * Build the system prompt with identity, profile, and relevant memories.
   */
  private async buildSystemPrompt(currentMessage: string | null): Promise<string> {
    const parts: string[] = [];

    // Identity
    parts.push(`You are ${this.config.identity.name}.`);
    parts.push(this.config.identity.personality);

    // Environment context — so the agent knows where it lives
    parts.push(`\n--- Environment ---`);
    parts.push(`Working directory: ${process.cwd()}`);
    parts.push(`Config file: sigil.toml`);
    parts.push(`Database: ${this.config.memory.dbPath}`);
    parts.push(`Profile: data/profile.md`);
    parts.push(`When asked about your own files, check the working directory first.`);

    // Background task guidance
    parts.push(`\n--- Background Tasks ---`);
    parts.push(`You can create background tasks for complex work using the create_task tool.`);
    parts.push(`Use it when a request involves research, investigation, multi-step analysis, or anything time-consuming.`);
    parts.push(`Do NOT use it for simple questions, quick answers, or conversational replies.`);
    parts.push(`When you create a background task, briefly acknowledge it and let the user know you'll follow up.`);
    parts.push(`Use list_tasks when the user asks what you're working on or about task status.`);

    // Self-sufficiency directives (module 9)
    parts.push(`\n--- Self-Sufficiency ---`);
    parts.push(`You are a self-sufficient agent. You can read, understand, and modify your own source code.`);
    parts.push(`Your codebase lives in src/. You NEVER modify files in src/ directly — that's upstream code.`);
    parts.push(`Instead, write fixes to local/src/ using the apply_patch tool. The module loader checks local/src/ first, so your patches take effect on restart.`);
    parts.push(`When you encounter an error or something isn't working:`);
    parts.push(`1. Use read_source to examine the relevant code`);
    parts.push(`2. Diagnose the issue`);
    parts.push(`3. Use apply_patch to write a fix (compilation is validated automatically)`);
    parts.push(`4. If the patch fails compilation, read the error and try again (max 3 attempts)`);
    parts.push(`Use list_overrides to see active patches. Use remove_override to clean up patches no longer needed.`);
    parts.push(`You can also create new tools and skills to extend your capabilities.`);
    parts.push(`Use create_tool when you need a capability you don't have (API calls, data processing, etc.).`);
    parts.push(`Use create_skill to save reusable knowledge or workflows.`);
    parts.push(`Use list_custom_tools to see tools you've previously created.`);

    // Active skills — matched by keyword relevance
    if (currentMessage && this.skills) {
      const matched = this.skills.match(currentMessage);
      if (matched.length > 0) {
        const skillsText = matched
          .map((s) => `### ${s.name}\n${s.content}`)
          .join('\n\n');
        parts.push(`\n--- Active Skills ---\n${skillsText}`);
      }
    }

    // Living profile
    const profileContent = this.profile.get();
    if (profileContent && !profileContent.includes('No information yet')) {
      parts.push(`\n--- User Profile ---\n${profileContent}`);
    }

    // Recall relevant memories (skip if currentMessage is null — trimmed mode)
    if (!currentMessage) return parts.join('\n\n');

    const recalled = await this.recall(currentMessage);
    if (recalled.length > 0) {
      const memoryText = recalled
        .map((r) => `- ${r.memory.content}`)
        .join('\n');
      parts.push(`\n--- Relevant Memories ---\n${memoryText}`);
    }

    // Inject relevant techniques (skip if no store configured)
    if (this.techniques) {
      let techniqueResults = this.techniques.search(currentMessage, 3);
      // Fall back to most-used techniques when keyword search finds nothing
      if (techniqueResults.length === 0) {
        techniqueResults = this.techniques.list().slice(0, 3);
      }
      if (techniqueResults.length > 0) {
        const ids = techniqueResults.map((t) => t.id);
        const techniqueText = techniqueResults
          .map((t) => `- ${t.pattern}: ${t.technique}`)
          .join('\n');
        this.techniques.markUsed(ids);
        if (this.bus) {
          this.bus.emit('learning:technique_used', { ids, query: currentMessage });
        }
        parts.push(`\n--- Techniques from past experience ---\n${techniqueText}`);
      }
    }

    return parts.join('\n\n');
  }
}
