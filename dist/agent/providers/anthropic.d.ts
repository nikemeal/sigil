/**
 * Anthropic LLM Provider
 *
 * Native Anthropic API implementation (Claude models).
 * Handles the Anthropic-specific message format where the system prompt
 * is a separate parameter, not part of the messages array.
 *
 * Supports tool calling via Anthropic's native tool_use format.
 * Includes rate limiting with exponential backoff on 429/500/503.
 */
import type { LLMProvider, CompletionRequest, CompletionResponse } from '../../types.js';
export declare class AnthropicProvider implements LLMProvider {
    readonly name = "anthropic";
    readonly providerType: "anthropic";
    private client;
    constructor(apiKey: string);
    complete(request: CompletionRequest): Promise<CompletionResponse>;
    isAvailable(): Promise<boolean>;
    /**
     * Convert our LLMMessage format to Anthropic's format.
     * Handles system prompt extraction and tool result messages.
     */
    private convertMessages;
    /** Convert our ToolDefinition to Anthropic's format */
    private convertTools;
    private mapStopReason;
    private isRetryable;
    private backoffDelay;
}
//# sourceMappingURL=anthropic.d.ts.map