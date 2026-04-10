/**
 * Cost Tracker
 *
 * Logs every LLM request with model, tokens, and estimated cost.
 * Provides daily summaries and running totals.
 */
export class CostTracker {
    db;
    constructor(db) {
        this.db = db;
    }
    /** Log a request */
    log(messageId, model, usage, requestType, routedBy, override) {
        const inputTokens = usage?.inputTokens ?? 0;
        const outputTokens = usage?.outputTokens ?? 0;
        const estimatedCost = (inputTokens / 1000) * model.costPer1kInput +
            (outputTokens / 1000) * model.costPer1kOutput;
        this.db.prepare(`
      INSERT INTO usage (message_id, model, tier, request_type, input_tokens, output_tokens, estimated_cost, routed_by, override, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(messageId, model.model, model.tier, requestType, inputTokens, outputTokens, estimatedCost, routedBy, override ?? null, new Date().toISOString());
    }
    /** Log a routing pattern for future learning */
    logPattern(pattern, classifiedType, actualTokens, modelUsed) {
        this.db.prepare(`
      INSERT INTO routing_patterns (pattern, classified_type, actual_tokens, model_used, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(pattern, classifiedType, actualTokens, modelUsed, new Date().toISOString());
    }
    /** Get today's summary */
    getTodaySummary() {
        const today = new Date().toISOString().split('T')[0];
        return this.getDailySummary(today);
    }
    /** Get summary for a specific date (YYYY-MM-DD) */
    getDailySummary(date) {
        const rows = this.db.prepare(`
      SELECT model, COUNT(*) as requests, 
             SUM(input_tokens) as input_tokens,
             SUM(output_tokens) as output_tokens,
             SUM(estimated_cost) as cost
      FROM usage
      WHERE timestamp LIKE ? || '%'
      GROUP BY model
    `).all(`${date}`);
        const byModel = {};
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
    getTotalSpend() {
        const row = this.db.prepare(`SELECT SUM(estimated_cost) as total FROM usage`).get();
        return row.total ?? 0;
    }
    /** Get request count for today */
    getTodayRequestCount() {
        const today = new Date().toISOString().split('T')[0];
        const row = this.db.prepare(`
      SELECT COUNT(*) as count FROM usage WHERE timestamp LIKE ? || '%'
    `).get(`${today}`);
        return row.count;
    }
}
//# sourceMappingURL=cost-tracker.js.map