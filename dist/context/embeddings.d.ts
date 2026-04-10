/**
 * Embedding Provider
 *
 * Generates vector embeddings via any OpenAI-compatible /v1/embeddings endpoint.
 * Works with Ollama, OpenAI, Groq, and other services.
 *
 * Optional — if not configured, memory uses FTS5 keyword search only.
 */
import type { MemoryConfig, ModelConfig } from '../types.js';
export interface EmbeddingProvider {
    /** Generate an embedding vector for a text string */
    embed(text: string): Promise<number[]>;
    /** Check if the provider is reachable */
    isAvailable(): Promise<boolean>;
}
/**
 * Create an embedding provider from config, or null if not configured.
 * Reads the embedding_model and embedding_provider from [memory] config.
 */
export declare function createEmbeddingProvider(memoryConfig: MemoryConfig, models: ModelConfig[]): EmbeddingProvider | null;
//# sourceMappingURL=embeddings.d.ts.map