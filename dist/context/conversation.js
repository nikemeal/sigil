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
/** How many recent messages to keep verbatim */
const VERBATIM_LIMIT = 20;
/** How many messages to include in the summary window */
const SUMMARY_WINDOW = 30;
export class ConversationStore {
    db;
    constructor(db) {
        this.db = db;
    }
    /** Add a message to the conversation */
    addMessage(id, role, content, source) {
        this.db.prepare(`
      INSERT OR REPLACE INTO messages (id, role, content, source, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, role, content, source ?? null, new Date().toISOString());
    }
    /**
     * Get recent messages for the LLM context window.
     * Returns the last `limit` messages in chronological order.
     * Uses seq (autoincrement) for reliable ordering.
     */
    getRecent(limit = VERBATIM_LIMIT) {
        const rows = this.db.prepare(`
      SELECT * FROM messages
      ORDER BY seq DESC
      LIMIT ?
    `).all(limit);
        return rows.reverse().map((r) => this.rowToMessage(r));
    }
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
    async buildHistory(summariser) {
        const result = [];
        // Get total message count
        const countRow = this.db.prepare(`SELECT COUNT(*) as count FROM messages`).get();
        const totalMessages = countRow.count;
        // If we have more than VERBATIM_LIMIT messages, compress older ones
        if (totalMessages > VERBATIM_LIMIT && summariser) {
            // Check for existing summary
            const existingSummary = this.getLatestSummary();
            if (existingSummary) {
                result.push({
                    role: 'system',
                    content: `Previous conversation summary:\n${existingSummary}`,
                });
            }
            else {
                // Get older messages for summarisation
                const olderMessages = this.db.prepare(`
          SELECT * FROM messages
          ORDER BY seq ASC
          LIMIT ?
        `).all(totalMessages - VERBATIM_LIMIT);
                if (olderMessages.length > 0) {
                    const toSummarise = olderMessages.map((r) => this.rowToMessage(r));
                    try {
                        const summary = await summariser(toSummarise);
                        this.storeSummary(summary, toSummarise[0].id, toSummarise[toSummarise.length - 1].id);
                        result.push({
                            role: 'system',
                            content: `Previous conversation summary:\n${summary}`,
                        });
                    }
                    catch {
                        // If summarisation fails, skip it — recent messages still work
                    }
                }
            }
        }
        // Add recent messages verbatim
        const recent = this.getRecent(VERBATIM_LIMIT);
        for (const msg of recent) {
            if (msg.role === 'user' || msg.role === 'assistant') {
                result.push({ role: msg.role, content: msg.content });
            }
        }
        return result;
    }
    /** Get the total number of messages */
    getMessageCount() {
        const row = this.db.prepare(`SELECT COUNT(*) as count FROM messages`).get();
        return row.count;
    }
    /** Clear all messages and summaries (for testing) */
    clear() {
        this.db.prepare(`DELETE FROM messages`).run();
        this.db.prepare(`DELETE FROM summaries`).run();
    }
    /** Store a conversation summary */
    storeSummary(content, rangeStart, rangeEnd) {
        this.db.prepare(`
      INSERT INTO summaries (content, message_range_start, message_range_end, created_at)
      VALUES (?, ?, ?, ?)
    `).run(content, rangeStart, rangeEnd, new Date().toISOString());
    }
    /** Get the most recent summary */
    getLatestSummary() {
        const row = this.db.prepare(`
      SELECT content FROM summaries ORDER BY created_at DESC LIMIT 1
    `).get();
        return row?.content ?? null;
    }
    rowToMessage(row) {
        return {
            id: row.id,
            role: row.role,
            content: row.content,
            source: row.source,
            timestamp: new Date(row.timestamp),
            tokenCount: row.token_count,
        };
    }
}
//# sourceMappingURL=conversation.js.map