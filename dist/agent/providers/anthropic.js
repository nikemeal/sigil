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
import Anthropic from '@anthropic-ai/sdk';
const DEFAULT_MAX_TOKENS = 4096;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
export class AnthropicProvider {
    name = 'anthropic';
    providerType = 'anthropic';
    client;
    constructor(apiKey) {
        this.client = new Anthropic({ apiKey });
    }
    async complete(request) {
        const { system, messages } = this.convertMessages(request.messages);
        const tools = request.tools ? this.convertTools(request.tools) : undefined;
        let lastError = null;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const params = {
                    model: request.model,
                    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
                    temperature: request.temperature,
                    system: system || undefined,
                    messages,
                    stop_sequences: request.stop,
                };
                if (tools && tools.length > 0) {
                    params.tools = tools;
                }
                const response = await this.client.messages.create(params);
                // Extract text content
                const content = response.content
                    .filter((block) => block.type === 'text')
                    .map((block) => block.text)
                    .join('');
                // Extract tool calls
                const toolCalls = response.content
                    .filter((block) => block.type === 'tool_use')
                    .map((block) => ({
                    id: block.id,
                    name: block.name,
                    arguments: block.input,
                }));
                return {
                    content,
                    model: response.model,
                    usage: {
                        inputTokens: response.usage.input_tokens,
                        outputTokens: response.usage.output_tokens,
                        cacheReadTokens: response.usage.cache_read_input_tokens,
                        cacheWriteTokens: response.usage.cache_creation_input_tokens,
                    },
                    finishReason: this.mapStopReason(response.stop_reason),
                    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                };
            }
            catch (err) {
                lastError = err;
                if (!this.isRetryable(err))
                    throw err;
                const delay = this.backoffDelay(attempt, err);
                console.warn(`[Anthropic] Request failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), ` +
                    `retrying in ${Math.round(delay)}ms: ${err.message}`);
                await sleep(delay);
            }
        }
        throw lastError ?? new Error('[Anthropic] Request failed after all retries');
    }
    async isAvailable() {
        try {
            await this.client.messages.create({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 1,
                messages: [{ role: 'user', content: 'ping' }],
            });
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Convert our LLMMessage format to Anthropic's format.
     * Handles system prompt extraction and tool result messages.
     */
    convertMessages(messages) {
        let system = '';
        const result = [];
        for (const msg of messages) {
            if (msg.role === 'system') {
                system += (system ? '\n\n' : '') + msg.content;
            }
            else if (msg.role === 'user') {
                result.push({ role: 'user', content: msg.content });
            }
            else if (msg.role === 'assistant') {
                // Build content blocks for assistant messages
                const content = [];
                if (msg.content) {
                    content.push({ type: 'text', text: msg.content });
                }
                if (msg.toolCalls) {
                    for (const tc of msg.toolCalls) {
                        content.push({
                            type: 'tool_use',
                            id: tc.id,
                            name: tc.name,
                            input: tc.arguments,
                        });
                    }
                }
                result.push({ role: 'assistant', content });
            }
            else if (msg.role === 'tool') {
                // Tool results go as user messages with tool_result content type
                result.push({
                    role: 'user',
                    content: [{
                            type: 'tool_result',
                            tool_use_id: msg.toolCallId,
                            content: msg.content,
                        }],
                });
            }
        }
        return { system, messages: result };
    }
    /** Convert our ToolDefinition to Anthropic's format */
    convertTools(tools) {
        return tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: {
                type: 'object',
                properties: t.parameters.properties,
                required: t.parameters.required,
            },
        }));
    }
    mapStopReason(reason) {
        switch (reason) {
            case 'end_turn': return 'end';
            case 'max_tokens': return 'max_tokens';
            case 'stop_sequence': return 'stop';
            case 'tool_use': return 'tool_use';
            default: return 'end';
        }
    }
    isRetryable(err) {
        if (err instanceof Anthropic.RateLimitError)
            return true;
        if (err instanceof Anthropic.InternalServerError)
            return true;
        if (err instanceof Anthropic.APIConnectionError)
            return true;
        const status = err.status;
        return status === 429 || status === 500 || status === 503;
    }
    backoffDelay(attempt, err) {
        const retryAfter = err.headers?.['retry-after'];
        if (retryAfter) {
            const seconds = parseFloat(retryAfter);
            if (!isNaN(seconds))
                return seconds * 1000;
        }
        const jitter = 0.5 + Math.random();
        return BASE_DELAY_MS * Math.pow(2, attempt) * jitter;
    }
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=anthropic.js.map