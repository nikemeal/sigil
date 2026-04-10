/**
 * Task Planner
 *
 * Uses a cheap/fast model to decompose a complex request into steps.
 * Each step gets a recommended model tier. The runner then resolves
 * tiers to actual models via the router.
 *
 * Single-model fallback: if only one model is configured, skip planning
 * and create a single step with the full request.
 */
export class Planner {
    config;
    pool;
    constructor(config, pool) {
        this.config = config;
        this.pool = pool;
    }
    /**
     * Break a complex request into steps with model tier assignments.
     * Returns a single step if only one model is available.
     */
    async plan(message) {
        const models = this.config.models;
        // Single model or no models — skip planning
        if (models.length <= 1) {
            return [{ description: message, tier: models[0]?.tier ?? 'basic' }];
        }
        // Find the cheapest model for planning
        const plannerModel = this.findCheapestModel(models);
        const provider = this.pool.getProvider(plannerModel);
        try {
            const steps = await this.callPlanner(provider, plannerModel, message, models);
            return steps.length > 0 ? steps : [{ description: message, tier: 'standard' }];
        }
        catch (err) {
            console.warn(`[Planner] Planning failed, using single step: ${err.message}`);
            return [{ description: message, tier: 'standard' }];
        }
    }
    findCheapestModel(models) {
        return models.reduce((cheapest, m) => m.costPer1kInput < cheapest.costPer1kInput ? m : cheapest, models[0]);
    }
    async callPlanner(provider, model, message, availableModels) {
        const tiers = [...new Set(availableModels.map((m) => m.tier))];
        const tierList = tiers.join(', ');
        const completion = await provider.complete({
            model: model.model,
            messages: [
                {
                    role: 'system',
                    content: `You are a task planner. Decide how to handle this request.

IMPORTANT RULES:
- Most requests should be a SINGLE step. Only split into multiple steps when the request has genuinely distinct phases.
- NEVER create steps that ask the user questions or wait for input — you cannot interact with the user during task execution.
- NEVER split a simple request into redundant steps.

Examples of SINGLE step: "tell me a joke", "what's the weather", "summarize this topic", "explain X"
Examples of MULTI step: "research X then write a report comparing it to Y", "find the top 5 packages for Z then evaluate each one"

Available tiers: ${tierList}
- basic/minimal: simple lookups, classification, summarisation
- standard: general reasoning, writing, tool use
- full: complex analysis, long-form writing, multi-step reasoning

Respond ONLY with a JSON array of 1-5 steps. No markdown, no explanation. Example:
[{"description": "Tell a funny joke about programming", "tier": "basic"}]`,
                },
                { role: 'user', content: message },
            ],
            maxTokens: 500,
        });
        const parsed = JSON.parse(completion.content.trim());
        if (!Array.isArray(parsed) || parsed.length === 0) {
            return [];
        }
        // Validate and cap at 5 steps
        const validated = parsed.slice(0, 5).map((step) => ({
            description: String(step.description),
            tier: tiers.includes(step.tier) ? step.tier : 'standard',
        }));
        // Single step — always pass through the original message so the
        // execution model sees the real request, not the planner's rewording
        // (cheap models often *answer* instead of *planning*).
        if (validated.length === 1) {
            return [{ description: message, tier: validated[0].tier }];
        }
        // Collapse redundant multi-step plans to a single step
        if (this.stepsLookRedundant(validated)) {
            return [{ description: message, tier: validated[0].tier }];
        }
        return validated;
    }
    /**
     * Detect when the planner over-decomposes a simple request into
     * multiple steps that are effectively the same task.
     */
    stepsLookRedundant(steps) {
        // All steps on the same tier is a weak signal of redundancy
        const sameTier = steps.every((s) => s.tier === steps[0].tier);
        if (!sameTier)
            return false;
        // Check for high word overlap between step descriptions
        const wordSets = steps.map((s) => new Set(s.description.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/)));
        for (let i = 1; i < wordSets.length; i++) {
            const overlap = [...wordSets[i]].filter((w) => wordSets[0].has(w)).length;
            const ratio = overlap / Math.max(wordSets[0].size, wordSets[i].size);
            if (ratio < 0.5)
                return false;
        }
        return true;
    }
}
//# sourceMappingURL=planner.js.map