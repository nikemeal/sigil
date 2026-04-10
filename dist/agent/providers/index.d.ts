/**
 * Provider Factory
 *
 * Creates the appropriate LLM provider based on configuration.
 * Reads the default model's provider type and instantiates it.
 */
import type { LLMProvider, SigilConfig } from '../../types.js';
/**
 * Create an LLM provider from the config.
 * Looks at the default model's provider field to decide which implementation.
 */
export declare function createProvider(config: SigilConfig): LLMProvider;
//# sourceMappingURL=index.d.ts.map