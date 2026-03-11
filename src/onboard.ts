#!/usr/bin/env node

import * as readline from 'node:readline';
import { writeFileSync, readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import TOML from '@iarna/toml';
import { CopilotAuth } from './agent/providers/copilot-auth.js';

/**
 * Interactive onboarding wizard.
 * Run with: sigil onboard (or npx tsx src/onboard.ts)
 *
 * First run — walks through full setup:
 * 1. Agent name & personality
 * 2. LLM setup (cloud + local)
 * 3. Transport selection + setup
 * 4. Personal context
 * 5. Writes sigil.toml + initial skill files
 *
 * Re-run — detects existing config and lets you update specific sections.
 */

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  return new Promise(resolve => {
    rl.question(`  ${question}${suffix}: `, answer => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function choose(question: string, options: string[]): Promise<string> {
  return new Promise(resolve => {
    console.log(`  ${question}`);
    options.forEach((opt, i) => console.log(`    ${i + 1}. ${opt}`));
    rl.question('  Choose (number): ', answer => {
      const idx = parseInt(answer.trim()) - 1;
      resolve(options[idx] ?? options[0]);
    });
  });
}

function multiChoice(question: string, options: string[]): Promise<string[]> {
  return new Promise(resolve => {
    console.log(`  ${question}`);
    options.forEach((opt, i) => console.log(`    ${i + 1}. ${opt}`));
    rl.question('  Choose (comma-separated numbers, e.g. 1,3): ', answer => {
      const indices = answer.split(',').map(s => parseInt(s.trim()) - 1);
      const selected = indices.filter(i => i >= 0 && i < options.length).map(i => options[i]);
      resolve(selected.length > 0 ? selected : [options[0]]);
    });
  });
}

// ── Existing config helpers ──────────────────────────────────────

interface ExistingConfig {
  identity?: { name?: string; personality?: string };
  llm?: {
    provider?: string; model?: string; api_key_env?: string;
    max_tokens?: number; temperature?: number;
    local?: { provider?: string; model?: string; base_url?: string };
  };
  routing?: {
    strategy?: string; local_tool_limit?: number;
    cloud_only_tools?: string[]; escalation_patterns?: string[];
  };
  memory?: { db_path?: string; max_recall?: number };
  transports?: {
    tui?: { enabled?: boolean };
    web?: { enabled?: boolean; port?: number; host?: string };
    telegram?: { enabled?: boolean; token_env?: string };
    discord?: { enabled?: boolean; token_env?: string };
  };
  scheduler?: { enabled?: boolean; timezone?: string };
  tools?: { allow?: string[]; deny?: string[] };
  updater?: { auto_update?: boolean; branch?: string; check_interval_ms?: number };
}

function loadExisting(configPath: string): ExistingConfig | null {
  if (!existsSync(configPath)) return null;
  try {
    const raw = readFileSync(configPath, 'utf-8');
    return TOML.parse(raw) as unknown as ExistingConfig;
  } catch {
    return null;
  }
}

function backupConfig(configPath: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = `${configPath}.backup-${ts}`;
  copyFileSync(configPath, backupPath);
  return backupPath;
}

// ── Section wizards ──────────────────────────────────────────────

type ConfigState = {
  agentName: string;
  personality: string;
  cloudProvider: string;     // 'anthropic' | 'copilot'
  modelString: string;
  hasApiKey: boolean;
  copilotModel: string;      // model selected from Copilot's model list
  useLocal: boolean;
  localModel: string;
  ollamaUrl: string;
  strategy: string;
  enableWeb: boolean;
  enableTelegram: boolean;
  enableDiscord: boolean;
  webPort: number;
  timezone: string;
  contextParts: string[];
  userName: string;
  // Preserved fields from existing config
  updater?: ExistingConfig['updater'];
};

function stateFromExisting(existing: ExistingConfig): ConfigState {
  const t = existing.transports ?? {};
  return {
    agentName: existing.identity?.name ?? 'Sigil',
    personality: existing.identity?.personality ?? '',
    cloudProvider: existing.llm?.provider ?? 'anthropic',
    modelString: existing.llm?.model ?? 'claude-sonnet-4-20250514',
    hasApiKey: true,
    copilotModel: (existing.llm as any)?.copilot?.model ?? '',
    useLocal: !!existing.llm?.local?.model,
    localModel: existing.llm?.local?.model ?? '',
    ollamaUrl: existing.llm?.local?.base_url ?? 'http://localhost:11434',
    strategy: existing.routing?.strategy ?? 'smart',
    enableWeb: t.web?.enabled ?? false,
    enableTelegram: t.telegram?.enabled ?? false,
    enableDiscord: t.discord?.enabled ?? false,
    webPort: t.web?.port ?? 3000,
    timezone: existing.scheduler?.timezone ?? 'Europe/London',
    contextParts: [],
    userName: '',
    updater: existing.updater,
  };
}

async function wizardIdentity(state: ConfigState): Promise<void> {
  console.log('\n  ── Identity ──\n');

  state.agentName = await ask('What should your agent be called?', state.agentName);

  const personalityStyle = await choose('What personality style?', [
    'Direct & technical — gets things done, minimal chat',
    'Friendly & proactive — warm but efficient',
    'Formal & thorough — detailed, professional',
    'Custom — I\'ll write it myself',
  ]);

  if (personalityStyle.includes('Custom')) {
    state.personality = await ask('Write your agent personality (one paragraph)', state.personality);
  } else {
    const styleMap: Record<string, string> = {
      'Direct & technical': `You are ${state.agentName}, a personal AI assistant. Be direct, technical, and action-oriented. Don't hedge or waffle. If you can do something with tools, just do it. Report back concisely.`,
      'Friendly & proactive': `You are ${state.agentName}, a personal AI assistant. Be warm and approachable but efficient. Anticipate needs, suggest helpful actions, and keep things conversational without being verbose.`,
      'Formal & thorough': `You are ${state.agentName}, a personal AI assistant. Be professional and thorough. Provide detailed explanations when asked, cite sources, and structure responses clearly.`,
    };
    const key = Object.keys(styleMap).find(k => personalityStyle.includes(k)) ?? 'Direct & technical';
    state.personality = styleMap[key];
  }
}

async function wizardLLM(state: ConfigState): Promise<void> {
  console.log('\n  ── LLM Setup ──\n');

  const providerChoice = await choose('Cloud LLM provider?', [
    'Anthropic — Claude models (requires API key)',
    'GitHub Copilot — use your Copilot subscription (OAuth login)',
  ]);

  if (providerChoice.includes('Copilot')) {
    state.cloudProvider = 'copilot';
    state.hasApiKey = true; // Copilot uses OAuth, not API keys

    // Run the GitHub device flow
    console.log('\n  Authenticating with GitHub Copilot...\n');

    const dataDir = resolve('data');
    mkdirSync(dataDir, { recursive: true });
    const copilotAuth = new CopilotAuth(dataDir);

    if (copilotAuth.isAuthenticated) {
      const reuse = await ask('  Existing Copilot login found. Use it? (y/n)', 'y');
      if (reuse.toLowerCase() !== 'y') {
        copilotAuth.logout();
      }
    }

    if (!copilotAuth.isAuthenticated) {
      try {
        const flow = await copilotAuth.startDeviceFlow();

        console.log(`  1. Open: ${flow.verificationUri}`);
        console.log(`  2. Enter code: ${flow.userCode}`);
        console.log('  3. Waiting for authorization...\n');

        await flow.waitForAuth();
        console.log('  ✓ GitHub authentication successful!\n');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ Authentication failed: ${msg}`);
        console.log('  Falling back to Anthropic provider.\n');
        state.cloudProvider = 'anthropic';
        copilotAuth.stop();
        await wizardLLMAnthropicModel(state);
        return await wizardLLMLocal(state);
      }
    }

    // Fetch available models
    try {
      console.log('  Fetching available models...\n');
      const models = await copilotAuth.listModels();
      copilotAuth.stop();

      if (models.length === 0) {
        console.log('  No models returned from Copilot API.');
        console.log('  Your subscription may not include chat models, or the API may be unavailable.');
        console.log('  Falling back to Anthropic provider.\n');
        state.cloudProvider = 'anthropic';
        await wizardLLMAnthropicModel(state);
        return await wizardLLMLocal(state);
      }

      const modelOptions = models.map(m => `${m.id} (${m.version})`);
      const selectedModel = await choose('Select a Copilot model:', modelOptions);
      state.copilotModel = selectedModel.split(' ')[0];
      state.modelString = state.copilotModel;
      console.log(`\n  Using: ${state.copilotModel}\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ Failed to fetch models: ${msg}`);
      console.log('  You can set the model manually in sigil.toml.\n');
      state.copilotModel = await ask('  Enter a model ID manually (e.g. gpt-4o, claude-sonnet-4-20250514)', 'gpt-4o');
      state.modelString = state.copilotModel;
      copilotAuth.stop();
    }
  } else {
    state.cloudProvider = 'anthropic';
    await wizardLLMAnthropicModel(state);
  }

  await wizardLLMLocal(state);
}

async function wizardLLMAnthropicModel(state: ConfigState): Promise<void> {
  const currentModel = state.modelString.includes('opus') ? 'opus' : 'sonnet';
  const cloudModel = await choose(`Cloud LLM (for complex tasks)? [current: ${currentModel}]`, [
    'claude-sonnet-4-20250514 (recommended — fast + capable)',
    'claude-opus-4-6 (most powerful, slower, pricier)',
  ]);
  state.modelString = cloudModel.includes('opus') ? 'claude-opus-4-6' : 'claude-sonnet-4-20250514';

  const hasKey = await ask('Do you have an ANTHROPIC_API_KEY set? (y/n)', 'y');
  state.hasApiKey = hasKey.toLowerCase() === 'y';
}

async function wizardLLMLocal(state: ConfigState): Promise<void> {
  const currentLocal = state.useLocal ? 'y' : 'n';
  const useLocal = await ask('Set up a local LLM via Ollama? (y/n)', currentLocal);
  state.useLocal = useLocal.toLowerCase() === 'y';

  if (state.useLocal) {
    state.ollamaUrl = await ask('Ollama URL', state.ollamaUrl);
    const localModel = await choose('Local model?', [
      'qwen3:8b (best all-rounder for 8GB)',
      'qwen3:14b (near GPT-4, needs 16GB)',
      'llama3.3:8b (strong general + coding)',
      'mistral:7b (fast, good for chat)',
      'Custom model name',
    ]);

    if (localModel.includes('Custom')) {
      state.localModel = await ask('Model name (as used with ollama pull)', state.localModel);
    } else {
      state.localModel = localModel.split(' ')[0];
    }

    console.log(`\n  Make sure to run: ollama pull ${state.localModel}`);
  } else {
    state.localModel = '';
    state.ollamaUrl = '';
  }

  const strategyOptions = [
    'smart — auto-decide per request (recommended)',
    'local_first — prefer local, fall back to cloud',
    'local_only — fully offline, no cloud calls',
    'cloud_only — always use cloud',
  ];
  const routingStrategy = await choose(`Routing strategy? [current: ${state.strategy}]`, strategyOptions);
  state.strategy = routingStrategy.split(' ')[0];
}

async function wizardTransports(state: ConfigState): Promise<void> {
  console.log('\n  ── Transports ──\n');

  const current: string[] = ['Terminal (TUI) — always on'];
  if (state.enableWeb) current.push('Web UI');
  if (state.enableTelegram) current.push('Telegram');
  if (state.enableDiscord) current.push('Discord');
  console.log(`  Currently enabled: ${current.join(', ')}\n`);

  const transports = await multiChoice('How will you talk to your agent?', [
    'Terminal (TUI) — always on',
    'Web UI',
    'Telegram',
    'Discord',
  ]);

  state.enableWeb = transports.some(t => t.includes('Web'));
  state.enableTelegram = transports.some(t => t.includes('Telegram'));
  state.enableDiscord = transports.some(t => t.includes('Discord'));

  if (state.enableWeb) {
    const port = await ask('Web UI port?', String(state.webPort));
    state.webPort = parseInt(port) || 3000;
  }

  if (state.enableTelegram) {
    console.log('\n  To set up Telegram:');
    console.log('  1. Message @BotFather on Telegram');
    console.log('  2. Send /newbot and follow the prompts');
    console.log('  3. Copy the bot token and add it to your .env file');
    console.log('     TELEGRAM_BOT_TOKEN=your-token-here\n');
  }

  if (state.enableDiscord) {
    console.log('\n  To set up Discord:');
    console.log('  1. Go to https://discord.com/developers/applications');
    console.log('  2. Create a new application → Bot tab → copy token');
    console.log('  3. Add it to your .env file');
    console.log('     DISCORD_BOT_TOKEN=your-token-here\n');
  }
}

async function wizardPersonal(state: ConfigState): Promise<void> {
  console.log('\n  ── About You ──');
  console.log('  (This helps your agent be useful from day one. All optional.)\n');

  state.userName = await ask('Your name');
  const location = await ask('Where are you based? (city/country)');
  state.timezone = await ask('Timezone', state.timezone);
  const role = await ask('What do you do? (job title / company)');
  const interests = await ask('Key interests or hobbies (comma-separated)');
  const extras = await ask('Anything else the agent should know? (one line)');

  state.contextParts = [];
  if (state.userName) state.contextParts.push(`The user's name is ${state.userName}.`);
  if (location) state.contextParts.push(`Based in ${location}.`);
  if (role) state.contextParts.push(`Works as ${role}.`);
  if (interests) state.contextParts.push(`Interests: ${interests}.`);
  if (extras) state.contextParts.push(extras);
}

// ── Config generation ────────────────────────────────────────────

function generateConfig(state: ConfigState): string {
  let fullPersonality = state.personality;

  if (state.contextParts.length > 0) {
    fullPersonality += '\n\n' + state.contextParts.join(' ');
  }

  fullPersonality += `\n\nWhen you receive a complex request, consider whether it needs background work. If so, create a task, tell the user you'll work on it, and message them back when done. Don't make the user wait for things that take time — work autonomously.`;

  let config: string;

  if (state.cloudProvider === 'copilot') {
    config = `[identity]
name = "${state.agentName}"
personality = """
${fullPersonality}
"""

# ── LLM Configuration ──────────────────────────────────────────────
# Cloud model — via GitHub Copilot (OAuth-authenticated)
[llm]
provider = "copilot"
model = "${state.copilotModel}"
api_key_env = ""
max_tokens = 8192
temperature = 0.7

[llm.copilot]
model = "${state.copilotModel}"

# Local model — used for simple chat, quick lookups, single-tool tasks
# Runs via Ollama. If Ollama isn't running, Sigil falls back to cloud-only.
[llm.local]
provider = "ollama"
model = "${state.localModel}"
base_url = "${state.ollamaUrl || 'http://localhost:11434'}"
`;
  } else {
    config = `[identity]
name = "${state.agentName}"
personality = """
${fullPersonality}
"""

# ── LLM Configuration ──────────────────────────────────────────────
# Cloud model — used for complex tasks, long context, multi-tool work
[llm]
provider = "anthropic"
model = "${state.modelString}"
api_key_env = "ANTHROPIC_API_KEY"
max_tokens = 8192
temperature = 0.7

# Local model — used for simple chat, quick lookups, single-tool tasks
# Runs via Ollama. If Ollama isn't running, Sigil falls back to cloud-only.
[llm.local]
provider = "ollama"
model = "${state.localModel}"
base_url = "${state.ollamaUrl || 'http://localhost:11434'}"
`;
  }

  config += `
# ── Routing ─────────────────────────────────────────────────────────
[routing]
strategy = "${state.strategy}"
local_tool_limit = 4
cloud_only_tools = ["browser", "code_exec"]
escalation_patterns = [
  "write a report",
  "analyse this",
  "analyze this",
  "in detail",
  "comprehensive",
  "step by step",
  "refactor",
  "architect",
  "design system",
]

# ── Memory ──────────────────────────────────────────────────────────
[memory]
db_path = "./data/memory.db"
max_recall = 10

# ── Transports ──────────────────────────────────────────────────────
[transports.tui]
enabled = true

[transports.web]
enabled = ${state.enableWeb}
port = ${state.webPort}
host = "127.0.0.1"

[transports.telegram]
enabled = ${state.enableTelegram}
${state.enableTelegram ? 'token_env = "TELEGRAM_BOT_TOKEN"' : '# token_env = "TELEGRAM_BOT_TOKEN"'}

[transports.discord]
enabled = ${state.enableDiscord}
${state.enableDiscord ? 'token_env = "DISCORD_BOT_TOKEN"' : '# token_env = "DISCORD_BOT_TOKEN"'}

# ── Scheduler ───────────────────────────────────────────────────────
[scheduler]
enabled = ${state.enableTelegram || state.enableDiscord || state.enableWeb}
timezone = "${state.timezone}"

# ── Tools ───────────────────────────────────────────────────────────
[tools]
allow = ["*"]
deny = []
`;

  // Preserve updater section if it existed
  if (state.updater) {
    config += `
# ── Auto-Update ─────────────────────────────────────────────────
[updater]
auto_update = ${state.updater.auto_update ?? false}
branch = "${state.updater.branch ?? 'main'}"
check_interval_ms = ${state.updater.check_interval_ms ?? 3600000}
`;
  } else {
    config += `
# ── Auto-Update ─────────────────────────────────────────────────
[updater]
auto_update = false
branch = "main"
check_interval_ms = 3600000   # 1 hour (in milliseconds)
`;
  }

  return config;
}

// ── Main ─────────────────────────────────────────────────────────

const SECTIONS = {
  identity: 'Identity — agent name & personality',
  llm: 'LLM — cloud provider (Anthropic/Copilot), local model, routing',
  transports: 'Transports — TUI, web, Telegram, Discord',
  personal: 'About You — name, location, timezone, interests',
} as const;

type SectionKey = keyof typeof SECTIONS;

async function main() {
  console.log('\n  ╔══════════════════════════════════════╗');
  console.log('  ║      Sigil — Onboarding Wizard      ║');
  console.log('  ╚══════════════════════════════════════╝\n');

  const configPath = resolve('sigil.toml');
  const existing = loadExisting(configPath);

  let state: ConfigState;
  let sectionsToRun: SectionKey[];

  if (existing) {
    // ── Reconfigure mode ──
    console.log('  Existing configuration found.\n');
    state = stateFromExisting(existing);

    const mode = await choose('What would you like to do?', [
      'Update specific sections',
      'Start fresh (full setup from scratch)',
    ]);

    if (mode.includes('fresh')) {
      // Full setup — same as first run
      state = {
        agentName: 'Sigil', personality: '', cloudProvider: 'anthropic',
        modelString: 'claude-sonnet-4-20250514',
        hasApiKey: true, copilotModel: '',
        useLocal: true, localModel: '', ollamaUrl: 'http://localhost:11434',
        strategy: 'smart', enableWeb: false, enableTelegram: false, enableDiscord: false,
        webPort: 3000, timezone: 'Europe/London', contextParts: [], userName: '',
      };
      sectionsToRun = ['identity', 'llm', 'transports', 'personal'];
    } else {
      const sectionKeys = Object.keys(SECTIONS) as SectionKey[];
      const sectionLabels = Object.values(SECTIONS);
      const chosen = await multiChoice('Which sections do you want to update?', sectionLabels);
      sectionsToRun = chosen.map(label => {
        const idx = sectionLabels.indexOf(label as typeof sectionLabels[number]);
        return sectionKeys[idx];
      });
    }

    // Back up existing config
    const backupPath = backupConfig(configPath);
    console.log(`\n  Backed up current config to ${backupPath}`);
  } else {
    // ── First run — full setup ──
    state = {
      agentName: 'Sigil', personality: '', cloudProvider: 'anthropic',
      modelString: 'claude-sonnet-4-20250514',
      hasApiKey: true, copilotModel: '',
      useLocal: true, localModel: '', ollamaUrl: 'http://localhost:11434',
      strategy: 'smart', enableWeb: false, enableTelegram: false, enableDiscord: false,
      webPort: 3000, timezone: 'Europe/London', contextParts: [], userName: '',
    };
    sectionsToRun = ['identity', 'llm', 'transports', 'personal'];
  }

  // ── Run selected section wizards ──
  for (const section of sectionsToRun) {
    switch (section) {
      case 'identity': await wizardIdentity(state); break;
      case 'llm': await wizardLLM(state); break;
      case 'transports': await wizardTransports(state); break;
      case 'personal': await wizardPersonal(state); break;
    }
  }

  // ── Write config ──
  console.log('\n  ── Writing Configuration ──\n');

  const config = generateConfig(state);
  writeFileSync(configPath, config, 'utf-8');
  console.log(`  ✓ Wrote ${configPath}`);

  // Write personal skill if we have context (only when personal section was run)
  if (sectionsToRun.includes('personal') && state.contextParts.length > 0) {
    const skillsDir = resolve('skills');
    mkdirSync(skillsDir, { recursive: true });

    const personalSkill = `# About ${state.userName || 'the User'}

${state.contextParts.join('\n')}

## Notes
- Add more context here as you learn things
- ${state.agentName} will use this to personalise responses
`;

    const skillPath = resolve('skills', 'personal.md');
    writeFileSync(skillPath, personalSkill, 'utf-8');
    console.log(`  ✓ Wrote ${skillPath}`);
  }

  // Create data directory
  mkdirSync(resolve('data'), { recursive: true });

  // ── Summary ──
  const updatedLabel = sectionsToRun.length < 4
    ? `Updated: ${sectionsToRun.join(', ')}`
    : 'Full setup complete';

  console.log('\n  ══════════════════════════════════════');
  console.log(`  ${state.agentName} — ${updatedLabel}\n`);

  if (!state.hasApiKey && state.cloudProvider !== 'copilot') {
    console.log('  Set your API key:');
    console.log('     sigil env\n');
  }

  if (state.cloudProvider === 'copilot') {
    console.log(`  Cloud LLM: ${state.copilotModel} via GitHub Copilot`);
    console.log('  (OAuth token saved in data/copilot-token.json)\n');
  }

  if (state.useLocal && state.localModel) {
    console.log(`  Pull the local model:`);
    console.log(`     ollama pull ${state.localModel}\n`);
  }

  if (existing) {
    console.log('  Restart to apply changes:');
    console.log('     sigil restart\n');
  } else {
    console.log(`  Start ${state.agentName}:`);
    console.log('     sigil start\n');
  }

  rl.close();
}

main().catch(err => {
  console.error('Onboarding failed:', err);
  process.exit(1);
});
