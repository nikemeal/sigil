import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import TOML from '@iarna/toml';
import type { SigilConfig } from './types.js';

const DEFAULT_CONFIG: SigilConfig = {
  identity: {
    name: 'Sigil',
    personality: 'You are Sigil, a personal AI assistant. Be direct, helpful, and proactive.',
  },
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    maxTokens: 8192,
    temperature: 0.7,
    local: {
      provider: 'ollama',
      model: 'qwen3:8b',
      baseUrl: 'http://localhost:11434',
    },
  },
  routing: {
    strategy: 'smart',
    localToolLimit: 4,
    cloudOnlyTools: ['browser', 'code_exec'],
    escalationPatterns: [
      'write a report', 'analyse this', 'analyze this',
      'in detail', 'comprehensive', 'refactor', 'architect',
    ],
  },
  memory: {
    dbPath: './data/memory.db',
    maxRecall: 10,
  },
  transports: {
    tui: { enabled: true },
    web: { enabled: false, port: 3000, host: '127.0.0.1' },
    telegram: { enabled: false },
    discord: { enabled: false },
  },
  scheduler: {
    enabled: false,
    timezone: 'Europe/London',
  },
  tools: {
    allow: ['*'],
    deny: [],
  },
  updater: {
    autoUpdate: false,
    branch: 'main',
    checkIntervalMs: 60 * 60 * 1000, // 1 hour
  },
};

/**
 * Flatten TOML's snake_case keys into camelCase and merge with defaults.
 * Keeps it simple — no deep validation library needed yet.
 */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function camelizeKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(camelizeKeys);
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        snakeToCamel(k),
        camelizeKeys(v),
      ])
    );
  }
  return obj;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object'
    ) {
      result[key] = deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export function loadConfig(configPath?: string): SigilConfig {
  const path = configPath ?? resolve(process.cwd(), 'sigil.toml');

  if (!existsSync(path)) {
    console.warn(`No config found at ${path}, using defaults.`);
    return DEFAULT_CONFIG;
  }

  const raw = readFileSync(path, 'utf-8');
  const parsed = TOML.parse(raw);
  const camelized = camelizeKeys(parsed) as Record<string, unknown>;

  return deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, camelized) as unknown as SigilConfig;
}
