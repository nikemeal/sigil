/**
 * Memory Store
 *
 * Long-term memory with dual retrieval:
 *   - FTS5 keyword search (always available)
 *   - Vector embedding search (when embedding provider configured)
 *
 * Memories are facts, preferences, and notes the agent decides to keep.
 * They're retrieved automatically on each request based on relevance
 * to the current message.
 *
 * Memory decay: relevance decreases over time unless accessed.
 * This naturally surfaces frequently-useful memories and lets
 * stale ones fade.
 */
/** How fast memories decay (per day without access) */
const DECAY_RATE = 0.02;
/** Minimum relevance before a memory is considered stale */
const MIN_RELEVANCE = 0.1;
export class MemoryStore {
    db;
    constructor(db) {
        this.db = db;
    }
    /** Store a new memory. Returns the memory id. */
    store(content, type = 'fact', tags = []) {
        const now = new Date().toISOString();
        const result = this.db.prepare(`
      INSERT INTO memories (type, content, tags, relevance, access_count, created_at, last_accessed)
      VALUES (?, ?, ?, 1.0, 0, ?, ?)
    `).run(type, content, tags.join(','), now, now);
        return result.lastInsertRowid;
    }
    /**
     * Search memories using FTS5 keyword search.
     * Returns ranked results with relevance scoring.
     */
    searchByKeyword(query, limit = 5) {
        // Sanitise query for FTS5: split into terms, join with OR
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
        SELECT m.*, rank
        FROM memories_fts fts
        JOIN memories m ON m.id = fts.rowid
        WHERE memories_fts MATCH ?
        AND m.relevance > ?
        ORDER BY rank
        LIMIT ?
      `).all(terms, MIN_RELEVANCE, limit);
            return rows.map((row) => ({
                memory: this.rowToMemory(row),
                score: this.calculateScore(row),
                source: 'fts',
            }));
        }
        catch {
            // FTS5 query can fail on unusual input — return empty
            return [];
        }
    }
    /**
     * Search memories using vector similarity.
     * Requires embedding vectors to be stored.
     * Uses cosine similarity on the stored vectors.
     */
    searchByVector(queryVector, limit = 5) {
        const rows = this.db.prepare(`
      SELECT m.*, e.vector, e.dimensions
      FROM embeddings e
      JOIN memories m ON m.id = e.memory_id
      WHERE m.relevance > ?
    `).all(MIN_RELEVANCE);
        if (rows.length === 0)
            return [];
        // Calculate cosine similarity for each
        const scored = rows.map((row) => {
            const storedVector = blobToVector(row.vector, row.dimensions);
            const similarity = cosineSimilarity(queryVector, storedVector);
            return {
                memory: this.rowToMemory(row),
                score: similarity * this.calculateScore(row),
                source: 'vector',
            };
        });
        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }
    /**
     * Combined search: run both FTS5 and vector search, merge and deduplicate.
     * This is the main entry point for memory recall.
     */
    search(query, queryVector, limit = 5) {
        const ftsResults = this.searchByKeyword(query, limit);
        const vectorResults = queryVector
            ? this.searchByVector(queryVector, limit)
            : [];
        // Merge and deduplicate by memory id
        const seen = new Map();
        for (const result of ftsResults) {
            seen.set(result.memory.id, result);
        }
        for (const result of vectorResults) {
            const existing = seen.get(result.memory.id);
            if (existing) {
                // Both sources found this memory — boost score and mark as 'both'
                existing.score = Math.max(existing.score, result.score) * 1.2;
                existing.source = 'both';
            }
            else {
                seen.set(result.memory.id, result);
            }
        }
        const merged = [...seen.values()]
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
        // Update access counts for retrieved memories
        this.touchMemories(merged.map((r) => r.memory.id));
        return merged;
    }
    /** Store a vector embedding for a memory */
    storeEmbedding(memoryId, vector, model) {
        const blob = vectorToBlob(vector);
        this.db.prepare(`
      INSERT OR REPLACE INTO embeddings (memory_id, vector, model, dimensions)
      VALUES (?, ?, ?, ?)
    `).run(memoryId, blob, model, vector.length);
    }
    /** Apply time-based decay to all memories */
    applyDecay() {
        const now = Date.now();
        const memories = this.db.prepare(`
      SELECT id, relevance, last_accessed FROM memories WHERE relevance > ?
    `).all(MIN_RELEVANCE);
        const update = this.db.prepare(`UPDATE memories SET relevance = ? WHERE id = ?`);
        const tx = this.db.transaction(() => {
            for (const m of memories) {
                const daysSinceAccess = (now - new Date(m.last_accessed).getTime()) / (1000 * 60 * 60 * 24);
                const newRelevance = Math.max(MIN_RELEVANCE, m.relevance - (DECAY_RATE * daysSinceAccess));
                if (newRelevance !== m.relevance) {
                    update.run(newRelevance, m.id);
                }
            }
        });
        tx();
    }
    /** Get all memories (for diagnostics) */
    getAll() {
        const rows = this.db.prepare(`SELECT * FROM memories ORDER BY last_accessed DESC`).all();
        return rows.map((r) => this.rowToMemory(r));
    }
    /** Delete a memory by id */
    delete(id) {
        this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
    }
    /** Update access time and count for retrieved memories */
    touchMemories(ids) {
        if (ids.length === 0)
            return;
        const now = new Date().toISOString();
        const stmt = this.db.prepare(`
      UPDATE memories SET access_count = access_count + 1, last_accessed = ?, relevance = MIN(1.0, relevance + 0.1)
      WHERE id = ?
    `);
        const tx = this.db.transaction(() => {
            for (const id of ids) {
                stmt.run(now, id);
            }
        });
        tx();
    }
    /** Convert a database row to a Memory object */
    rowToMemory(row) {
        return {
            id: row.id,
            type: row.type,
            content: row.content,
            tags: (row.tags || '').split(',').filter(Boolean),
            relevance: row.relevance,
            accessCount: row.access_count,
            createdAt: new Date(row.created_at),
            lastAccessed: new Date(row.last_accessed),
        };
    }
    /** Calculate a combined score from FTS rank and relevance */
    calculateScore(row) {
        const rank = Math.abs(row.rank || 0);
        const relevance = row.relevance;
        // FTS5 rank is negative (lower = better), normalise to 0-1
        const ftsScore = 1 / (1 + rank);
        return ftsScore * relevance;
    }
}
// ── Vector utilities ──────────────────────────────────────────────────
/** Convert a float32 array to a Buffer for SQLite storage */
function vectorToBlob(vector) {
    const buf = Buffer.alloc(vector.length * 4);
    for (let i = 0; i < vector.length; i++) {
        buf.writeFloatLE(vector[i], i * 4);
    }
    return buf;
}
/** Convert a stored Buffer back to a float32 array */
function blobToVector(blob, dimensions) {
    const vector = new Array(dimensions);
    for (let i = 0; i < dimensions; i++) {
        vector[i] = blob.readFloatLE(i * 4);
    }
    return vector;
}
/** Cosine similarity between two vectors */
function cosineSimilarity(a, b) {
    if (a.length !== b.length)
        return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
}
//# sourceMappingURL=memory.js.map