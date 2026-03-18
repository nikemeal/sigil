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

export class ContextEngine {
  private config: SigilConfig;
  private memories: MemoryStore;
  private conversation: ConversationStore;
  private profile: Profile;
  private embeddings: EmbeddingProvider | null;

  constructor(
    config: SigilConfig,
    memories: MemoryStore,
    conversation: ConversationStore,
    profile: Profile,
    embeddings: EmbeddingProvider | null,
  ) {
    this.config = config;
    this.memories = memories;
    this.conversation = conversation;
    this.profile = profile;
    this.embeddings = embeddings;
  }

  /**
   * Build the full message array for an LLM request.
   * This is called once per incoming message.
   */
  async buildContext(message: Message): Promise<LLMMessage[]> {
    const messages: LLMMessage[] = [];

    // 1. System prompt (identity + profile + memories)
    const systemPrompt = await this.buildSystemPrompt(message.content);
    messages.push({ role: 'system', content: systemPrompt });

    // 2. Conversation history (compressed older + recent verbatim)
    const history = await this.conversation.buildHistory();
    messages.push(...history);

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
  private async buildSystemPrompt(currentMessage: string): Promise<string> {
    const parts: string[] = [];

    // Identity
    parts.push(`You are ${this.config.identity.name}.`);
    parts.push(this.config.identity.personality);

    // Living profile
    const profileContent = this.profile.get();
    if (profileContent && !profileContent.includes('No information yet')) {
      parts.push(`\n--- User Profile ---\n${profileContent}`);
    }

    // Recall relevant memories
    const recalled = await this.recall(currentMessage);
    if (recalled.length > 0) {
      const memoryText = recalled
        .map((r) => `- ${r.memory.content}`)
        .join('\n');
      parts.push(`\n--- Relevant Memories ---\n${memoryText}`);
    }

    return parts.join('\n\n');
  }
}
