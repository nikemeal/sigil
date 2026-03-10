import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, CompletionRequest, CompletionResponse, ToolSchema } from '../gateway/types.js';

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;

  constructor(model: string, apiKey?: string) {
    this.model = model;
    this.client = new Anthropic({
      apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
    });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const tools = request.tools?.map(this.toAnthropicTool) ?? [];

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: request.maxTokens ?? 8192,
      system: request.system,
      messages: request.messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      ...(tools.length > 0 ? { tools } : {}),
    });

    // Extract text content and tool calls
    let content = '';
    const toolCalls: CompletionResponse['toolCalls'] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      stopReason: response.stop_reason === 'tool_use' ? 'tool_use' : 'end_turn',
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  private toAnthropicTool(tool: ToolSchema): Anthropic.Tool {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters as Anthropic.Tool['input_schema'],
    };
  }
}
