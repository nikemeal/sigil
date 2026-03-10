// Core types for Sigil — the message bus contract

export type Transport = 'tui' | 'web' | 'telegram' | 'discord' | 'scheduler';

export interface Attachment {
  name: string;
  mimeType: string;
  data: Buffer | string;
  url?: string;
}

export interface Message {
  id: string;
  source: Transport;
  content: string;
  attachments?: Attachment[];
  timestamp: Date;
  threadId?: string;
  metadata?: Record<string, unknown>;
}

export interface Artifact {
  name: string;
  mimeType: string;
  data: string | Buffer;
}

export interface Action {
  tool: string;
  input: Record<string, unknown>;
  output: string;
  durationMs: number;
}

export interface Response {
  id: string;
  replyTo: string;
  content: string;
  artifacts?: Artifact[];
  actions?: Action[];
  timestamp: Date;
}

// Tool system
export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ToolResult {
  content: string;
  isError?: boolean;
  artifacts?: Artifact[];
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(params: Record<string, unknown>): Promise<ToolResult>;
}

// LLM provider
export interface CompletionRequest {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  tools?: ToolSchema[];
  maxTokens?: number;
  temperature?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface CompletionResponse {
  content: string;
  toolCalls?: ToolCall[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LLMProvider {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}

// Routing
export type RoutingStrategy = 'local_first' | 'cloud_first' | 'local_only' | 'cloud_only' | 'smart';

// Config
export interface SigilConfig {
  identity: {
    name: string;
    personality: string;
  };
  llm: {
    provider: string;
    model: string;
    apiKeyEnv: string;
    maxTokens: number;
    temperature: number;
    local?: {
      provider: string;
      model: string;
      baseUrl?: string;
    };
  };
  routing: {
    strategy: RoutingStrategy;
    localToolLimit: number;
    cloudOnlyTools: string[];
    escalationPatterns: string[];
  };
  memory: {
    dbPath: string;
    maxRecall: number;
  };
  transports: {
    tui: { enabled: boolean };
    web: { enabled: boolean; port: number; host: string };
    telegram: { enabled: boolean; tokenEnv?: string };
    discord: { enabled: boolean; tokenEnv?: string };
  };
  scheduler: {
    enabled: boolean;
    timezone: string;
  };
  tools: {
    allow: string[];
    deny: string[];
  };
}

// Scheduler
export interface ScheduledJob {
  id: string;
  cron: string;
  prompt: string;
  enabled: boolean;
  transport: Transport;
  lastRun?: Date;
}
