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
/** Where we look for config, relative to project root */
const CONFIG_PATH = resolve(process.cwd(), 'sigil.toml');
/** Defaults for a fresh install. Just enough to run with one API key. */
const DEFAULTS = {
    version: '2.0.0',
    identity: {
        name: 'Sigil',
        personality: 'A helpful, direct personal AI agent.',
    },
    models: [],
    defaultModel: '',
    memory: {
        dbPath: 'data/sigil.db',
        maxRecallResults: 5,
    },
    transports: {
        tui: { enabled: true },
        web: { enabled: true, port: 3033, host: '127.0.0.1' },
        telegram: { enabled: false, botTokenEnv: undefined, allowedChatIds: undefined },
    },
    skills: {
        path: 'skills',
    },
    update: {
        enabled: true,
        checkInterval: '24h',
        remoteBranch: 'origin/main',
    },
};
/**
 * Load and validate configuration from sigil.toml.
 * Returns defaults merged with whatever the user has configured.
 * Missing file is not an error — we return defaults (onboarding will create the file).
 */
export function loadConfig() {
    if (!existsSync(CONFIG_PATH)) {
        console.warn('[Config] No sigil.toml found — using defaults. Run onboarding to configure.');
        return { ...DEFAULTS };
    }
    try {
        const raw = readFileSync(CONFIG_PATH, 'utf-8');
        const parsed = TOML.parse(raw);
        return mergeConfig(parsed);
    }
    catch (err) {
        const tomlErr = err;
        if (tomlErr.line !== undefined) {
            console.error(`[Config] TOML parse error in ${CONFIG_PATH} at line ${tomlErr.line}, col ${tomlErr.col}: ${tomlErr.message}`);
        }
        else {
            console.error('[Config] Failed to parse sigil.toml:', err);
        }
        console.warn('[Config] Falling back to defaults. Fix sigil.toml or re-run: npm run onboard');
        return { ...DEFAULTS };
    }
}
/**
 * Merge parsed TOML into a typed config, applying defaults for missing fields.
 * TOML snake_case keys are converted to camelCase where needed.
 */
function mergeConfig(parsed) {
    const identity = parsed.identity;
    const memory = parsed.memory;
    const transports = parsed.transports;
    const skills = parsed.skills;
    const update = parsed.update;
    const web = transports?.web;
    const telegram = transports?.telegram;
    // Parse model pool from [[models]] array
    const models = parseModels(parsed.models);
    // Determine default model: explicit config, or first model in pool
    const defaultModel = parsed.default_model ??
        (models.length > 0 ? models[0].name : '');
    return {
        version: parsed.version ?? DEFAULTS.version,
        identity: {
            name: identity?.name ?? DEFAULTS.identity.name,
            personality: identity?.personality ?? DEFAULTS.identity.personality,
        },
        models,
        defaultModel,
        memory: {
            dbPath: memory?.db_path ?? DEFAULTS.memory.dbPath,
            maxRecallResults: memory?.max_recall_results ?? DEFAULTS.memory.maxRecallResults,
            embeddingModel: memory?.embedding_model ?? undefined,
            embeddingProvider: memory?.embedding_provider ?? undefined,
        },
        transports: {
            tui: {
                enabled: transports?.tui?.enabled !== false,
            },
            web: {
                enabled: web?.enabled !== false,
                port: web?.port ?? DEFAULTS.transports.web.port,
                host: web?.host ?? DEFAULTS.transports.web.host,
            },
            telegram: {
                enabled: telegram?.enabled ?? false,
                botTokenEnv: telegram?.bot_token_env ?? undefined,
                allowedChatIds: parseChatIds(telegram?.allowed_chat_ids),
            },
        },
        skills: {
            path: skills?.path ?? DEFAULTS.skills.path,
            enabled: parseStringArray(skills?.enabled),
        },
        update: {
            enabled: update?.enabled ?? true,
            checkInterval: update?.check_interval ?? '24h',
            remoteBranch: update?.remote_branch ?? 'origin/main',
        },
    };
}
/** Parse allowed_chat_ids — could be array of strings or numbers in TOML */
function parseChatIds(raw) {
    if (!raw)
        return undefined;
    if (Array.isArray(raw)) {
        const ids = raw.map((id) => String(id)).filter(Boolean);
        return ids.length > 0 ? ids : undefined;
    }
    return undefined;
}
/** Parse a TOML value that should be a string array (handles bare string too) */
function parseStringArray(raw) {
    if (!raw)
        return undefined;
    if (Array.isArray(raw)) {
        const items = raw.map((s) => String(s)).filter(Boolean);
        return items.length > 0 ? items : undefined;
    }
    if (typeof raw === 'string')
        return [raw];
    return undefined;
}
/** Convert [[models]] TOML array into typed ModelConfig[] */
function parseModels(raw) {
    if (!raw || !Array.isArray(raw))
        return [];
    return raw.map((m) => ({
        name: m.name,
        provider: m.provider,
        model: m.model,
        tier: m.tier ?? 'basic',
        costPer1kInput: m.cost_per_1k_input ?? 0,
        costPer1kOutput: m.cost_per_1k_output ?? 0,
        useFor: m.use_for ?? [],
        baseUrl: m.base_url,
        apiKeyEnv: m.api_key_env,
        maxTokens: m.max_tokens,
        contextWindow: m.context_window,
    }));
}
//# sourceMappingURL=config.js.map