/**
 * OpenAI-Compatible LLM Provider
 *
 * Covers any service with a /v1/chat/completions endpoint:
 * OpenAI, Ollama, LM Studio, Groq, Together AI, Mistral, local llama.cpp, etc.
 *
 * Supports tool calling via OpenAI's function calling format.
 * Uses raw fetch — no SDK dependency.
 *
 * Includes rate limiting with exponential backoff on 429/500/503.
 */
import type { LLMProvider, CompletionRequest, CompletionResponse } from '../../types.js';
export interface OpenAICompatibleConfig {
    name: string;
    baseUrl: string;
    apiKey: string;
}
export declare class OpenAICompatibleProvider implements LLMProvider {
    readonly name: string;
    readonly providerType: "openai-compatible";
    private baseUrl;
    private apiKey;
    constructor(config: OpenAICompatibleConfig);
    complete(request: CompletionRequest): Promise<CompletionResponse>;
    isAvailable(): Promise<boolean>;
    /** Convert our LLMMessage to OpenAI format */
    private convertMessages;
    /** Convert our ToolDefinition to OpenAI format */
    private convertTools;
    private mapFinishReason;
    private isRetryableStatus;
    private isNetworkError;
    private backoffDelay;
}
//# sourceMappingURL=openai-compatible.d.ts.map