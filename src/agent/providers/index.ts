/**
 * Provider Factory
 *
 * Creates the appropriate LLM provider based on configuration.
 * Reads the default model's provider type and instantiates it.
 */

import type { LLMProvider, SigilConfig, ModelConfig } from '../../types.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';

/**
 * Create an LLM provider from the config.
 * Looks at the default model's provider field to decide which implementation.
 */
export function createProvider(config: SigilConfig): LLMProvider {
  const modelConfig = resolveDefaultModel(config);

  switch (modelConfig.provider) {
    case 'anthropic':
      return createAnthropicProvider(modelConfig);
    case 'openai-compatible':
      return createOpenAICompatibleProvider(modelConfig);
    default:
      throw new Error(
        `[Provider] Unknown provider type '${modelConfig.provider}' ` +
        `for model '${modelConfig.name}'. Use 'anthropic' or 'openai-compatible'.`
      );
  }
}

/** Find the default model config, with helpful error messages */
function resolveDefaultModel(config: SigilConfig): ModelConfig {
  if (config.models.length === 0) {
    throw new Error(
      '[Provider] No models configured. Run onboarding or add a [[models]] section to sigil.toml.'
    );
  }

  if (!config.defaultModel) {
    return config.models[0];
  }

  const model = config.models.find((m) => m.name === config.defaultModel);
  if (!model) {
    throw new Error(
      `[Provider] Default model '${config.defaultModel}' not found in model pool. ` +
      `Available: ${config.models.map((m) => m.name).join(', ')}`
    );
  }

  return model;
}

/** Create an Anthropic provider, resolving the API key from environment */
function createAnthropicProvider(model: ModelConfig): AnthropicProvider {
  const envVar = model.apiKeyEnv ?? 'ANTHROPIC_API_KEY';
  const apiKey = process.env[envVar];

  if (!apiKey) {
    throw new Error(
      `[Provider] Anthropic API key not found. Set ${envVar} in your environment or .env file.`
    );
  }

  return new AnthropicProvider(apiKey);
}

/** Create an OpenAI-compatible provider */
function createOpenAICompatibleProvider(model: ModelConfig): OpenAICompatibleProvider {
  if (!model.baseUrl) {
    throw new Error(
      `[Provider] OpenAI-compatible model '${model.name}' requires a base_url in config.`
    );
  }

  const envVar = model.apiKeyEnv;
  const apiKey = envVar ? (process.env[envVar] ?? '') : '';

  return new OpenAICompatibleProvider({
    name: model.name,
    baseUrl: model.baseUrl,
    apiKey,
  });
}
