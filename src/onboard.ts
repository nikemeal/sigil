/**
 * Onboarding Wizard
 *
 * One command to go from zero to running:
 *   - Collects agent name, personality, LLM provider, API key
 *   - Writes sigil.toml and .env
 *   - Builds the project
 *   - Starts the service (systemd if provisioned, direct if dev)
 *
 * Run with: sigil onboard (or npm run onboard)
 */

import { createInterface } from 'node:readline';
import { writeFileSync, existsSync, copyFileSync, appendFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import chalk from 'chalk';

const PROJECT_ROOT = process.cwd();
const CONFIG_PATH = resolve(PROJECT_ROOT, 'sigil.toml');
const ENV_PATH = resolve(PROJECT_ROOT, '.env');

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

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

/** Run a shell command, showing output */
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

/** Check if we're running under systemd (provisioned install) */
function hasSystemd(): boolean {
  try {
    execSync('systemctl list-unit-files sigil.service', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  console.log(chalk.bold('\n  Sigil Setup\n'));
  console.log(chalk.dim('  One command to configure, build, and start your agent.\n'));

  // Backup existing config if re-running
  if (existsSync(CONFIG_PATH)) {
    const backup = `${CONFIG_PATH}.backup-${Date.now()}`;
    copyFileSync(CONFIG_PATH, backup);
    console.log(chalk.dim(`  Existing config backed up to ${backup}\n`));
  }

  // ── Identity ────────────────────────────────────────────────────
  console.log(chalk.bold('Identity'));
  const name = await ask('Agent name', 'Sigil');
  const personality = await ask(
    'Personality',
    'A helpful, direct personal AI agent. Concise but thorough.'
  );

  // ── Provider ────────────────────────────────────────────────────
  console.log();
  console.log(chalk.bold('LLM Provider'));
  const providerChoice = await choose('Which LLM provider?', [
    'Anthropic (Claude)',
    'OpenAI',
    'OpenAI-compatible (Ollama, Groq, LM Studio, etc.)',
  ]);

  let modelToml = '';
  let modelName = '';
  let envLines: string[] = [];

  if (providerChoice.startsWith('Anthropic')) {
    const apiKey = await ask('Anthropic API key');
    const model = await ask('Model', 'claude-sonnet-4-20250514');
    modelName = 'claude';

    envLines.push(`ANTHROPIC_API_KEY=${apiKey}`);
    modelToml = `
[[models]]
name = "claude"
provider = "anthropic"
model = "${model}"
tier = "standard"
api_key_env = "ANTHROPIC_API_KEY"
cost_per_1k_input = 0.003
cost_per_1k_output = 0.015
use_for = ["general"]
`;
  } else if (providerChoice === 'OpenAI') {
    const apiKey = await ask('OpenAI API key');
    const model = await ask('Model', 'gpt-4o');
    modelName = 'openai';

    envLines.push(`OPENAI_API_KEY=${apiKey}`);
    modelToml = `
[[models]]
name = "openai"
provider = "openai-compatible"
base_url = "https://api.openai.com"
model = "${model}"
tier = "standard"
api_key_env = "OPENAI_API_KEY"
cost_per_1k_input = 0.005
cost_per_1k_output = 0.015
use_for = ["general"]
`;
  } else {
    const baseUrl = await ask('API base URL', 'http://localhost:11434');
    const model = await ask('Model', 'qwen3:8b');
    modelName = 'local';
    const needsKey = await ask('Requires API key? (y/n)', 'n');

    let apiKeyLine = '';
    if (needsKey.toLowerCase() === 'y') {
      const apiKey = await ask('API key');
      envLines.push(`LLM_API_KEY=${apiKey}`);
      apiKeyLine = '\napi_key_env = "LLM_API_KEY"';
    }

    modelToml = `
[[models]]
name = "local"
provider = "openai-compatible"
base_url = "${baseUrl}"
model = "${model}"
tier = "basic"${apiKeyLine}
cost_per_1k_input = 0
cost_per_1k_output = 0
use_for = ["general"]
`;
  }

  // ── Write files ─────────────────────────────────────────────────
  console.log(chalk.bold('\n  Writing configuration...'));

  // Write .env
  if (envLines.length > 0) {
    const envContent = envLines.join('\n') + '\n';
    if (existsSync(ENV_PATH)) {
      appendFileSync(ENV_PATH, envContent, 'utf-8');
    } else {
      writeFileSync(ENV_PATH, envContent, 'utf-8');
      chmodSync(ENV_PATH, 0o600);
    }
    console.log(chalk.green(`  API key saved to .env`));
  }

  // Write sigil.toml
  const toml = `# Sigil Configuration
# Generated by onboarding wizard

version = "2.0.0"

[identity]
name = "${name}"
personality = "${personality}"
${modelToml}
default_model = "${modelName}"

[transports.tui]
enabled = true

[transports.web]
enabled = true
port = 3033
host = "127.0.0.1"

[transports.telegram]
enabled = false
`;

  writeFileSync(CONFIG_PATH, toml, 'utf-8');
  console.log(chalk.green(`  Config written to sigil.toml`));

  // ── Build ───────────────────────────────────────────────────────
  run('npx tsc', 'Building');

  // ── Start ───────────────────────────────────────────────────────
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
    console.log(chalk.dim(`  Or for production: npm run build && npm start\n`));
  }

  rl.close();
}

main().catch((err) => {
  console.error('Onboarding error:', err);
  rl.close();
  process.exit(1);
});
