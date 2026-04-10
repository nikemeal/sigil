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
    byModel: Record<string, {
        requests: number;
        cost: number;
    }>;
}
export declare class CostTracker {
    private db;
    constructor(db: Database.Database);
    /** Log a request */
    log(messageId: string, model: ModelConfig, usage: TokenUsage | undefined, requestType: RequestType, routedBy: string, override: string | null): void;
    /** Log a routing pattern for future learning */
    logPattern(pattern: string, classifiedType: RequestType, actualTokens: number, modelUsed: string): void;
    /** Get today's summary */
    getTodaySummary(): DailySummary;
    /** Get summary for a specific date (YYYY-MM-DD) */
    getDailySummary(date: string): DailySummary;
    /** Get total spend across all time */
    getTotalSpend(): number;
    /** Get request count for today */
    getTodayRequestCount(): number;
}
//# sourceMappingURL=cost-tracker.d.ts.map