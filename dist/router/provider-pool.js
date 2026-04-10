/**
 * Provider Pool
 *
 * Manages multiple LLM providers. Each model in the config pool
 * gets its own provider instance. The router picks a model,
 * and the pool returns the right provider for it.
 */
import { AnthropicProvider } from '../agent/providers/anthropic.js';
import { OpenAICompatibleProvider } from '../agent/providers/openai-compatible.js';
export class ProviderPool {
    /** Map of model name → provider instance */
    providers = new Map();
    /** Map of model name → model config */
    models = new Map();
    constructor(config) {
        for (const model of config.models) {
            try {
                const provider = this.createProvider(model);
                this.providers.set(model.name, provider);
                this.models.set(model.name, model);
                console.log(`[Pool] Provider ready: ${model.name} (${model.provider}, ${model.tier})`);
            }
            catch (err) {
                console.warn(`[Pool] Failed to create provider for ${model.name}: ${err.message}`);
            }
        }
    }
    /** Get the provider for a specific model config */
    getProvider(model) {
        const provider = this.providers.get(model.name);
        if (!provider) {
            throw new Error(`[Pool] No provider for model '${model.name}'`);
        }
        return provider;
    }
    /** Get all available model names */
    getModelNames() {
        return [...this.providers.keys()];
    }
    /** Get provider by model name */
    getProviderByName(name) {
        return this.providers.get(name);
    }
    /** Get number of configured providers */
    get size() {
        return this.providers.size;
    }
    /**
     * Return the provider and config for the cheapest available model.
     * Picks by tier order: minimal < basic < standard < full.
     * Returns null if no providers are configured.
     */
    getCheapest() {
        const tierOrder = ['minimal', 'basic', 'standard', 'full'];
        let best = null;
        for (const [name, model] of this.models) {
            const provider = this.providers.get(name);
            if (!provider)
                continue;
            if (!best || tierOrder.indexOf(model.tier) < tierOrder.indexOf(best.model.tier)) {
                best = { provider, model };
            }
        }
        return best;
    }
    createProvider(model) {
        switch (model.provider) {
            case 'anthropic': {
                const envVar = model.apiKeyEnv ?? 'ANTHROPIC_API_KEY';
                const apiKey = process.env[envVar];
                if (!apiKey) {
                    throw new Error(`API key ${envVar} not set`);
                }
                return new AnthropicProvider(apiKey);
            }
            case 'openai-compatible': {
                if (!model.baseUrl) {
                    throw new Error(`base_url required for openai-compatible model`);
                }
                const envVar = model.apiKeyEnv;
                const apiKey = envVar ? (process.env[envVar] ?? '') : '';
                return new OpenAICompatibleProvider({
                    name: model.name,
                    baseUrl: model.baseUrl,
                    apiKey,
                });
            }
            default:
                throw new Error(`Unknown provider type: ${model.provider}`);
        }
    }
}
//# sourceMappingURL=provider-pool.js.map