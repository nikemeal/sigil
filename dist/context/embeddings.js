/**
 * Embedding Provider
 *
 * Generates vector embeddings via any OpenAI-compatible /v1/embeddings endpoint.
 * Works with Ollama, OpenAI, Groq, and other services.
 *
 * Optional — if not configured, memory uses FTS5 keyword search only.
 */
/**
 * Create an embedding provider from config, or null if not configured.
 * Reads the embedding_model and embedding_provider from [memory] config.
 */
export function createEmbeddingProvider(memoryConfig, models) {
    if (!memoryConfig.embeddingModel)
        return null;
    // Determine the base URL for embeddings
    let baseUrl;
    let apiKey = '';
    if (memoryConfig.embeddingProvider) {
        // Explicit URL provided
        baseUrl = memoryConfig.embeddingProvider;
        // Try to find an API key — check if any model uses this base URL
        const matchingModel = models.find((m) => m.baseUrl === baseUrl);
        if (matchingModel?.apiKeyEnv) {
            apiKey = process.env[matchingModel.apiKeyEnv] ?? '';
        }
    }
    else {
        // No explicit provider — try to find one from the model pool
        const matchingModel = models.find((m) => m.baseUrl);
        if (!matchingModel?.baseUrl) {
            console.warn('[Embeddings] No embedding_provider configured and no base_url in model pool.');
            return null;
        }
        baseUrl = matchingModel.baseUrl;
        if (matchingModel.apiKeyEnv) {
            apiKey = process.env[matchingModel.apiKeyEnv] ?? '';
        }
    }
    return new OpenAIEmbeddingProvider(baseUrl.replace(/\/+$/, ''), memoryConfig.embeddingModel, apiKey);
}
class OpenAIEmbeddingProvider {
    baseUrl;
    model;
    apiKey;
    constructor(baseUrl, model, apiKey) {
        this.baseUrl = baseUrl;
        this.model = model;
        this.apiKey = apiKey;
    }
    async embed(text) {
        const response = await fetch(`${this.baseUrl}/v1/embeddings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
            },
            body: JSON.stringify({
                model: this.model,
                input: text,
            }),
        });
        if (!response.ok) {
            const text = await response.text().catch(() => 'unknown');
            throw new Error(`[Embeddings] HTTP ${response.status}: ${text}`);
        }
        const data = (await response.json());
        return data.data[0].embedding;
    }
    async isAvailable() {
        try {
            const response = await fetch(`${this.baseUrl}/v1/models`, {
                headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
                signal: AbortSignal.timeout(3000),
            });
            return response.ok;
        }
        catch {
            return false;
        }
    }
}
//# sourceMappingURL=embeddings.js.map