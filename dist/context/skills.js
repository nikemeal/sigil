/**
 * Skill Loader
 *
 * Reads markdown skill files from the skills/ directory, parses YAML
 * frontmatter, and matches skills to messages by keyword overlap.
 * Re-reads from disk on each match() call — no caching, no file watcher.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
const STOPWORDS = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'it', 'its',
    'this', 'that', 'and', 'or', 'but', 'not', 'no', 'if', 'then', 'so',
    'up', 'out', 'just', 'also', 'how', 'what', 'when', 'where', 'who',
    'which', 'there', 'here', 'all', 'each', 'every', 'my', 'your', 'me',
    'i', 'you', 'we', 'they', 'he', 'she',
]);
export class SkillLoader {
    skillsDir;
    enabledList;
    constructor(config) {
        this.skillsDir = resolve(process.cwd(), config.path);
        this.enabledList = config.enabled;
    }
    /** Load all skill files from disk. */
    loadAll() {
        if (!existsSync(this.skillsDir))
            return [];
        const files = readdirSync(this.skillsDir).filter((f) => extname(f) === '.md');
        const skills = [];
        for (const file of files) {
            const filePath = resolve(this.skillsDir, file);
            const skill = this.parseSkillFile(filePath);
            if (!skill)
                continue;
            // Filter by enabled list if configured
            if (this.enabledList && !this.enabledList.includes(skill.name))
                continue;
            skills.push(skill);
        }
        return skills;
    }
    /**
     * Find skills relevant to the given message.
     * Returns 0-maxResults skills sorted by relevance score.
     */
    match(message, maxResults = 3) {
        const skills = this.loadAll();
        if (skills.length === 0)
            return [];
        const messageTokens = this.tokenize(message);
        if (messageTokens.size === 0)
            return [];
        const scored = skills
            .map((skill) => ({ skill, score: this.scoreSkill(skill, messageTokens) }))
            .filter((s) => s.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, maxResults);
        return scored.map((s) => s.skill);
    }
    /** Parse a markdown file with YAML frontmatter into a Skill. */
    parseSkillFile(filePath) {
        try {
            const raw = readFileSync(filePath, 'utf-8');
            const { meta, body } = this.parseFrontmatter(raw);
            const name = meta.name;
            const description = meta.description;
            if (!name || !description)
                return null;
            const triggers = this.parseTriggers(meta.triggers);
            return { name, description, triggers, content: body.trim(), filePath };
        }
        catch {
            return null;
        }
    }
    /** Split frontmatter from markdown body. */
    parseFrontmatter(raw) {
        const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
        if (!match)
            return { meta: {}, body: raw };
        const yamlBlock = match[1];
        const body = match[2];
        const meta = {};
        for (const line of yamlBlock.split('\n')) {
            const kvMatch = line.match(/^(\w+)\s*:\s*(.+)$/);
            if (!kvMatch)
                continue;
            const key = kvMatch[1];
            let value = kvMatch[2].trim();
            // Parse inline arrays: [item1, item2, item3]
            const arrayMatch = value.match(/^\[(.+)\]$/);
            if (arrayMatch) {
                value = arrayMatch[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
            }
            else {
                // Strip surrounding quotes
                value = value.replace(/^["']|["']$/g, '');
            }
            meta[key] = value;
        }
        return { meta, body };
    }
    /** Normalise triggers from frontmatter (could be array or comma-separated string). */
    parseTriggers(raw) {
        if (!raw)
            return [];
        let items;
        if (Array.isArray(raw)) {
            items = raw.map(String);
        }
        else if (typeof raw === 'string') {
            items = raw.split(',');
        }
        else {
            return [];
        }
        // Split multi-word triggers into individual words
        return items.flatMap((s) => s.trim().toLowerCase().split(/\s+/)).filter(Boolean);
    }
    /** Tokenize text into a set of lowercase keywords, filtering stopwords. */
    tokenize(text) {
        const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
        return new Set(words.filter((w) => w.length > 1 && !STOPWORDS.has(w)));
    }
    /**
     * Score a skill against message tokens.
     * Trigger matches count 2x, description word matches count 1x.
     */
    scoreSkill(skill, messageTokens) {
        let score = 0;
        // Trigger keywords — 2x weight
        for (const trigger of skill.triggers) {
            if (messageTokens.has(trigger))
                score += 2;
        }
        // Description words — 1x weight
        const descTokens = this.tokenize(skill.description);
        for (const token of descTokens) {
            if (messageTokens.has(token))
                score += 1;
        }
        return score;
    }
}
//# sourceMappingURL=skills.js.map