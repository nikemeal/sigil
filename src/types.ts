/**
 * Sigil Core Types
 *
 * Central type definitions for the entire system. Every module imports from here.
 * Designed to be readable by the agent itself for self-diagnosis (module 9).
 */

// ---------------------------------------------------------------------------
// Messages — the fundamental unit of communication
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// LLM Providers — the interface every provider implements
// ---------------------------------------------------------------------------

/** Messages as the LLM sees them */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** What we send to a provider */
export interface CompletionRequest {
  messages: LLMMessage[];
  model: string;
  maxTokens?: number;
  temperature?: number;
  stop?: string[];
}

/** What a provider sends back */
export interface CompletionResponse {
  content: string;
  model: string;
  usage: TokenUsage;
  finishReason: 'end' | 'max_tokens' | 'stop' | 'error';
}

/** The contract every LLM provider must implement */
export interface LLMProvider {
  readonly name: string;
  readonly providerType: 'anthropic' | 'openai-compatible';
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  isAvailable(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Model Pool — configuration for available models
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Configuration — sigil.toml structure
// ---------------------------------------------------------------------------

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
  tui: { enabled: boolean };
  web: { enabled: boolean; port: number; host: string };
  telegram: { enabled: boolean; botToken?: string; chatId?: string };
}

export interface SigilConfig {
  version: string;
  identity: IdentityConfig;
  models: ModelConfig[];
  defaultModel: string;
  memory: MemoryConfig;
  transports: TransportsConfig;
}

// ---------------------------------------------------------------------------
// Event Bus — typed events for inter-component communication
// ---------------------------------------------------------------------------

/** All events that flow through the bus. Modules 2-12 extend this. */
export interface EventMap {
  // Message lifecycle
  'message:received': Message;
  'message:queued': { messageId: string; position: number };
  'message:processing': { messageId: string };
  'message:complete': Response;
  'message:error': { messageId: string; error: string };

  // Transport events
  'transport:connected': { type: TransportType; id: string };
  'transport:disconnected': { type: TransportType; id: string };

  // System events
  'system:ready': { timestamp: Date };
  'system:shutdown': { reason: string };
  'system:error': { component: string; error: string };

  // Broadcast — send to all connected transports
  'broadcast:response': Response;
  'broadcast:notification': { content: string; severity: 'info' | 'warn' | 'error' };
}

/** Extracts the payload type for a given event name */
export type EventPayload<K extends keyof EventMap> = EventMap[K];
