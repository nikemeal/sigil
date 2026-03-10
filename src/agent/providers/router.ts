import type { LLMProvider, CompletionRequest, CompletionResponse, ToolSchema } from '../../gateway/types.js';

export type RoutingStrategy = 'local_first' | 'cloud_first' | 'local_only' | 'cloud_only' | 'smart';

interface RouterConfig {
  local: LLMProvider;
  cloud: LLMProvider;
  strategy: RoutingStrategy;
  /** Max tools to expose to local model (fewer = more reliable) */
  localToolLimit: number;
  /** Tools the local model should never attempt */
  cloudOnlyTools: string[];
  /** Keywords/patterns that always route to cloud */
  cloudEscalationPatterns: string[];
}

interface RoutingDecision {
  provider: 'local' | 'cloud';
  reason: string;
}

/**
 * SmartRouter — decides whether to use the local or cloud LLM for each request.
 *
 * The key insight: local models are great for simple, conversational, and
 * single-tool tasks. Cloud models handle complex multi-step reasoning,
 * long context, and tasks requiring many tools.
 *
 * Strategies:
 *  - local_first:  Try local, fall back to cloud on failure
 *  - cloud_first:  Always use cloud (expensive but reliable)
 *  - local_only:   Never call cloud (offline / cost-zero mode)
 *  - cloud_only:   Never use local (same as just using Anthropic)
 *  - smart:        Analyse the request and route intelligently
 */
export class SmartRouter implements LLMProvider {
  private config: RouterConfig;
  private stats = { localCalls: 0, cloudCalls: 0, escalations: 0 };

  constructor(config: RouterConfig) {
    this.config = config;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const decision = this.route(request);

    if (decision.provider === 'local') {
      return this.tryLocal(request, decision);
    }
    return this.callCloud(request, decision.reason);
  }

  /** Decide where to send this request */
  private route(request: CompletionRequest): RoutingDecision {
    const { strategy } = this.config;

    // Simple strategies
    if (strategy === 'local_only') return { provider: 'local', reason: 'local_only mode' };
    if (strategy === 'cloud_only') return { provider: 'cloud', reason: 'cloud_only mode' };
    if (strategy === 'cloud_first') return { provider: 'cloud', reason: 'cloud_first mode' };

    if (strategy === 'local_first') {
      // local_first: start local, fall back on error (handled in tryLocal)
      return { provider: 'local', reason: 'local_first mode' };
    }

    // Smart routing — analyse the request
    return this.smartRoute(request);
  }

  private smartRoute(request: CompletionRequest): RoutingDecision {
    const lastMessage = request.messages[request.messages.length - 1]?.content ?? '';
    const totalContextLength = request.messages.reduce((sum, m) => sum + m.content.length, 0);

    // 1. Check escalation patterns (explicit complexity signals)
    for (const pattern of this.config.cloudEscalationPatterns) {
      if (lastMessage.toLowerCase().includes(pattern.toLowerCase())) {
        return { provider: 'cloud', reason: `escalation pattern: "${pattern}"` };
      }
    }

    // 2. Long context → cloud (local models struggle with 8k+ tokens)
    if (totalContextLength > 6000) {
      return { provider: 'cloud', reason: `long context (${totalContextLength} chars)` };
    }

    // 3. Many tools needed → cloud
    const toolCount = request.tools?.length ?? 0;
    if (toolCount > this.config.localToolLimit) {
      return { provider: 'cloud', reason: `too many tools (${toolCount} > ${this.config.localToolLimit})` };
    }

    // 4. Cloud-only tools requested in context
    if (request.tools?.some(t => this.config.cloudOnlyTools.includes(t.name))) {
      const cloudTools = request.tools
        .filter(t => this.config.cloudOnlyTools.includes(t.name))
        .map(t => t.name);
      return { provider: 'cloud', reason: `cloud-only tools: ${cloudTools.join(', ')}` };
    }

    // 5. Multi-step reasoning signals
    const complexitySignals = [
      /\b(analyse|analyze|compare|evaluate|synthesize|critique)\b/i,
      /\b(step[- ]by[- ]step|multi[- ]step|chain of thought)\b/i,
      /\b(write a (?:report|essay|article|document))\b/i,
      /\b(refactor|architect|design system)\b/i,
      /\b(debug|diagnose|troubleshoot)\b.*\b(complex|weird|strange)\b/i,
    ];

    const complexityScore = complexitySignals.filter(p => p.test(lastMessage)).length;
    if (complexityScore >= 2) {
      return { provider: 'cloud', reason: `high complexity score (${complexityScore})` };
    }

    // 6. Very short / conversational → local
    if (lastMessage.length < 200 && toolCount <= 3) {
      return { provider: 'local', reason: 'short conversational message' };
    }

    // Default: local (with fallback)
    return { provider: 'local', reason: 'default routing' };
  }

  /**
   * Try the local model. If it fails or produces garbage, escalate to cloud.
   */
  private async tryLocal(
    request: CompletionRequest,
    decision: RoutingDecision
  ): Promise<CompletionResponse> {
    // Trim tools for the local model — only give it what it can handle
    const trimmedRequest = this.trimToolsForLocal(request);

    try {
      const response = await this.config.local.complete(trimmedRequest);
      this.stats.localCalls++;

      // Sanity check: if the response is empty or looks broken, escalate
      if (this.shouldEscalate(response)) {
        console.log(`[router] Local model produced poor output, escalating to cloud`);
        this.stats.escalations++;
        return this.callCloud(request, 'escalation: poor local output');
      }

      console.log(`[router] ✓ local (${decision.reason})`);
      return response;

    } catch (err) {
      // Local model failed — escalate to cloud if strategy allows
      if (this.config.strategy === 'local_only') {
        throw err; // No fallback available
      }

      console.log(`[router] Local model failed, escalating to cloud: ${err}`);
      this.stats.escalations++;
      return this.callCloud(request, `escalation: local error`);
    }
  }

  private async callCloud(
    request: CompletionRequest,
    reason: string
  ): Promise<CompletionResponse> {
    this.stats.cloudCalls++;
    console.log(`[router] → cloud (${reason})`);
    return this.config.cloud.complete(request);
  }

  /** Reduce tool set for local model — fewer tools = more reliable tool calling */
  private trimToolsForLocal(request: CompletionRequest): CompletionRequest {
    if (!request.tools) return request;

    const allowedTools = request.tools.filter(
      t => !this.config.cloudOnlyTools.includes(t.name)
    );

    // If still too many, take the most commonly useful ones
    const trimmed = allowedTools.slice(0, this.config.localToolLimit);

    return { ...request, tools: trimmed };
  }

  /** Check if a response looks broken and should be escalated */
  private shouldEscalate(response: CompletionResponse): boolean {
    // Empty response
    if (!response.content && !response.toolCalls?.length) return true;

    // Very short response to what was probably a substantive question
    if (response.content.length < 5 && !response.toolCalls?.length) return true;

    // Obvious failure patterns
    const failPatterns = [
      /^I (?:cannot|can't|am unable)/i,
      /^(?:Error|Sorry, I)/i,
      /as an AI/i,
    ];
    if (failPatterns.some(p => p.test(response.content))) return true;

    return false;
  }

  /** Get routing stats */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }
}

/**
 * Helper to create a SmartRouter with sensible defaults.
 */
export function createRouter(
  local: LLMProvider,
  cloud: LLMProvider,
  options?: Partial<Pick<RouterConfig, 'strategy' | 'localToolLimit' | 'cloudOnlyTools' | 'cloudEscalationPatterns'>>
): SmartRouter {
  return new SmartRouter({
    local,
    cloud,
    strategy: options?.strategy ?? 'smart',
    localToolLimit: options?.localToolLimit ?? 4,
    cloudOnlyTools: options?.cloudOnlyTools ?? ['browser', 'code_exec'],
    cloudEscalationPatterns: options?.cloudEscalationPatterns ?? [
      'write a report',
      'analyse this',
      'analyze this',
      'in detail',
      'comprehensive',
      'step by step',
      'refactor',
      'architect',
      'design system',
      'debug this complex',
      'compare and contrast',
    ],
  });
}
