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
import type Database from 'better-sqlite3';
export interface Memory {
    id: number;
    type: 'fact' | 'preference' | 'note';
    content: string;
    tags: string[];
    relevance: number;
    accessCount: number;
    createdAt: Date;
    lastAccessed: Date;
}
export interface MemorySearchResult {
    memory: Memory;
    score: number;
    source: 'fts' | 'vector' | 'both';
}
export declare class MemoryStore {
    private db;
    constructor(db: Database.Database);
    /** Store a new memory. Returns the memory id. */
    store(content: string, type?: Memory['type'], tags?: string[]): number;
    /**
     * Search memories using FTS5 keyword search.
     * Returns ranked results with relevance scoring.
     */
    searchByKeyword(query: string, limit?: number): MemorySearchResult[];
    /**
     * Search memories using vector similarity.
     * Requires embedding vectors to be stored.
     * Uses cosine similarity on the stored vectors.
     */
    searchByVector(queryVector: number[], limit?: number): MemorySearchResult[];
    /**
     * Combined search: run both FTS5 and vector search, merge and deduplicate.
     * This is the main entry point for memory recall.
     */
    search(query: string, queryVector: number[] | null, limit?: number): MemorySearchResult[];
    /** Store a vector embedding for a memory */
    storeEmbedding(memoryId: number, vector: number[], model: string): void;
    /** Apply time-based decay to all memories */
    applyDecay(): void;
    /** Get all memories (for diagnostics) */
    getAll(): Memory[];
    /** Delete a memory by id */
    delete(id: number): void;
    /** Update access time and count for retrieved memories */
    private touchMemories;
    /** Convert a database row to a Memory object */
    private rowToMemory;
    /** Calculate a combined score from FTS rank and relevance */
    private calculateScore;
}
//# sourceMappingURL=memory.d.ts.map