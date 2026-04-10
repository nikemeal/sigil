/**
 * Conversation Store
 *
 * Persists conversation history to SQLite. Single 'main' thread shared
 * across all transports — what you say on Telegram, the TUI sees.
 *
 * Handles progressive compression:
 *   - Last ~20 messages: kept verbatim
 *   - Messages 20-50: summarised into a paragraph
 *   - Messages 50+: compressed to bullet points or dropped
 *
 * This keeps the context window manageable for long conversations
 * while preserving recent detail.
 */
import type Database from 'better-sqlite3';
import type { LLMMessage } from '../types.js';
export interface StoredMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    source: string | null;
    timestamp: Date;
    tokenCount: number | null;
}
export declare class ConversationStore {
    private db;
    constructor(db: Database.Database);
    /** Add a message to the conversation */
    addMessage(id: string, role: StoredMessage['role'], content: string, source?: string): void;
    /**
     * Get recent messages for the LLM context window.
     * Returns the last `limit` messages in chronological order.
     * Uses seq (autoincrement) for reliable ordering.
     */
    getRecent(limit?: number): StoredMessage[];
    /**
     * Build the conversation history for the LLM, with progressive compression.
     *
     * Returns:
     *   - Compressed summary of old messages (if any)
     *   - Recent messages verbatim
     *
     * The summariser function is injected so we can use the LLM itself
     * to generate summaries (in module 2, we use a simple approach;
     * module 5 can route summaries to a cheap model).
     */
    buildHistory(summariser?: (messages: StoredMessage[]) => Promise<string>): Promise<LLMMessage[]>;
    /** Get the total number of messages */
    getMessageCount(): number;
    /** Clear all messages and summaries (for testing) */
    clear(): void;
    /** Store a conversation summary */
    private storeSummary;
    /** Get the most recent summary */
    private getLatestSummary;
    private rowToMessage;
}
//# sourceMappingURL=conversation.d.ts.map