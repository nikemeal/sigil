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

import type { SigilConfig, ModelConfig, ModelTier, LLMProvider } from '../types.js';
import { ProviderPool } from '../router/provider-pool.js';

export interface PlannedStep {
  description: string;
  tier: string;
}

export class Planner {
  private config: SigilConfig;
  private pool: ProviderPool;

  constructor(config: SigilConfig, pool: ProviderPool) {
    this.config = config;
    this.pool = pool;
  }

  /**
   * Break a complex request into steps with model tier assignments.
   * Returns a single step if only one model is available.
   */
  async plan(message: string): Promise<PlannedStep[]> {
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
    } catch (err) {
      console.warn(`[Planner] Planning failed, using single step: ${(err as Error).message}`);
      return [{ description: message, tier: 'standard' }];
    }
  }

  private findCheapestModel(models: ModelConfig[]): ModelConfig {
    return models.reduce((cheapest, m) =>
      m.costPer1kInput < cheapest.costPer1kInput ? m : cheapest
    , models[0]);
  }

  private async callPlanner(
    provider: LLMProvider,
    model: ModelConfig,
    message: string,
    availableModels: ModelConfig[],
  ): Promise<PlannedStep[]> {
    const tiers: ModelTier[] = [...new Set(availableModels.map((m) => m.tier))];
    const tierList = tiers.join(', ');

    const completion = await provider.complete({
      model: model.model,
      messages: [
        {
          role: 'system',
          content: `You are a task planner. Break the user's request into 2-5 sequential steps. For each step, assign a model tier based on complexity.

Available tiers: ${tierList}
- basic/minimal: simple lookups, classification, summarisation
- standard: general reasoning, writing, tool use
- full: complex analysis, long-form writing, multi-step reasoning

Respond ONLY with a JSON array. No markdown, no explanation. Example:
[{"description": "Search for relevant information about X", "tier": "basic"}, {"description": "Analyse findings and write a summary", "tier": "standard"}]`,
        },
        { role: 'user', content: message },
      ],
      maxTokens: 500,
    });

    const parsed = JSON.parse(completion.content.trim()) as PlannedStep[];

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [];
    }

    // Validate and cap at 5 steps
    return parsed.slice(0, 5).map((step) => ({
      description: String(step.description),
      tier: tiers.includes(step.tier as ModelTier) ? step.tier : 'standard',
    }));
  }
}
