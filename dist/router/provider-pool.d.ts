/**
 * Provider Pool
 *
 * Manages multiple LLM providers. Each model in the config pool
 * gets its own provider instance. The router picks a model,
 * and the pool returns the right provider for it.
 */
import type { LLMProvider, SigilConfig, ModelConfig } from '../types.js';
export declare class ProviderPool {
    /** Map of model name → provider instance */
    private providers;
    /** Map of model name → model config */
    private models;
    constructor(config: SigilConfig);
    /** Get the provider for a specific model config */
    getProvider(model: ModelConfig): LLMProvider;
    /** Get all available model names */
    getModelNames(): string[];
    /** Get provider by model name */
    getProviderByName(name: string): LLMProvider | undefined;
    /** Get number of configured providers */
    get size(): number;
    /**
     * Return the provider and config for the cheapest available model.
     * Picks by tier order: minimal < basic < standard < full.
     * Returns null if no providers are configured.
     */
    getCheapest(): {
        provider: LLMProvider;
        model: ModelConfig;
    } | null;
    private createProvider;
}
//# sourceMappingURL=provider-pool.d.ts.map