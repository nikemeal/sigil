/**
 * Smart Router
 *
 * Picks the right model for each request based on:
 *   1. Complexity classification (chat/question/tool/complex)
 *   2. User overrides (/local, /cloud, /private)
 *   3. Model tier matching
 *   4. Availability
 *
 * Falls back gracefully: if the ideal model isn't available,
 * picks the next best option.
 */

import type { ModelConfig, SigilConfig } from '../types.js';
import { classify, type Classification, type RequestType } from './classifier.js';

/** Which model tier to prefer for each request type */
const TIER_PREFERENCE: Record<RequestType, string[]> = {
  chat:     ['basic', 'minimal', 'standard', 'full'],
  question: ['basic', 'standard', 'minimal', 'full'],
  tool:     ['standard', 'basic', 'full', 'minimal'],
  complex:  ['full', 'standard', 'basic', 'minimal'],
};

export interface RoutingDecision {
  model: ModelConfig;
  classification: Classification;
  cleanMessage: string;
  reason: string;
}

export class Router {
  private config: SigilConfig;

  constructor(config: SigilConfig) {
    this.config = config;
  }

  /**
   * Route a message to the best model.
   * Returns the model config, classification, and cleaned message.
   */
  route(message: string): RoutingDecision {
    const { classification, cleanMessage } = classify(message);
    const models = this.config.models;

    if (models.length === 0) {
      throw new Error('[Router] No models configured.');
    }

    // Single model — no routing needed
    if (models.length === 1) {
      return {
        model: models[0],
        classification,
        cleanMessage,
        reason: 'Single model configured',
      };
    }

    // Handle overrides
    if (classification.override) {
      const model = this.resolveOverride(classification.override, models);
      if (model) {
        return {
          model,
          classification,
          cleanMessage,
          reason: `Override: /${classification.override}`,
        };
      }
      // Override didn't match any model — fall through to normal routing
    }

    // Find the best model for this request type
    const model = this.findBestModel(classification.type, models);

    return {
      model,
      classification,
      cleanMessage,
      reason: `Auto-routed: ${classification.type} → ${model.name} (${model.tier})`,
    };
  }

  /**
   * Find the best model for a request type based on tier preference.
   */
  private findBestModel(type: RequestType, models: ModelConfig[]): ModelConfig {
    const tierOrder = TIER_PREFERENCE[type];

    for (const tier of tierOrder) {
      const match = models.find((m) => m.tier === tier);
      if (match) return match;
    }

    // Fallback: default model or first
    const defaultModel = models.find((m) => m.name === this.config.defaultModel);
    return defaultModel ?? models[0];
  }

  /**
   * Resolve a user override to a model.
   *   /local   → find a model with cost 0 (local/free)
   *   /cloud   → find a model with cost > 0 (paid API)
   *   /private → same as /local (force local, nothing leaves network)
   */
  private resolveOverride(override: string, models: ModelConfig[]): ModelConfig | null {
    switch (override) {
      case 'local':
      case 'private': {
        // Prefer models with zero cost (local)
        const local = models.find((m) => m.costPer1kInput === 0);
        return local ?? null;
      }
      case 'cloud': {
        // Prefer models with non-zero cost (cloud/paid)
        const cloud = models.find((m) => m.costPer1kInput > 0);
        return cloud ?? null;
      }
      default:
        return null;
    }
  }
}
