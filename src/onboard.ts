/**
 * Onboarding Wizard
 *
 * First run: walks through everything — identity, provider, memory, build, start.
 * Re-run: asks which section to update, preserves the rest.
 *
 * Run with: sigil onboard (or npm run onboard)
 */

import { createInterface } from 'node:readline';
import {
  writeFileSync, readFileSync, existsSync,
  copyFileSync, appendFileSync, chmodSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import * as TOML from '@iarna/toml';

const PROJECT_ROOT = process.cwd();
const CONFIG_PATH = resolve(PROJECT_ROOT, 'sigil.toml');
const ENV_PATH = resolve(PROJECT_ROOT, '.env');

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

// ── Helpers ───────────────────────────────────────────────────────────

function ask(question: string, defaultVal?: string): Promise<string> {
  const prompt = defaultVal
    ? `${question} ${chalk.dim(`(${defaultVal})`)}: `
    : `${question}: `;
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

function choose(question: string, options: string[]): Promise<string> {
  console.log(`\n${question}`);
  options.forEach((opt, i) => {
    console.log(`  ${chalk.cyan(`${i + 1}.`)} ${opt}`);
  });
  return new Promise((resolve) => {
    rl.question(`\nChoice ${chalk.dim(`(1-${options.length})`)}: `, (answer) => {
      const idx = parseInt(answer.trim(), 10) - 1;
      if (idx >= 0 && idx < options.length) {
        resolve(options[idx]);
      } else {
        resolve(options[0]);
      }
    });
  });
}

function chooseMultiple(question: string, options: string[]): Promise<string[]> {
  console.log(`\n${question}`);
  options.forEach((opt, i) => {
    console.log(`  ${chalk.cyan(`${i + 1}.`)} ${opt}`);
  });
  console.log(chalk.dim(`\n  Enter numbers separated by commas, or 'all'`));
  return new Promise((resolve) => {
    rl.question(`\nChoices: `, (answer) => {
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === 'all') {
        resolve(options);
        return;
      }
      const indices = trimmed.split(',').map((s) => parseInt(s.trim(), 10) - 1);
      const selected = indices
        .filter((i) => i >= 0 && i < options.length)
        .map((i) => options[i]);
      resolve(selected.length > 0 ? selected : options);
    });
  });
}

function run(cmd: string, label: string): boolean {
  console.log(chalk.dim(`\n  ${label}...`));
  try {
    execSync(cmd, { cwd: PROJECT_ROOT, stdio: 'pipe' });
    console.log(chalk.green(`  ${label} — done`));
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(chalk.red(`  ${label} — failed: ${message}`));
    return false;
  }
}

function hasSystemd(): boolean {
  try {
    execSync('systemctl list-unit-files sigil.service', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function fetchModels(baseUrl: string, apiKey?: string): Promise<string[] | null> {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/models`;
  try {
    const response = await fetch(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { data?: Array<{ id: string }> };
    if (!data.data || !Array.isArray(data.data)) return null;
    return data.data.map((m) => m.id).sort((a, b) => a.localeCompare(b));
  } catch {
    return null;
  }
}

async function selectModel(baseUrl: string, apiKey?: string, defaultModel?: string): Promise<string> {
  console.log(chalk.dim('\n  Fetching available models...'));
  const models = await fetchModels(baseUrl, apiKey);

  if (!models || models.length === 0) {
    console.log(chalk.dim('  Could not fetch models. Enter manually.'));
    return await ask('Model', defaultModel);
  }

  console.log(chalk.green(`  Found ${models.length} models.\n`));
  const pageSize = 20;
  if (models.length <= pageSize) {
    models.forEach((m, i) => console.log(`  ${chalk.cyan(`${i + 1}.`)} ${m}`));
  } else {
    models.slice(0, pageSize).forEach((m, i) => console.log(`  ${chalk.cyan(`${i + 1}.`)} ${m}`));
    console.log(chalk.dim(`  ... and ${models.length - pageSize} more`));
    console.log(chalk.dim(`  Type a number to select, or type a model name directly.`));
  }

  const answer = await ask('\nSelect model (number or name)', defaultModel);
  const idx = parseInt(answer, 10) - 1;
  if (!isNaN(idx) && idx >= 0 && idx < models.length) {
    console.log(chalk.green(`  Selected: ${models[idx]}`));
    return models[idx];
  }
  return answer;
}

async function selectEmbeddingModel(baseUrl: string, apiKey?: string, defaultModel?: string): Promise<string> {
  console.log(chalk.dim('\n  Fetching embedding models...'));
  const models = await fetchModels(baseUrl, apiKey);

  if (!models || models.length === 0) {
    console.log(chalk.dim('  Could not fetch models. Enter manually.'));
    return await ask('Embedding model', defaultModel ?? 'nomic-embed-text');
  }

  // Filter to likely embedding models
  const embeddingKeywords = ['embed', 'minilm', 'bge', 'e5', 'gte', 'nomic'];
  const embeddingModels = models.filter((m) =>
    embeddingKeywords.some((k) => m.toLowerCase().includes(k))
  );

  const displayModels = embeddingModels.length > 0 ? embeddingModels : models;
  const label = embeddingModels.length > 0 ? 'embedding models' : 'models';

  console.log(chalk.green(`  Found ${displayModels.length} ${label}.\n`));
  displayModels.forEach((m, i) => console.log(`  ${chalk.cyan(`${i + 1}.`)} ${m}`));

  if (embeddingModels.length > 0 && embeddingModels.length < models.length) {
    console.log(chalk.dim(`\n  Showing embedding models only. Type a name for any model.`));
  }

  const answer = await ask('\nSelect embedding model (number or name)', defaultModel);
  const idx = parseInt(answer, 10) - 1;
  if (!isNaN(idx) && idx >= 0 && idx < displayModels.length) {
    console.log(chalk.green(`  Selected: ${displayModels[idx]}`));
    return displayModels[idx];
  }
  return answer;
}

// ── Config state ──────────────────────────────────────────────────────

interface ProviderConfig {
  type: 'anthropic' | 'openai' | 'openai-compatible';
  modelName: string;
  model: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  tier: string;
  costIn: number;
  costOut: number;
}

interface OnboardState {
  identity: { name: string; personality: string };
  providers: ProviderConfig[];
  memory: {
    embeddingModel?: string;
    embeddingProvider?: string;
  };
  telegram: {
    enabled: boolean;
    botTokenEnv?: string;
    allowedChatIds?: string[];
  };
  envLines: string[];
}

/** Load existing config into onboard state, or return null */
function loadExistingState(): OnboardState | null {
  if (!existsSync(CONFIG_PATH)) return null;

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = TOML.parse(raw) as Record<string, unknown>;
    const identity = parsed.identity as Record<string, unknown> | undefined;
    const models = parsed.models as Record<string, unknown>[] | undefined;
    const memory = parsed.memory as Record<string, unknown> | undefined;
    const transports = parsed.transports as Record<string, unknown> | undefined;
    const telegram = transports?.telegram as Record<string, unknown> | undefined;

    if (!models || models.length === 0) return null;

    const providers: ProviderConfig[] = models.map((m) => {
      const prov = m.provider as string;
      return {
        type: prov === 'anthropic' ? 'anthropic'
          : (m.base_url as string)?.includes('api.openai.com') ? 'openai'
          : 'openai-compatible',
        modelName: m.name as string,
        model: m.model as string,
        baseUrl: m.base_url as string | undefined,
        apiKeyEnv: m.api_key_env as string | undefined,
        tier: (m.tier as string) ?? 'basic',
        costIn: (m.cost_per_1k_input as number) ?? 0,
        costOut: (m.cost_per_1k_output as number) ?? 0,
      };
    });

    return {
      identity: {
        name: (identity?.name as string) ?? 'Sigil',
        personality: (identity?.personality as string) ?? 'A helpful, direct personal AI agent.',
      },
      providers,
      memory: {
        embeddingModel: memory?.embedding_model as string | undefined,
        embeddingProvider: memory?.embedding_provider as string | undefined,
      },
      telegram: {
        enabled: (telegram?.enabled as boolean) ?? false,
        botTokenEnv: telegram?.bot_token_env as string | undefined,
        allowedChatIds: telegram?.allowed_chat_ids as string[] | undefined,
      },
      envLines: [],
    };
  } catch {
    return null;
  }
}

// ── Sections ──────────────────────────────────────────────────────────

async function setupIdentity(state: OnboardState): Promise<void> {
  console.log(chalk.bold('\nIdentity'));
  state.identity.name = await ask('Agent name', state.identity.name);
  state.identity.personality = await ask('Personality', state.identity.personality);
}

async function setupProvider(state: OnboardState): Promise<void> {
  if (state.providers.length === 0) {
    // First run: add from scratch
    await addProvider(state);
    while (true) {
      const more = await ask('Add another model? (y/n)', 'n');
      if (more.toLowerCase() !== 'y') break;
      await addProvider(state);
    }
    return;
  }

  // Re-run: show what's configured, then ask what to do
  while (true) {
    console.log(chalk.bold('\nConfigured Models'));
    for (const p of state.providers) {
      const provLabel = p.type === 'anthropic' ? 'Anthropic' : p.baseUrl ?? 'OpenAI';
      console.log(`  ${chalk.cyan('→')} ${p.modelName} — ${provLabel}, ${p.model} (${p.tier})`);
    }

    const action = await choose('What would you like to do?', [
      'Add a new model',
      'Reconfigure an existing model',
      'Remove a model',
      'Done — keep as-is',
    ]);

    if (action.startsWith('Done')) {
      break;

    } else if (action.startsWith('Add')) {
      await addProvider(state);

    } else if (action.startsWith('Reconfigure')) {
      const names = state.providers.map((p) => `${p.modelName} (${p.model})`);
      const picked = await choose('Which model?', names);
      const idx = names.indexOf(picked);
      if (idx >= 0) {
        console.log(chalk.dim(`\n  Replacing ${state.providers[idx].modelName}...`));
        const before = state.providers.length;
        await addProvider(state);
        // Replace old with new
        if (state.providers.length > before) {
          state.providers[idx] = state.providers.pop()!;
        }
      }

    } else if (action.startsWith('Remove')) {
      if (state.providers.length <= 1) {
        console.log(chalk.yellow('\n  You need at least one model. Add another before removing.'));
        continue;
      }
      const names = state.providers.map((p) => `${p.modelName} (${p.model})`);
      const picked = await choose('Which model to remove?', names);
      const idx = names.indexOf(picked);
      if (idx >= 0) {
        console.log(chalk.green(`  Removed ${state.providers[idx].modelName}`));
        state.providers.splice(idx, 1);
      }
    }
  }
}

async function addProvider(state: OnboardState): Promise<void> {
  console.log();
  console.log(chalk.bold(state.providers.length === 0 ? 'LLM Provider' : 'Additional Model'));
  const providerChoice = await choose('Which LLM provider?', [
    'Anthropic (Claude)',
    'OpenAI',
    'OpenAI-compatible (Ollama, Groq, LM Studio, etc.)',
  ]);

  if (providerChoice.startsWith('Anthropic')) {
    const apiKey = await ask('Anthropic API key');
    const model = await ask('Model', 'claude-sonnet-4-20250514');
    state.providers.push({
      type: 'anthropic', modelName: 'claude', model,
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      tier: 'standard', costIn: 0.003, costOut: 0.015,
    });
    state.envLines.push(`ANTHROPIC_API_KEY=${apiKey}`);

  } else if (providerChoice === 'OpenAI') {
    const apiKey = await ask('OpenAI API key');
    const model = await selectModel('https://api.openai.com', apiKey, 'gpt-4o');
    state.providers.push({
      type: 'openai', modelName: 'openai', model,
      baseUrl: 'https://api.openai.com', apiKeyEnv: 'OPENAI_API_KEY',
      tier: 'standard', costIn: 0.005, costOut: 0.015,
    });
    state.envLines.push(`OPENAI_API_KEY=${apiKey}`);

  } else {
    const baseUrl = await ask('API base URL', 'http://localhost:11434');
    const needsKey = await ask('Requires API key? (y/n)', 'n');
    let apiKey: string | undefined;
    let apiKeyEnv: string | undefined;

    if (needsKey.toLowerCase() === 'y') {
      apiKey = await ask('API key');
      apiKeyEnv = 'LLM_API_KEY';
      state.envLines.push(`LLM_API_KEY=${apiKey}`);
    }

    const model = await selectModel(baseUrl, apiKey, 'qwen3:8b');
    state.providers.push({
      type: 'openai-compatible', modelName: 'local', model,
      baseUrl, apiKeyEnv,
      tier: 'basic', costIn: 0, costOut: 0,
    });
  }
}

async function setupMemory(state: OnboardState): Promise<void> {
  console.log();
  console.log(chalk.bold('Memory'));
  console.log(chalk.dim('  Sigil uses keyword search (FTS5) for memory by default.'));
  console.log(chalk.dim('  You can also enable semantic search with vector embeddings'));
  console.log(chalk.dim('  for more accurate memory recall.\n'));

  const enableEmbeddings = await ask(
    'Enable vector embeddings?',
    state.memory.embeddingModel ? 'y' : 'n',
  );

  if (enableEmbeddings.toLowerCase() !== 'y') {
    state.memory.embeddingModel = undefined;
    state.memory.embeddingProvider = undefined;
    console.log(chalk.dim('  Using keyword search only. You can enable embeddings later via sigil onboard.\n'));
    return;
  }

  // Determine where embeddings come from
  console.log(chalk.dim('\n  Embeddings need a model that converts text to vectors.'));
  console.log(chalk.dim('  This can run on the same provider as your LLM.\n'));

  if (state.providers[0].type === 'anthropic') {
    // Anthropic doesn't offer embeddings — need a separate source
    console.log(chalk.yellow('  Note: Anthropic does not offer embeddings.'));
    console.log(chalk.dim('  You\'ll need a separate provider (e.g. Ollama with nomic-embed-text,'));
    console.log(chalk.dim('  or an OpenAI API key for text-embedding-3-small).\n'));

    const embProvider = await choose('Embedding provider?', [
      'Ollama (local)',
      'OpenAI',
      'Other OpenAI-compatible',
      'Skip for now',
    ]);

    if (embProvider === 'Skip for now') {
      state.memory.embeddingModel = undefined;
      state.memory.embeddingProvider = undefined;
      return;
    }

    let baseUrl: string;
    let apiKey: string | undefined;

    if (embProvider === 'Ollama (local)') {
      baseUrl = await ask('Ollama URL', 'http://localhost:11434');
    } else if (embProvider === 'OpenAI') {
      baseUrl = 'https://api.openai.com';
      apiKey = await ask('OpenAI API key (for embeddings)');
      state.envLines.push(`OPENAI_API_KEY=${apiKey}`);
    } else {
      baseUrl = await ask('Embeddings API base URL');
      const needsKey = await ask('Requires API key? (y/n)', 'n');
      if (needsKey.toLowerCase() === 'y') {
        apiKey = await ask('API key');
        state.envLines.push(`EMBEDDING_API_KEY=${apiKey}`);
      }
    }

    const model = await selectEmbeddingModel(baseUrl, apiKey);
    state.memory.embeddingModel = model;
    state.memory.embeddingProvider = baseUrl;

  } else {
    // OpenAI or OpenAI-compatible — embeddings likely available on same provider
    const providerLabel = state.providers[0].type === 'openai'
      ? 'OpenAI' : state.providers[0].baseUrl;
    const sameProvider = await ask(`Use ${providerLabel} for embeddings?`, 'y');

    if (sameProvider.toLowerCase() === 'y') {
      const baseUrl = state.providers[0].baseUrl ?? 'https://api.openai.com';
      const defaultEmbed = state.providers[0].type === 'openai'
        ? 'text-embedding-3-small' : 'nomic-embed-text';
      const model = await selectEmbeddingModel(baseUrl, undefined, defaultEmbed);
      state.memory.embeddingModel = model;
      state.memory.embeddingProvider = baseUrl;
    } else {
      const baseUrl = await ask('Embeddings API base URL');
      const model = await selectEmbeddingModel(baseUrl);
      state.memory.embeddingModel = model;
      state.memory.embeddingProvider = baseUrl;
    }
  }

  if (state.memory.embeddingModel) {
    console.log(chalk.green(`\n  Embeddings: ${state.memory.embeddingModel}`));
  }
}

async function setupTransports(state: OnboardState): Promise<void> {
  console.log();
  console.log(chalk.bold('Transports'));

  // Telegram
  const enableTelegram = await ask(
    'Enable Telegram?',
    state.telegram.enabled ? 'y' : 'n',
  );

  if (enableTelegram.toLowerCase() === 'y') {
    state.telegram.enabled = true;

    const botToken = await ask('Telegram bot token');
    state.telegram.botTokenEnv = 'TELEGRAM_BOT_TOKEN';
    state.envLines.push(`TELEGRAM_BOT_TOKEN=${botToken}`);

    const restrict = await ask('Restrict bot to specific users?', 'y');

    if (restrict.toLowerCase() === 'y') {
      console.log(chalk.dim('\n  Enter Telegram chat IDs (comma-separated).'));
      console.log(chalk.dim('  To find your chat ID: send a message to the bot, then check sigil logs.\n'));
      const chatIds = await ask('Allowed chat IDs');
      const ids = chatIds.split(',').map((id) => id.trim()).filter(Boolean);
      state.telegram.allowedChatIds = ids.length > 0 ? ids : undefined;
    } else {
      state.telegram.allowedChatIds = undefined;
      console.log(chalk.yellow('\n  Warning: bot will respond to anyone who messages it.'));
      console.log(chalk.dim('  You can add restrictions later via sigil onboard.\n'));
    }
  } else {
    state.telegram.enabled = false;
    state.telegram.botTokenEnv = undefined;
    state.telegram.allowedChatIds = undefined;
  }
}

// ── Config generation ─────────────────────────────────────────────────

function generateToml(state: OnboardState): string {
  const models = state.providers.map((p) => {
    const entry: Record<string, unknown> = {
      name: p.modelName,
      provider: p.type === 'anthropic' ? 'anthropic' : 'openai-compatible',
      model: p.model,
      tier: p.tier,
    };
    if (p.baseUrl) entry.base_url = p.baseUrl;
    if (p.apiKeyEnv) entry.api_key_env = p.apiKeyEnv;
    entry.cost_per_1k_input = p.costIn;
    entry.cost_per_1k_output = p.costOut;
    entry.use_for = ['general'];
    return entry;
  });

  const config: Record<string, unknown> = {
    version: '2.0.0',
    identity: {
      name: state.identity.name,
      personality: state.identity.personality,
    },
    models,
    default_model: state.providers[0]?.modelName ?? '',
    memory: {
      db_path: 'data/sigil.db',
      max_recall_results: 5,
      ...(state.memory.embeddingModel && { embedding_model: state.memory.embeddingModel }),
      ...(state.memory.embeddingProvider && { embedding_provider: state.memory.embeddingProvider }),
    },
    transports: {
      tui: { enabled: true },
      web: { enabled: true, port: 3033, host: '127.0.0.1' },
      telegram: {
        enabled: state.telegram.enabled,
        ...(state.telegram.botTokenEnv && { bot_token_env: state.telegram.botTokenEnv }),
        ...(state.telegram.allowedChatIds && state.telegram.allowedChatIds.length > 0 && {
          allowed_chat_ids: state.telegram.allowedChatIds,
        }),
      },
    },
  };

  return `# Sigil Configuration\n# Generated by onboarding wizard\n\n${TOML.stringify(config as TOML.JsonMap)}`;
}

function writeConfig(state: OnboardState): void {
  console.log(chalk.bold('\n  Writing configuration...'));

  if (state.envLines.length > 0) {
    const envContent = state.envLines.join('\n') + '\n';
    if (existsSync(ENV_PATH)) {
      appendFileSync(ENV_PATH, envContent, 'utf-8');
    } else {
      writeFileSync(ENV_PATH, envContent, 'utf-8');
      chmodSync(ENV_PATH, 0o600);
    }
    console.log(chalk.green(`  API key(s) saved to .env`));
  }

  writeFileSync(CONFIG_PATH, generateToml(state), 'utf-8');
  console.log(chalk.green(`  Config written to sigil.toml`));
}

// ── Main ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(chalk.bold('\n  Sigil Setup\n'));

  const existing = loadExistingState();

  if (existing) {
    // Re-run mode
    console.log(chalk.dim('  Existing configuration found.\n'));

    const sections = await chooseMultiple('What would you like to update?', [
      'Identity (name, personality)',
      'LLM Provider',
      'Memory & Embeddings',
      'Transports (Telegram)',
    ]);

    const state = existing;

    const backup = `${CONFIG_PATH}.backup-${Date.now()}`;
    copyFileSync(CONFIG_PATH, backup);
    console.log(chalk.dim(`\n  Config backed up to ${backup}`));

    if (sections.some((s) => s.startsWith('Identity'))) {
      await setupIdentity(state);
    }
    if (sections.some((s) => s.startsWith('LLM'))) {
      await setupProvider(state);
    }
    if (sections.some((s) => s.startsWith('Memory'))) {
      await setupMemory(state);
    }
    if (sections.some((s) => s.startsWith('Transports'))) {
      await setupTransports(state);
    }

    writeConfig(state);

  } else {
    // First run
    console.log(chalk.dim('  One command to configure, build, and start your agent.\n'));

    const state: OnboardState = {
      identity: { name: 'Sigil', personality: '' },
      providers: [],
      memory: {},
      telegram: { enabled: false },
      envLines: [],
    };

    await setupIdentity(state);
    await setupProvider(state);
    await setupMemory(state);
    await setupTransports(state);
    writeConfig(state);
  }

  // Build and start
  run('npx tsc', 'Building');

  if (hasSystemd()) {
    run('sudo systemctl restart sigil', 'Starting service');
    console.log(chalk.bold('\n  Setup complete!\n'));
    console.log(`  ${chalk.green('Service is running.')} Connect with:\n`);
    console.log(`    ${chalk.cyan('sigil tui')}\n`);
  } else {
    console.log(chalk.bold('\n  Setup complete!\n'));
    console.log(`  Start the service and connect:\n`);
    console.log(`    ${chalk.cyan('npm run dev')}     ${chalk.dim('# in one terminal')}`);
    console.log(`    ${chalk.cyan('npm run tui')}     ${chalk.dim('# in another')}\n`);
  }

  rl.close();
}

main().catch((err) => {
  console.error('Onboarding error:', err);
  rl.close();
  process.exit(1);
});
