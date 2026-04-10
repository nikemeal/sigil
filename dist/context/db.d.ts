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
/**
 * Get or create the database connection.
 * Call this once at startup — everything else uses the returned instance.
 */
export declare function getDatabase(dbPath: string): Database.Database;
/** Close the database connection (for shutdown) */
export declare function closeDatabase(): void;
//# sourceMappingURL=db.d.ts.map