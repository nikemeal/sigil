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
export class TechniqueStore {
    db;
    constructor(db) {
        this.db = db;
    }
    /** Store a new technique. Returns the UUID. */
    add(pattern, technique, outcome, source) {
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
    search(query, limit = 3) {
        const terms = query
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter((t) => t.length > 1)
            .map((t) => `"${t}"`)
            .join(' OR ');
        if (!terms)
            return [];
        try {
            const rows = this.db.prepare(`
        SELECT t.*, fts.rank
        FROM techniques_fts fts
        JOIN techniques t ON t.integer_id = fts.rowid
        WHERE techniques_fts MATCH ?
        ORDER BY fts.rank
        LIMIT ?
      `).all(terms, limit);
            return rows.map((r) => this.rowToResult(r));
        }
        catch {
            // FTS5 query can fail on unusual input — return empty
            return [];
        }
    }
    /** Increment usage count and update last_used for a set of technique IDs. */
    markUsed(ids) {
        if (ids.length === 0)
            return;
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
    list() {
        const rows = this.db.prepare(`
      SELECT * FROM techniques ORDER BY usage_count DESC, created_at DESC
    `).all();
        return rows.map((r) => this.rowToResult(r));
    }
    /** Delete a technique by UUID. */
    remove(id) {
        this.db.prepare(`DELETE FROM techniques WHERE id = ?`).run(id);
    }
    rowToResult(row) {
        return {
            id: row.id,
            pattern: row.pattern,
            technique: row.technique,
            outcome: row.outcome ?? undefined,
            source: row.source,
            usageCount: row.usage_count,
            createdAt: row.created_at,
            lastUsed: row.last_used ?? undefined,
        };
    }
}
//# sourceMappingURL=store.js.map