/**
 * Technique Store
 *
 * SQLite-backed store for learned techniques.
 * Techniques are procedural knowledge: "when doing X, approach Y works".
 * Separate from memories (which are factual knowledge about the user).
 *
 * Uses FTS5 for keyword search so relevant techniques can be injected
 * into the system prompt when a similar task arrives.
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { TechniqueResult } from '../types.js';

export class TechniqueStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Store a new technique. Returns the UUID. */
  add(
    pattern: string,
    technique: string,
    outcome: string | undefined,
    source: 'explicit' | 'auto',
  ): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO techniques (id, pattern, technique, outcome, source, usage_count, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `).run(id, pattern, technique, outcome ?? null, source, now);
    return id;
  }

  /**
   * FTS5 keyword search over pattern + technique fields.
   * Returns up to `limit` results ordered by relevance.
   */
  search(query: string, limit: number = 3): TechniqueResult[] {
    const terms = query
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1)
      .map((t) => `"${t}"`)
      .join(' OR ');

    if (!terms) return [];

    try {
      const rows = this.db.prepare(`
        SELECT t.*, fts.rank
        FROM techniques_fts fts
        JOIN techniques t ON t.integer_id = fts.rowid
        WHERE techniques_fts MATCH ?
        ORDER BY fts.rank
        LIMIT ?
      `).all(terms, limit) as Array<Record<string, unknown>>;

      return rows.map((r) => this.rowToResult(r));
    } catch {
      // FTS5 query can fail on unusual input — return empty
      return [];
    }
  }

  /** Increment usage count and update last_used for a set of technique IDs. */
  markUsed(ids: string[]): void {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE techniques SET usage_count = usage_count + 1, last_used = ? WHERE id = ?
    `);
    const tx = this.db.transaction(() => {
      for (const id of ids) {
        stmt.run(now, id);
      }
    });
    tx();
  }

  /** List all techniques ordered by usage count descending. */
  list(): TechniqueResult[] {
    const rows = this.db.prepare(`
      SELECT * FROM techniques ORDER BY usage_count DESC, created_at DESC
    `).all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToResult(r));
  }

  /** Delete a technique by UUID. */
  remove(id: string): void {
    this.db.prepare(`DELETE FROM techniques WHERE id = ?`).run(id);
  }

  private rowToResult(row: Record<string, unknown>): TechniqueResult {
    return {
      id: row.id as string,
      pattern: row.pattern as string,
      technique: row.technique as string,
      outcome: (row.outcome as string | null) ?? undefined,
      source: row.source as 'explicit' | 'auto',
      usageCount: row.usage_count as number,
      createdAt: row.created_at as string,
      lastUsed: (row.last_used as string | null) ?? undefined,
    };
  }
}
