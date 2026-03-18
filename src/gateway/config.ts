/**
 * Configuration Loader
 *
 * Reads sigil.toml, merges with defaults, and returns a typed SigilConfig.
 * Config grows with each module — new sections are added with sensible defaults
 * so existing installs don't break on update.
 *
 * TOML uses snake_case, TypeScript uses camelCase. Conversion happens here.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as TOML from '@iarna/toml';
import type { SigilConfig, ModelConfig } from '../types.js';

/** Where we look for config, relative to project root */
const CONFIG_PATH = resolve(process.cwd(), 'sigil.toml');

/** Defaults for a fresh install. Just enough to run with one API key. */
const DEFAULTS: SigilConfig = {
  version: '2.0.0',
  identity: {
    name: 'Sigil',
    personality: 'A helpful, direct personal AI agent.',
  },
  models: [],
  defaultModel: '',
  transports: {
    tui: { enabled: true },
    web: { enabled: true, port: 3033, host: '127.0.0.1' },
    telegram: { enabled: false },
  },
};

/**
 * Load and validate configuration from sigil.toml.
 * Returns defaults merged with whatever the user has configured.
 * Missing file is not an error — we return defaults (onboarding will create the file).
 */
export function loadConfig(): SigilConfig {
  if (!existsSync(CONFIG_PATH)) {
    console.warn('[Config] No sigil.toml found — using defaults. Run onboarding to configure.');
    return { ...DEFAULTS };
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = TOML.parse(raw) as Record<string, unknown>;
    return mergeConfig(parsed);
  } catch (err) {
    console.error('[Config] Failed to parse sigil.toml:', err);
    console.warn('[Config] Falling back to defaults.');
    return { ...DEFAULTS };
  }
}

/**
 * Merge parsed TOML into a typed config, applying defaults for missing fields.
 * TOML snake_case keys are converted to camelCase where needed.
 */
function mergeConfig(parsed: Record<string, unknown>): SigilConfig {
  const identity = parsed.identity as Record<string, unknown> | undefined;
  const transports = parsed.transports as Record<string, unknown> | undefined;
  const web = transports?.web as Record<string, unknown> | undefined;
  const telegram = transports?.telegram as Record<string, unknown> | undefined;

  // Parse model pool from [[models]] array
  const models = parseModels(parsed.models as Record<string, unknown>[] | undefined);

  // Determine default model: explicit config, or first model in pool
  const defaultModel =
    (parsed.default_model as string) ??
    (models.length > 0 ? models[0].name : '');

  return {
    version: (parsed.version as string) ?? DEFAULTS.version,
    identity: {
      name: (identity?.name as string) ?? DEFAULTS.identity.name,
      personality: (identity?.personality as string) ?? DEFAULTS.identity.personality,
    },
    models,
    defaultModel,
    transports: {
      tui: {
        enabled: (transports?.tui as Record<string, unknown>)?.enabled !== false,
      },
      web: {
        enabled: web?.enabled !== false,
        port: (web?.port as number) ?? DEFAULTS.transports.web.port,
        host: (web?.host as string) ?? DEFAULTS.transports.web.host,
      },
      telegram: {
        enabled: (telegram?.enabled as boolean) ?? false,
        botToken: (telegram?.bot_token as string) ?? undefined,
        chatId: (telegram?.chat_id as string) ?? undefined,
      },
    },
  };
}

/** Convert [[models]] TOML array into typed ModelConfig[] */
function parseModels(raw: Record<string, unknown>[] | undefined): ModelConfig[] {
  if (!raw || !Array.isArray(raw)) return [];

  return raw.map((m) => ({
    name: m.name as string,
    provider: m.provider as string,
    model: m.model as string,
    tier: (m.tier as ModelConfig['tier']) ?? 'basic',
    costPer1kInput: (m.cost_per_1k_input as number) ?? 0,
    costPer1kOutput: (m.cost_per_1k_output as number) ?? 0,
    useFor: (m.use_for as string[]) ?? [],
    baseUrl: m.base_url as string | undefined,
    apiKeyEnv: m.api_key_env as string | undefined,
    maxTokens: m.max_tokens as number | undefined,
    contextWindow: m.context_window as number | undefined,
  }));
}
