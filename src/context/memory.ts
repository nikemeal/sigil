import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface MemoryEntry {
  id: number;
  content: string;
  type: 'fact' | 'interaction' | 'preference' | 'note';
  tags: string[];
  createdAt: Date;
  lastAccessed: Date;
  accessCount: number;
}

/**
 * Simple keyword-based memory store using SQLite FTS5.
 *
 * Phase 1: Full-text search (good enough to start)
 * Phase 2: Add vector embeddings via sqlite-vss for semantic recall
 */
export class MemoryStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'fact',
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_accessed TEXT NOT NULL DEFAULT (datetime('now')),
        access_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content, tags, content=memories, content_rowid=id
      );

      -- Triggers to keep FTS in sync
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags);
        INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
      END;

      -- Conversations table for thread persistence
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        messages TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Scheduled jobs
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        cron TEXT NOT NULL,
        prompt TEXT NOT NULL,
        transport TEXT NOT NULL DEFAULT 'tui',
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run TEXT
      );
    `);
  }

  /** Store a new memory */
  remember(content: string, type: MemoryEntry['type'] = 'fact', tags: string[] = []): number {
    const stmt = this.db.prepare(
      'INSERT INTO memories (content, type, tags) VALUES (?, ?, ?)'
    );
    const result = stmt.run(content, type, JSON.stringify(tags));
    return result.lastInsertRowid as number;
  }

  /** Recall memories matching a query (FTS5 search) */
  recall(query: string, limit = 10): MemoryEntry[] {
    // Sanitize query for FTS5
    const sanitized = query
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1)
      .map(w => `"${w}"`)
      .join(' OR ');

    if (!sanitized) return [];

    const stmt = this.db.prepare(`
      SELECT m.*, rank
      FROM memories_fts fts
      JOIN memories m ON m.id = fts.rowid
      WHERE memories_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);

    const rows = stmt.all(sanitized, limit) as Array<Record<string, unknown>>;

    // Update access counts
    const updateStmt = this.db.prepare(
      "UPDATE memories SET last_accessed = datetime('now'), access_count = access_count + 1 WHERE id = ?"
    );
    for (const row of rows) {
      updateStmt.run(row.id);
    }

    return rows.map(this.rowToMemory);
  }

  /** Get all memories (for context building) */
  recentMemories(limit = 20): MemoryEntry[] {
    const stmt = this.db.prepare(
      'SELECT * FROM memories ORDER BY created_at DESC LIMIT ?'
    );
    return (stmt.all(limit) as Array<Record<string, unknown>>).map(this.rowToMemory);
  }

  /** Delete a memory */
  forget(id: number): boolean {
    const result = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // --- Conversation persistence ---

  saveConversation(id: string, messages: Array<{ role: string; content: string }>): void {
    this.db.prepare(`
      INSERT INTO conversations (id, messages, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET messages = ?, updated_at = datetime('now')
    `).run(id, JSON.stringify(messages), JSON.stringify(messages));
  }

  loadConversation(id: string): Array<{ role: string; content: string }> | null {
    const row = this.db.prepare('SELECT messages FROM conversations WHERE id = ?').get(id) as
      | { messages: string }
      | undefined;
    return row ? JSON.parse(row.messages) : null;
  }

  // --- Helpers ---

  private rowToMemory(row: Record<string, unknown>): MemoryEntry {
    return {
      id: row.id as number,
      content: row.content as string,
      type: row.type as MemoryEntry['type'],
      tags: JSON.parse(row.tags as string),
      createdAt: new Date(row.created_at as string),
      lastAccessed: new Date(row.last_accessed as string),
      accessCount: row.access_count as number,
    };
  }

  close(): void {
    this.db.close();
  }
}
