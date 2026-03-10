#!/usr/bin/env node

import * as readline from 'node:readline';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Interactive onboarding wizard.
 * Run with: npx tsx src/onboard.ts
 *
 * Walks through:
 * 1. Agent name & personality
 * 2. LLM setup (cloud + local)
 * 3. Transport selection + setup
 * 4. Personal context (so the agent knows you)
 * 5. Writes sigil.toml + initial skill files
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

async function main() {
  console.log('\n  ╔══════════════════════════════════════╗');
  console.log('  ║      Sigil — Onboarding Wizard      ║');
  console.log('  ╚══════════════════════════════════════╝\n');

  // ── 1. Identity ──────────────────────────────────────────────
  console.log('  ── Identity ──\n');

  const agentName = await ask('What should your agent be called?', 'Sigil');

  const personalityStyle = await choose('What personality style?', [
    'Direct & technical — gets things done, minimal chat',
    'Friendly & proactive — warm but efficient',
    'Formal & thorough — detailed, professional',
    'Custom — I\'ll write it myself',
  ]);

  let personality: string;
  if (personalityStyle.includes('Custom')) {
    personality = await ask('Write your agent personality (one paragraph)');
  } else {
    const styleMap: Record<string, string> = {
      'Direct & technical': `You are ${agentName}, a personal AI assistant. Be direct, technical, and action-oriented. Don't hedge or waffle. If you can do something with tools, just do it. Report back concisely.`,
      'Friendly & proactive': `You are ${agentName}, a personal AI assistant. Be warm and approachable but efficient. Anticipate needs, suggest helpful actions, and keep things conversational without being verbose.`,
      'Formal & thorough': `You are ${agentName}, a personal AI assistant. Be professional and thorough. Provide detailed explanations when asked, cite sources, and structure responses clearly.`,
    };
    const key = Object.keys(styleMap).find(k => personalityStyle.includes(k)) ?? 'Direct & technical';
    personality = styleMap[key];
  }

  // ── 2. LLM Setup ────────────────────────────────────────────
  console.log('\n  ── LLM Setup ──\n');

  const cloudModel = await choose('Cloud LLM (for complex tasks)?', [
    'claude-sonnet-4-20250514 (recommended — fast + capable)',
    'claude-opus-4-6 (most powerful, slower, pricier)',
  ]);
  const modelString = cloudModel.includes('opus') ? 'claude-opus-4-6' : 'claude-sonnet-4-20250514';

  const hasApiKey = await ask('Do you have an ANTHROPIC_API_KEY set? (y/n)', 'y');

  const useLocal = await ask('Set up a local LLM via Ollama? (y/n)', 'y');
  let localModel = '';
  let ollamaUrl = '';

  if (useLocal.toLowerCase() === 'y') {
    ollamaUrl = await ask('Ollama URL', 'http://localhost:11434');
    localModel = await choose('Local model?', [
      'qwen3:8b (best all-rounder for 8GB)',
      'qwen3:14b (near GPT-4, needs 16GB)',
      'llama3.3:8b (strong general + coding)',
      'mistral:7b (fast, good for chat)',
      'Custom model name',
    ]);

    if (localModel.includes('Custom')) {
      localModel = await ask('Model name (as used with ollama pull)');
    } else {
      localModel = localModel.split(' ')[0]; // Extract model name before description
    }

    console.log(`\n  Make sure to run: ollama pull ${localModel}`);
  }

  const routingStrategy = await choose('How should requests be routed?', [
    'smart — auto-decide per request (recommended)',
    'local_first — prefer local, fall back to cloud',
    'local_only — fully offline, no cloud calls',
    'cloud_only — always use cloud',
  ]);
  const strategy = routingStrategy.split(' ')[0];

  // ── 3. Transports ───────────────────────────────────────────
  console.log('\n  ── Transports ──\n');

  const transports = await multiChoice('How will you talk to your agent?', [
    'Terminal (TUI) — always on',
    'Web UI',
    'Telegram',
    'Discord',
  ]);

  const enableWeb = transports.some(t => t.includes('Web'));
  const enableTelegram = transports.some(t => t.includes('Telegram'));
  const enableDiscord = transports.some(t => t.includes('Discord'));

  let webPort = 3000;
  let telegramNote = '';
  let discordNote = '';

  if (enableWeb) {
    const port = await ask('Web UI port?', '3000');
    webPort = parseInt(port) || 3000;
  }

  if (enableTelegram) {
    console.log('\n  To set up Telegram:');
    console.log('  1. Message @BotFather on Telegram');
    console.log('  2. Send /newbot and follow the prompts');
    console.log('  3. Copy the bot token');
    const token = await ask('Telegram bot token (or press Enter to set later)');
    if (token) {
      telegramNote = `\n  Set TELEGRAM_BOT_TOKEN="${token}" in your environment.`;
    } else {
      telegramNote = '\n  Set TELEGRAM_BOT_TOKEN in your environment when ready.';
    }
    console.log(telegramNote);
  }

  if (enableDiscord) {
    console.log('\n  To set up Discord:');
    console.log('  1. Go to https://discord.com/developers/applications');
    console.log('  2. Create a new application → Bot tab → copy token');
    console.log('  3. Under OAuth2 → URL Generator, select "bot" scope');
    const token = await ask('Discord bot token (or press Enter to set later)');
    if (token) {
      discordNote = `\n  Set DISCORD_BOT_TOKEN="${token}" in your environment.`;
    } else {
      discordNote = '\n  Set DISCORD_BOT_TOKEN in your environment when ready.';
    }
    console.log(discordNote);
  }

  // ── 4. Personal context ─────────────────────────────────────
  console.log('\n  ── About You ──');
  console.log('  (This helps your agent be useful from day one. All optional.)\n');

  const userName = await ask('Your name');
  const location = await ask('Where are you based? (city/country)');
  const timezone = await ask('Timezone', 'Europe/London');
  const role = await ask('What do you do? (job title / company)');
  const interests = await ask('Key interests or hobbies (comma-separated)');
  const extras = await ask('Anything else the agent should know? (one line)');

  // ── 5. Write config ─────────────────────────────────────────
  console.log('\n  ── Writing Configuration ──\n');

  // Build personality with personal context
  let fullPersonality = personality;
  const contextParts: string[] = [];
  if (userName) contextParts.push(`The user's name is ${userName}.`);
  if (location) contextParts.push(`Based in ${location}.`);
  if (role) contextParts.push(`Works as ${role}.`);
  if (interests) contextParts.push(`Interests: ${interests}.`);
  if (extras) contextParts.push(extras);

  if (contextParts.length > 0) {
    fullPersonality += '\n\n' + contextParts.join(' ');
  }

  fullPersonality += `\n\nWhen you receive a complex request, consider whether it needs background work. If so, create a task, tell the user you'll work on it, and message them back when done. Don't make the user wait for things that take time — work autonomously.`;

  // Generate TOML
  const config = `[identity]
name = "${agentName}"
personality = """
${fullPersonality}
"""

[llm]
provider = "anthropic"
model = "${modelString}"
api_key_env = "ANTHROPIC_API_KEY"
max_tokens = 8192
temperature = 0.7
${useLocal.toLowerCase() === 'y' ? `
[llm.local]
provider = "ollama"
model = "${localModel}"
base_url = "${ollamaUrl}"
` : ''}
[routing]
strategy = "${strategy}"
local_tool_limit = 4
cloud_only_tools = ["browser", "code_exec"]
escalation_patterns = [
  "write a report", "analyse this", "analyze this",
  "in detail", "comprehensive", "step by step",
  "refactor", "architect", "design system",
]

[memory]
db_path = "./data/memory.db"
max_recall = 10

[transports.tui]
enabled = true

[transports.web]
enabled = ${enableWeb}
port = ${webPort}
host = "127.0.0.1"

[transports.telegram]
enabled = ${enableTelegram}
${enableTelegram ? 'token_env = "TELEGRAM_BOT_TOKEN"' : '# token_env = "TELEGRAM_BOT_TOKEN"'}

[transports.discord]
enabled = ${enableDiscord}
${enableDiscord ? 'token_env = "DISCORD_BOT_TOKEN"' : '# token_env = "DISCORD_BOT_TOKEN"'}

[scheduler]
enabled = true
timezone = "${timezone}"

[tools]
allow = ["*"]
deny = []
`;

  const configPath = resolve('sigil.toml');
  writeFileSync(configPath, config, 'utf-8');
  console.log(`  ✓ Wrote ${configPath}`);

  // Write initial personal skill if we have context
  if (contextParts.length > 0) {
    const skillsDir = resolve('skills');
    mkdirSync(skillsDir, { recursive: true });

    const personalSkill = `# About ${userName || 'the User'}

${contextParts.join('\n')}

## Notes
- Add more context here as you learn things
- ${agentName} will use this to personalise responses
`;

    const skillPath = resolve('skills', 'personal.md');
    writeFileSync(skillPath, personalSkill, 'utf-8');
    console.log(`  ✓ Wrote ${skillPath}`);
  }

  // Create data directory
  mkdirSync(resolve('data'), { recursive: true });
  console.log('  ✓ Created data directory');

  // ── Summary ─────────────────────────────────────────────────
  console.log('\n  ══════════════════════════════════════');
  console.log(`  ${agentName} is ready to go!\n`);
  console.log('  Next steps:');

  if (hasApiKey.toLowerCase() !== 'y') {
    console.log('  1. Set your API key:');
    console.log('     export ANTHROPIC_API_KEY="sk-ant-..."');
  }

  if (useLocal.toLowerCase() === 'y') {
    console.log(`  ${hasApiKey.toLowerCase() !== 'y' ? '2' : '1'}. Pull the local model:`);
    console.log(`     ollama pull ${localModel}`);
  }

  console.log(`\n  Start ${agentName}:`);
  console.log('     npm run dev\n');

  if (telegramNote) console.log(telegramNote);
  if (discordNote) console.log(discordNote);

  console.log('');
  rl.close();
}

main().catch(err => {
  console.error('Onboarding failed:', err);
  process.exit(1);
});
