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
export declare class ContextEngine {
    private config;
    private memories;
    private conversation;
    private profile;
    private embeddings;
    private skills;
    private bus;
    private techniques;
    constructor(config: SigilConfig, memories: MemoryStore, conversation: ConversationStore, profile: Profile, embeddings: EmbeddingProvider | null, skills?: SkillLoader | null, bus?: EventBus | null, techniques?: TechniqueStore | null);
    /**
     * Build the full message array for an LLM request.
     * This is called once per incoming message.
     * Optional trimConfig controls how much context to include.
     */
    buildContext(message: Message, trimConfig?: TrimConfig): Promise<LLMMessage[]>;
    /**
     * Record a message in conversation history.
     * Called for both user messages and assistant responses.
     */
    recordMessage(id: string, role: 'user' | 'assistant', content: string, source?: string): void;
    /**
     * Store a memory. Optionally generates an embedding if provider is available.
     */
    remember(content: string, type?: 'fact' | 'preference' | 'note', tags?: string[]): Promise<number>;
    /** Search memories by query */
    recall(query: string, limit?: number): Promise<MemorySearchResult[]>;
    /** Get the profile instance (for direct read/write) */
    getProfile(): Profile;
    /** Get the memory store (for diagnostics) */
    getMemories(): MemoryStore;
    /** Get the conversation store */
    getConversation(): ConversationStore;
    /**
     * Build the system prompt with identity, profile, and relevant memories.
     */
    private buildSystemPrompt;
}
//# sourceMappingURL=engine.d.ts.map