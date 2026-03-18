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

/** How many recent messages to keep verbatim */
const VERBATIM_LIMIT = 20;

/** How many messages to include in the summary window */
const SUMMARY_WINDOW = 30;

export class ConversationStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Add a message to the conversation */
  addMessage(
    id: string,
    role: StoredMessage['role'],
    content: string,
    source?: string,
  ): void {
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
  getRecent(limit: number = VERBATIM_LIMIT): StoredMessage[] {
    const rows = this.db.prepare(`
      SELECT * FROM messages
      ORDER BY seq DESC
      LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;

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
  async buildHistory(
    summariser?: (messages: StoredMessage[]) => Promise<string>,
  ): Promise<LLMMessage[]> {
    const result: LLMMessage[] = [];

    // Get total message count
    const countRow = this.db.prepare(`SELECT COUNT(*) as count FROM messages`).get() as { count: number };
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
      } else {
        // Get older messages for summarisation
        const olderMessages = this.db.prepare(`
          SELECT * FROM messages
          ORDER BY seq ASC
          LIMIT ?
        `).all(totalMessages - VERBATIM_LIMIT) as Array<Record<string, unknown>>;

        if (olderMessages.length > 0) {
          const toSummarise = olderMessages.map((r) => this.rowToMessage(r));
          try {
            const summary = await summariser(toSummarise);
            this.storeSummary(
              summary,
              toSummarise[0].id,
              toSummarise[toSummarise.length - 1].id,
            );
            result.push({
              role: 'system',
              content: `Previous conversation summary:\n${summary}`,
            });
          } catch {
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
  getMessageCount(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM messages`).get() as { count: number };
    return row.count;
  }

  /** Clear all messages and summaries (for testing) */
  clear(): void {
    this.db.prepare(`DELETE FROM messages`).run();
    this.db.prepare(`DELETE FROM summaries`).run();
  }

  /** Store a conversation summary */
  private storeSummary(content: string, rangeStart: string, rangeEnd: string): void {
    this.db.prepare(`
      INSERT INTO summaries (content, message_range_start, message_range_end, created_at)
      VALUES (?, ?, ?, ?)
    `).run(content, rangeStart, rangeEnd, new Date().toISOString());
  }

  /** Get the most recent summary */
  private getLatestSummary(): string | null {
    const row = this.db.prepare(`
      SELECT content FROM summaries ORDER BY created_at DESC LIMIT 1
    `).get() as { content: string } | undefined;
    return row?.content ?? null;
  }

  private rowToMessage(row: Record<string, unknown>): StoredMessage {
    return {
      id: row.id as string,
      role: row.role as StoredMessage['role'],
      content: row.content as string,
      source: row.source as string | null,
      timestamp: new Date(row.timestamp as string),
      tokenCount: row.token_count as number | null,
    };
  }
}
