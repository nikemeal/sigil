/**
 * SQLite Database Setup
 *
 * Single database for all persistent state: conversations, memories, vectors.
 * Uses WAL mode for concurrent reads and better performance.
 * FTS5 virtual table for full-text search on memories.
 *
 * Schema is created on first run, migrated as modules add tables.
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

let db: Database.Database | null = null;

/**
 * Get or create the database connection.
 * Call this once at startup — everything else uses the returned instance.
 */
export function getDatabase(dbPath: string): Database.Database {
  if (db) return db;

  // Ensure the data directory exists
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);

  // Performance settings
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');

  // Create tables
  migrate(db);

  return db;
}

/** Close the database connection (for shutdown) */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Create tables if they don't exist.
 * Each module adds its own tables here. Existing tables are untouched.
 */
function migrate(db: Database.Database): void {
  db.exec(`
    -- Conversation messages (single 'main' thread for now)
    CREATE TABLE IF NOT EXISTS messages (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL,          -- 'user' | 'assistant' | 'system'
      content TEXT NOT NULL,
      source TEXT,                 -- transport that sent it
      timestamp TEXT NOT NULL,
      token_count INTEGER
    );

    -- Long-term memories (facts, preferences, notes)
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'fact',    -- 'fact' | 'preference' | 'note'
      content TEXT NOT NULL,
      tags TEXT,                            -- comma-separated
      relevance REAL NOT NULL DEFAULT 1.0,  -- decays over time
      access_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_accessed TEXT NOT NULL
    );

    -- FTS5 index for keyword search on memories
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      tags,
      content='memories',
      content_rowid='id'
    );

    -- Triggers to keep FTS5 in sync with memories table
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content, tags)
      VALUES (new.id, new.content, new.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, tags)
      VALUES ('delete', old.id, old.content, old.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, tags)
      VALUES ('delete', old.id, old.content, old.tags);
      INSERT INTO memories_fts(rowid, content, tags)
      VALUES (new.id, new.content, new.tags);
    END;

    -- Vector embeddings for semantic search (optional)
    CREATE TABLE IF NOT EXISTS embeddings (
      memory_id INTEGER PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
      vector BLOB NOT NULL,         -- float32 array stored as binary
      model TEXT NOT NULL,          -- which embedding model produced this
      dimensions INTEGER NOT NULL
    );

    -- Conversation summaries (for progressive compression)
    CREATE TABLE IF NOT EXISTS summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      message_range_start TEXT NOT NULL,  -- first message id covered
      message_range_end TEXT NOT NULL,    -- last message id covered
      created_at TEXT NOT NULL
    );
  `);
}
