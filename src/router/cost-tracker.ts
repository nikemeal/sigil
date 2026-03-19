/**
 * Cost Tracker
 *
 * Logs every LLM request with model, tokens, and estimated cost.
 * Provides daily summaries and running totals.
 */

import type Database from 'better-sqlite3';
import type { ModelConfig, TokenUsage } from '../types.js';
import type { RequestType } from './classifier.js';

export interface UsageEntry {
  messageId: string;
  model: string;
  tier: string;
  requestType: RequestType;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  routedBy: string;
  override: string | null;
  timestamp: Date;
}

export interface DailySummary {
  date: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  byModel: Record<string, { requests: number; cost: number }>;
}

export class CostTracker {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Log a request */
  log(
    messageId: string,
    model: ModelConfig,
    usage: TokenUsage | undefined,
    requestType: RequestType,
    routedBy: string,
    override: string | null,
  ): void {
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    const estimatedCost =
      (inputTokens / 1000) * model.costPer1kInput +
      (outputTokens / 1000) * model.costPer1kOutput;

    this.db.prepare(`
      INSERT INTO usage (message_id, model, tier, request_type, input_tokens, output_tokens, estimated_cost, routed_by, override, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      messageId,
      model.model,
      model.tier,
      requestType,
      inputTokens,
      outputTokens,
      estimatedCost,
      routedBy,
      override ?? null,
      new Date().toISOString(),
    );
  }

  /** Log a routing pattern for future learning */
  logPattern(pattern: string, classifiedType: RequestType, actualTokens: number, modelUsed: string): void {
    this.db.prepare(`
      INSERT INTO routing_patterns (pattern, classified_type, actual_tokens, model_used, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(pattern, classifiedType, actualTokens, modelUsed, new Date().toISOString());
  }

  /** Get today's summary */
  getTodaySummary(): DailySummary {
    const today = new Date().toISOString().split('T')[0];
    return this.getDailySummary(today);
  }

  /** Get summary for a specific date (YYYY-MM-DD) */
  getDailySummary(date: string): DailySummary {
    const rows = this.db.prepare(`
      SELECT model, COUNT(*) as requests, 
             SUM(input_tokens) as input_tokens,
             SUM(output_tokens) as output_tokens,
             SUM(estimated_cost) as cost
      FROM usage
      WHERE timestamp LIKE ? || '%'
      GROUP BY model
    `).all(`${date}`) as Array<{
      model: string;
      requests: number;
      input_tokens: number;
      output_tokens: number;
      cost: number;
    }>;

    const byModel: Record<string, { requests: number; cost: number }> = {};
    let totalRequests = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;

    for (const row of rows) {
      byModel[row.model] = { requests: row.requests, cost: row.cost };
      totalRequests += row.requests;
      totalInputTokens += row.input_tokens;
      totalOutputTokens += row.output_tokens;
      totalCost += row.cost;
    }

    return {
      date,
      totalRequests,
      totalInputTokens,
      totalOutputTokens,
      totalCost,
      byModel,
    };
  }

  /** Get total spend across all time */
  getTotalSpend(): number {
    const row = this.db.prepare(`SELECT SUM(estimated_cost) as total FROM usage`).get() as { total: number | null };
    return row.total ?? 0;
  }

  /** Get request count for today */
  getTodayRequestCount(): number {
    const today = new Date().toISOString().split('T')[0];
    const row = this.db.prepare(`
      SELECT COUNT(*) as count FROM usage WHERE timestamp LIKE ? || '%'
    `).get(`${today}`) as { count: number };
    return row.count;
  }
}
