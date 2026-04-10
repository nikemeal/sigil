/**
 * Sigil Core Types
 *
 * Central type definitions for the entire system. Every module imports from here.
 * Designed to be readable by the agent itself for self-diagnosis (module 9).
 */
/** A message flowing into the system from any transport */
export interface Message {
    id: string;
    content: string;
    source: TransportType;
    timestamp: Date;
    metadata?: Record<string, unknown>;
}
/** A response flowing back out to transports */
export interface Response {
    id: string;
    messageId: string;
    content: string;
    model: string;
    timestamp: Date;
    usage?: TokenUsage;
    metadata?: Record<string, unknown>;
}
/** Where a message came from */
export type TransportType = 'tui' | 'websocket' | 'telegram' | 'discord' | 'api';
/** Token counts for cost tracking (module 5+) */
export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
}
/** Messages as the LLM sees them — includes tool use and tool results */
export type LLMMessage = {
    role: 'system';
    content: string;
} | {
    role: 'user';
    content: string;
} | {
    role: 'assistant';
    content: string;
    toolCalls?: ToolCall[];
} | {
    role: 'tool';
    toolCallId: string;
    content: string;
};
/** A tool call requested by the LLM */
export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}
/** Tool definition sent to the LLM so it knows what's available */
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, {
            type: string;
            description: string;
            enum?: string[];
        }>;
        required?: string[];
    };
}
/** What we send to a provider */
export interface CompletionRequest {
    messages: LLMMessage[];
    model: string;
    maxTokens?: number;
    temperature?: number;
    stop?: string[];
    tools?: ToolDefinition[];
}
/** What a provider sends back */
export interface CompletionResponse {
    content: string;
    model: string;
    usage: TokenUsage;
    finishReason: 'end' | 'max_tokens' | 'stop' | 'tool_use' | 'error';
    toolCalls?: ToolCall[];
}
/** The contract every LLM provider must implement */
export interface LLMProvider {
    readonly name: string;
    readonly providerType: 'anthropic' | 'openai-compatible';
    complete(request: CompletionRequest): Promise<CompletionResponse>;
    isAvailable(): Promise<boolean>;
}
/** Approval level for a tool */
export type ToolApproval = 'auto' | 'prompt' | 'deny';
/** A tool the agent can call */
export interface Tool {
    /** Unique name (snake_case) */
    name: string;
    /** Human-readable description for the LLM */
    description: string;
    /** JSON schema for the parameters */
    parameters: ToolDefinition['parameters'];
    /** Approval level — auto (no confirmation), prompt (ask user), deny (disabled) */
    approval: ToolApproval;
    /** Execute the tool. Returns the result as a string. */
    execute(args: Record<string, unknown>): Promise<string>;
}
/** Capability tier determines what a model can handle */
export type ModelTier = 'minimal' | 'basic' | 'standard' | 'full';
/** A configured model in the pool */
export interface ModelConfig {
    name: string;
    provider: string;
    model: string;
    tier: ModelTier;
    costPer1kInput: number;
    costPer1kOutput: number;
    useFor: string[];
    baseUrl?: string;
    apiKeyEnv?: string;
    maxTokens?: number;
    contextWindow?: number;
}
export interface IdentityConfig {
    name: string;
    personality: string;
}
export interface MemoryConfig {
    /** SQLite database path, relative to project root */
    dbPath: string;
    /** Maximum number of recall results per query */
    maxRecallResults: number;
    /** Embedding model name (e.g. 'nomic-embed-text', 'text-embedding-3-small') */
    embeddingModel?: string;
    /** Which provider to use for embeddings — references a [[models]] name or base_url */
    embeddingProvider?: string;
}
export interface TransportsConfig {
    tui: {
        enabled: boolean;
    };
    web: {
        enabled: boolean;
        port: number;
        host: string;
    };
    telegram: {
        enabled: boolean;
        botTokenEnv?: string;
        allowedChatIds?: string[];
    };
}
export interface SkillsConfig {
    /** Directory path relative to project root (default: "skills") */
    path: string;
    /** List of enabled skill names. If undefined, all skills are enabled. */
    enabled?: string[];
}
export interface SigilConfig {
    version: string;
    identity: IdentityConfig;
    models: ModelConfig[];
    defaultModel: string;
    memory: MemoryConfig;
    transports: TransportsConfig;
    skills: SkillsConfig;
    update: UpdateConfig;
}
export type TaskStatus = 'queued' | 'running' | 'paused' | 'complete' | 'error';
/** A background task with optional multi-step orchestration */
export interface Task {
    id: string;
    userMessage: string;
    status: TaskStatus;
    result?: string;
    createdAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    totalCost: number;
    totalTokens: number;
    source: string;
    steps: TaskStep[];
}
/** A single step within an orchestrated task */
export interface TaskStep {
    id: number;
    taskId: string;
    stepNumber: number;
    description: string;
    assignedModel: string;
    assignedTier: string;
    status: TaskStatus;
    result?: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
}
export type ComponentStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
export interface HealthCheckResult {
    component: string;
    status: ComponentStatus;
    message?: string;
    latencyMs?: number;
    checkedAt: Date;
}
export interface TechniqueResult {
    id: string;
    pattern: string;
    technique: string;
    outcome?: string;
    source: 'explicit' | 'auto';
    usageCount: number;
    createdAt: string;
    lastUsed?: string;
}
/** Configuration for the auto-update system */
export interface UpdateConfig {
    /** Whether to auto-check for updates on a schedule */
    enabled: boolean;
    /** How often to check — e.g. "24h", "30m", "7d" */
    checkInterval: string;
    /** Remote tracking branch — e.g. "origin/main" */
    remoteBranch: string;
}
/** Result of a git-based update availability check */
export interface UpdateCheckResult {
    hasUpdate: boolean;
    currentSha: string;
    latestSha: string;
    commitCount: number;
}
/** All events that flow through the bus. Modules 2-12 extend this. */
export interface EventMap {
    'message:received': Message;
    'message:queued': {
        messageId: string;
        position: number;
    };
    'message:processing': {
        messageId: string;
    };
    'message:complete': Response;
    'message:error': {
        messageId: string;
        error: string;
    };
    'tool:calling': {
        messageId: string;
        tool: string;
        args: Record<string, unknown>;
    };
    'tool:result': {
        messageId: string;
        tool: string;
        result: string;
    };
    'tool:approval_needed': {
        messageId: string;
        tool: string;
        args: Record<string, unknown>;
    };
    'tool:approved': {
        messageId: string;
        tool: string;
    };
    'tool:denied': {
        messageId: string;
        tool: string;
    };
    'transport:connected': {
        type: TransportType;
        id: string;
    };
    'transport:disconnected': {
        type: TransportType;
        id: string;
    };
    'system:ready': {
        timestamp: Date;
    };
    'system:shutdown': {
        reason: string;
    };
    'system:error': {
        component: string;
        error: string;
    };
    'task:created': {
        task: Task;
    };
    'task:started': {
        taskId: string;
    };
    'task:step_complete': {
        taskId: string;
        step: TaskStep;
    };
    'task:complete': {
        taskId: string;
        userMessage: string;
        result: string;
        cost: number;
    };
    'task:error': {
        taskId: string;
        error: string;
    };
    'health:check_complete': {
        results: HealthCheckResult[];
        timestamp: Date;
    };
    'health:reconnect_requested': {
        transport: string;
    };
    'diagnosis:patch_applied': {
        modulePath: string;
        reason: string;
    };
    'diagnosis:patch_removed': {
        modulePath: string;
        reason: string;
    };
    'diagnosis:patch_failed': {
        modulePath: string;
        error: string;
    };
    'extension:tool_created': {
        name: string;
        path: string;
    };
    'extension:tool_removed': {
        name: string;
        reason: string;
    };
    'extension:skill_created': {
        name: string;
        path: string;
    };
    'learning:technique_captured': {
        id: string;
        pattern: string;
        source: 'explicit' | 'auto';
    };
    'learning:technique_used': {
        ids: string[];
        query: string;
    };
    'update:available': {
        currentSha: string;
        latestSha: string;
        commitCount: number;
    };
    'update:applying': {};
    'update:complete': {
        previousSha: string;
        newSha: string;
    };
    'update:failed': {
        error: string;
    };
    'update:override_removed': {
        path: string;
        reason: string;
    };
    'update:override_flagged': {
        path: string;
        reason: string;
    };
    'broadcast:response': Response;
    'broadcast:notification': {
        content: string;
        severity: 'info' | 'warn' | 'error';
    };
}
/** Extracts the payload type for a given event name */
export type EventPayload<K extends keyof EventMap> = EventMap[K];
//# sourceMappingURL=types.d.ts.map