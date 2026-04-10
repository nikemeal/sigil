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
import type Database from 'better-sqlite3';
import type { TechniqueResult } from '../types.js';
export declare class TechniqueStore {
    private db;
    constructor(db: Database.Database);
    /** Store a new technique. Returns the UUID. */
    add(pattern: string, technique: string, outcome: string | undefined, source: 'explicit' | 'auto'): string;
    /**
     * FTS5 keyword search over pattern + technique fields.
     * Returns up to `limit` results ordered by relevance.
     */
    search(query: string, limit?: number): TechniqueResult[];
    /** Increment usage count and update last_used for a set of technique IDs. */
    markUsed(ids: string[]): void;
    /** List all techniques ordered by usage count descending. */
    list(): TechniqueResult[];
    /** Delete a technique by UUID. */
    remove(id: string): void;
    private rowToResult;
}
//# sourceMappingURL=store.d.ts.map