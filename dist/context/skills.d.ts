/**
 * Skill Loader
 *
 * Reads markdown skill files from the skills/ directory, parses YAML
 * frontmatter, and matches skills to messages by keyword overlap.
 * Re-reads from disk on each match() call — no caching, no file watcher.
 */
import type { SkillsConfig } from '../types.js';
export interface Skill {
    name: string;
    description: string;
    triggers: string[];
    content: string;
    filePath: string;
}
export declare class SkillLoader {
    private skillsDir;
    private enabledList;
    constructor(config: SkillsConfig);
    /** Load all skill files from disk. */
    loadAll(): Skill[];
    /**
     * Find skills relevant to the given message.
     * Returns 0-maxResults skills sorted by relevance score.
     */
    match(message: string, maxResults?: number): Skill[];
    /** Parse a markdown file with YAML frontmatter into a Skill. */
    private parseSkillFile;
    /** Split frontmatter from markdown body. */
    private parseFrontmatter;
    /** Normalise triggers from frontmatter (could be array or comma-separated string). */
    private parseTriggers;
    /** Tokenize text into a set of lowercase keywords, filtering stopwords. */
    private tokenize;
    /**
     * Score a skill against message tokens.
     * Trigger matches count 2x, description word matches count 1x.
     */
    private scoreSkill;
}
//# sourceMappingURL=skills.d.ts.map