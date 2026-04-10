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
let db = null;
/**
 * Get or create the database connection.
 * Call this once at startup — everything else uses the returned instance.
 */
export function getDatabase(dbPath) {
    if (db)
        return db;
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
export function closeDatabase() {
    if (db) {
        db.close();
        db = null;
    }
}
/**
 * Create tables if they don't exist.
 * Each module adds its own tables here. Existing tables are untouched.
 */
function migrate(db) {
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

    -- Usage/cost tracking per request
    CREATE TABLE IF NOT EXISTS usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      model TEXT NOT NULL,
      tier TEXT NOT NULL,
      request_type TEXT NOT NULL,         -- 'chat' | 'question' | 'tool' | 'complex'
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost REAL NOT NULL DEFAULT 0,
      routed_by TEXT,                     -- 'heuristic' | 'classifier' | 'override'
      override TEXT,                      -- '/local' | '/cloud' | '/private' | null
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage(timestamp);

    -- Routing patterns for learning (Module 11 uses this)
    CREATE TABLE IF NOT EXISTS routing_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,              -- normalised message pattern
      classified_type TEXT NOT NULL,      -- what the router decided
      actual_tokens INTEGER,             -- how many tokens it actually used
      model_used TEXT,
      created_at TEXT NOT NULL
    );

    -- Background tasks (Module 6)
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      result TEXT,
      source TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      total_cost REAL DEFAULT 0,
      total_tokens INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

    -- Task orchestration steps
    CREATE TABLE IF NOT EXISTS task_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      step_number INTEGER NOT NULL,
      description TEXT NOT NULL,
      assigned_model TEXT,
      assigned_tier TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      result TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      started_at TEXT,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_task_steps_task ON task_steps(task_id);

    -- Learned techniques (Module 11)
    CREATE TABLE IF NOT EXISTS techniques (
      integer_id INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT UNIQUE NOT NULL,
      pattern TEXT NOT NULL,
      technique TEXT NOT NULL,
      outcome TEXT,
      source TEXT NOT NULL DEFAULT 'explicit',
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_used TEXT
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS techniques_fts USING fts5(
      pattern,
      technique,
      content='techniques',
      content_rowid='integer_id'
    );

    CREATE TRIGGER IF NOT EXISTS techniques_ai AFTER INSERT ON techniques BEGIN
      INSERT INTO techniques_fts(rowid, pattern, technique)
      VALUES (new.integer_id, new.pattern, new.technique);
    END;

    CREATE TRIGGER IF NOT EXISTS techniques_ad AFTER DELETE ON techniques BEGIN
      INSERT INTO techniques_fts(techniques_fts, rowid, pattern, technique)
      VALUES ('delete', old.integer_id, old.pattern, old.technique);
    END;

    CREATE TRIGGER IF NOT EXISTS techniques_au AFTER UPDATE ON techniques BEGIN
      INSERT INTO techniques_fts(techniques_fts, rowid, pattern, technique)
      VALUES ('delete', old.integer_id, old.pattern, old.technique);
      INSERT INTO techniques_fts(rowid, pattern, technique)
      VALUES (new.integer_id, new.pattern, new.technique);
    END;
  `);
}
//# sourceMappingURL=db.js.map