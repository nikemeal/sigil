import Database from 'better-sqlite3';
import type { Tool, ToolResult } from '../gateway/types.js';

// ── Types ───────────────────────────────────────────────────────

export interface Technique {
  id: number;
  /** What domain this technique applies to (e.g., "web_scraping", "dnd_encounters", "email_drafting") */
  domain: string;
  /** Description of the approach */
  approach: string;
  /** What worked well */
  strengths: string;
  /** What didn't work or could be better */
  weaknesses: string;
  /** Effectiveness score 1-10 (self-assessed or user-rated) */
  score: number;
  /** How many times this technique has been used */
  useCount: number;
  /** The context/task this was learned from */
  sourceTask: string;
  createdAt: string;
  updatedAt: string;
}

export interface LearningEntry {
  id: number;
  /** The task/prompt that triggered the attempt */
  task: string;
  /** What approach was taken */
  approach: string;
  /** The output/result */
  result: string;
  /** Self-evaluation: what went well */
  evaluation: string;
  /** Score 1-10 */
  score: number;
  /** Which technique was used (if any) */
  techniqueId?: number;
  /** Number of iterations it took */
  iterations: number;
  createdAt: string;
}

// ── LearningStore ───────────────────────────────────────────────

/**
 * Persistent store for learned techniques and iteration history.
 *
 * The learning loop:
 *  1. Agent attempts a task
 *  2. Agent self-evaluates: what worked? what didn't? score 1-10
 *  3. If score < threshold, agent iterates with a different approach
 *  4. Best approach is stored as a Technique for future use
 *  5. Next time a similar task comes up, agent recalls relevant techniques
 *
 * This is not fine-tuning — it's structured prompt-time learning.
 * Techniques are injected into the context window when relevant.
 */
export class LearningStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS techniques (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT NOT NULL,
        approach TEXT NOT NULL,
        strengths TEXT NOT NULL DEFAULT '',
        weaknesses TEXT NOT NULL DEFAULT '',
        score REAL NOT NULL DEFAULT 5,
        use_count INTEGER NOT NULL DEFAULT 0,
        source_task TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_techniques_domain ON techniques(domain);
      CREATE INDEX IF NOT EXISTS idx_techniques_score ON techniques(score DESC);

      CREATE TABLE IF NOT EXISTS learning_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task TEXT NOT NULL,
        approach TEXT NOT NULL,
        result TEXT NOT NULL DEFAULT '',
        evaluation TEXT NOT NULL DEFAULT '',
        score REAL NOT NULL DEFAULT 5,
        technique_id INTEGER,
        iterations INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (technique_id) REFERENCES techniques(id)
      );
    `);
  }

  // ── Techniques ──────────────────────────────────────────────

  /** Store a new technique the agent discovered */
  saveTechnique(params: {
    domain: string;
    approach: string;
    strengths: string;
    weaknesses: string;
    score: number;
    sourceTask: string;
  }): number {
    const result = this.db.prepare(`
      INSERT INTO techniques (domain, approach, strengths, weaknesses, score, source_task)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(params.domain, params.approach, params.strengths, params.weaknesses, params.score, params.sourceTask);

    return result.lastInsertRowid as number;
  }

  /** Find techniques relevant to a domain, ranked by score */
  findTechniques(domain: string, limit = 5): Technique[] {
    // Exact match + fuzzy match on domain
    const rows = this.db.prepare(`
      SELECT * FROM techniques
      WHERE domain = ? OR domain LIKE ?
      ORDER BY score DESC, use_count DESC
      LIMIT ?
    `).all(domain, `%${domain}%`, limit) as Array<Record<string, unknown>>;

    return rows.map(this.rowToTechnique);
  }

  /** Search techniques by keyword across all fields */
  searchTechniques(query: string, limit = 5): Technique[] {
    const pattern = `%${query}%`;
    const rows = this.db.prepare(`
      SELECT * FROM techniques
      WHERE approach LIKE ? OR domain LIKE ? OR strengths LIKE ?
      ORDER BY score DESC
      LIMIT ?
    `).all(pattern, pattern, pattern, limit) as Array<Record<string, unknown>>;

    return rows.map(this.rowToTechnique);
  }

  /** Update a technique after it was used (bump count, adjust score) */
  updateTechnique(id: number, updates: { score?: number; strengths?: string; weaknesses?: string }): void {
    const sets = ["use_count = use_count + 1", "updated_at = datetime('now')"];
    const values: unknown[] = [];

    if (updates.score !== undefined) {
      // Rolling average: new_score = (old * count + new) / (count + 1)
      sets.push('score = (score * use_count + ?) / (use_count + 1)');
      values.push(updates.score);
    }
    if (updates.strengths !== undefined) {
      sets.push('strengths = ?');
      values.push(updates.strengths);
    }
    if (updates.weaknesses !== undefined) {
      sets.push('weaknesses = ?');
      values.push(updates.weaknesses);
    }

    values.push(id);
    this.db.prepare(`UPDATE techniques SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  /** Get top techniques across all domains */
  topTechniques(limit = 10): Technique[] {
    const rows = this.db.prepare(`
      SELECT * FROM techniques ORDER BY score DESC, use_count DESC LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;

    return rows.map(this.rowToTechnique);
  }

  // ── Learning Log ────────────────────────────────────────────

  /** Log an attempt (for the iteration history) */
  logAttempt(params: {
    task: string;
    approach: string;
    result: string;
    evaluation: string;
    score: number;
    techniqueId?: number;
    iterations: number;
  }): number {
    const result = this.db.prepare(`
      INSERT INTO learning_log (task, approach, result, evaluation, score, technique_id, iterations)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(params.task, params.approach, params.result, params.evaluation,
      params.score, params.techniqueId ?? null, params.iterations);

    return result.lastInsertRowid as number;
  }

  /** Get past attempts for a similar task (for the agent to learn from) */
  getPastAttempts(task: string, limit = 5): LearningEntry[] {
    const pattern = `%${task.split(' ').slice(0, 3).join('%')}%`;
    const rows = this.db.prepare(`
      SELECT * FROM learning_log
      WHERE task LIKE ?
      ORDER BY score DESC
      LIMIT ?
    `).all(pattern, limit) as Array<Record<string, unknown>>;

    return rows.map(r => ({
      id: r.id as number,
      task: r.task as string,
      approach: r.approach as string,
      result: r.result as string,
      evaluation: r.evaluation as string,
      score: r.score as number,
      techniqueId: r.technique_id as number | undefined,
      iterations: r.iterations as number,
      createdAt: r.created_at as string,
    }));
  }

  private rowToTechnique(row: Record<string, unknown>): Technique {
    return {
      id: row.id as number,
      domain: row.domain as string,
      approach: row.approach as string,
      strengths: row.strengths as string,
      weaknesses: row.weaknesses as string,
      score: row.score as number,
      useCount: row.use_count as number,
      sourceTask: row.source_task as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}

// ── Learning tools (exposed to the agent) ────────────────────────

export function createLearningTools(store: LearningStore): Tool[] {
  return [
    {
      name: 'recall_techniques',
      description: `Search your learned techniques for how to approach a task. Use this before
starting complex work — you may have already figured out a good approach for something similar.
Returns past techniques ranked by effectiveness.`,
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Domain to search (e.g. "web_scraping", "report_writing", "dnd")' },
          query: { type: 'string', description: 'Free-text search across all technique fields' },
        },
      },
      async execute(params): Promise<ToolResult> {
        const domain = params.domain as string | undefined;
        const query = params.query as string | undefined;

        let techniques: Technique[];
        if (domain) {
          techniques = store.findTechniques(domain);
        } else if (query) {
          techniques = store.searchTechniques(query);
        } else {
          techniques = store.topTechniques();
        }

        if (techniques.length === 0) {
          return { content: 'No relevant techniques found. You\'re starting fresh on this one.' };
        }

        const lines = techniques.map(t =>
          `[#${t.id} | ${t.domain} | score: ${t.score.toFixed(1)} | used: ${t.useCount}x]\n` +
          `Approach: ${t.approach}\n` +
          `Strengths: ${t.strengths}\n` +
          `Weaknesses: ${t.weaknesses}`
        );

        return { content: lines.join('\n\n') };
      },
    },

    {
      name: 'save_technique',
      description: `Save a technique you've discovered that works well. Use this after completing
a task where you found an effective approach worth remembering for next time.
Also use this to update an existing technique with new learnings.`,
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Category (e.g. "web_scraping", "summarisation", "dnd_encounters")' },
          approach: { type: 'string', description: 'Description of the approach/technique' },
          strengths: { type: 'string', description: 'What works well about this approach' },
          weaknesses: { type: 'string', description: 'Limitations or things to watch out for' },
          score: { type: 'number', description: 'Effectiveness 1-10' },
          source_task: { type: 'string', description: 'The task that led to discovering this technique' },
          update_id: { type: 'number', description: 'If updating an existing technique, its ID' },
        },
        required: ['domain', 'approach', 'score'],
      },
      async execute(params): Promise<ToolResult> {
        const updateId = params.update_id as number | undefined;

        if (updateId) {
          store.updateTechnique(updateId, {
            score: params.score as number,
            strengths: params.strengths as string | undefined,
            weaknesses: params.weaknesses as string | undefined,
          });
          return { content: `Updated technique #${updateId}` };
        }

        const id = store.saveTechnique({
          domain: params.domain as string,
          approach: params.approach as string,
          strengths: (params.strengths as string) ?? '',
          weaknesses: (params.weaknesses as string) ?? '',
          score: params.score as number,
          sourceTask: (params.source_task as string) ?? '',
        });

        return { content: `Saved technique #${id} in domain "${params.domain}"` };
      },
    },

    {
      name: 'log_attempt',
      description: `Log a task attempt with self-evaluation. Use this after completing a task
to record what you tried and how well it worked. This builds your learning history
so you can improve over time.

If the score is below 6, consider iterating with a different approach.`,
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'What the task was' },
          approach: { type: 'string', description: 'How you approached it' },
          result: { type: 'string', description: 'Summary of the output' },
          evaluation: { type: 'string', description: 'Self-assessment: what went well, what could improve' },
          score: { type: 'number', description: 'How well it went, 1-10' },
          technique_id: { type: 'number', description: 'If you used a saved technique, its ID' },
          iterations: { type: 'number', description: 'How many attempts it took' },
        },
        required: ['task', 'approach', 'evaluation', 'score'],
      },
      async execute(params): Promise<ToolResult> {
        const id = store.logAttempt({
          task: params.task as string,
          approach: params.approach as string,
          result: (params.result as string) ?? '',
          evaluation: params.evaluation as string,
          score: params.score as number,
          techniqueId: params.technique_id as number | undefined,
          iterations: (params.iterations as number) ?? 1,
        });

        const score = params.score as number;
        let feedback = `Logged attempt #${id} (score: ${score}/10)`;

        if (score >= 8) {
          feedback += '\nGreat result — consider saving this as a technique if you haven\'t already.';
        } else if (score >= 5) {
          feedback += '\nDecent result. Review what could be improved for next time.';
        } else {
          feedback += '\nLow score — consider trying a different approach before delivering.';
        }

        return { content: feedback };
      },
    },

    {
      name: 'review_past_attempts',
      description: `Look at how you handled similar tasks in the past. Use this to learn
from previous attempts before starting new work.`,
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Description of the current task (searches for similar past tasks)' },
        },
        required: ['task'],
      },
      async execute(params): Promise<ToolResult> {
        const attempts = store.getPastAttempts(params.task as string);

        if (attempts.length === 0) {
          return { content: 'No similar past attempts found.' };
        }

        const lines = attempts.map(a =>
          `[#${a.id} | score: ${a.score}/10 | ${a.iterations} iteration(s) | ${a.createdAt}]\n` +
          `Task: ${a.task.slice(0, 100)}\n` +
          `Approach: ${a.approach}\n` +
          `Evaluation: ${a.evaluation}`
        );

        return { content: lines.join('\n\n') };
      },
    },
  ];
}
