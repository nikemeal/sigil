import { loadConfig } from './gateway/config.js';
import { Gateway } from './gateway/gateway.js';
import { Agent } from './agent/agent.js';
import { AnthropicProvider } from './agent/providers/anthropic.js';
import { OllamaProvider } from './agent/providers/ollama.js';
import { CopilotProvider } from './agent/providers/copilot.js';
import { CopilotAuth } from './agent/providers/copilot-auth.js';
import { createRouter } from './agent/providers/router.js';
import { ContextEngine } from './context/engine.js';
import { ToolRegistry } from './tools/registry.js';
import { createShellTool } from './tools/shell.js';
import { createFileReadTool, createFileWriteTool, createListDirTool } from './tools/file-ops.js';
import { createMemoryTools } from './tools/memory.js';
import { TaskStore } from './tasks/store.js';
import { TaskRunner } from './tasks/runner.js';
import { createTaskTools } from './tasks/tools.js';
import { Scheduler } from './scheduler/scheduler.js';
import { SkillLoader, createSkillManagementTool } from './skills/loader.js';
import { SelfExtender } from './skills/self-extend.js';
import { LearningStore, createLearningTools } from './skills/learning.js';
import { startTUI } from './transports/tui/index.js';
import { startTelegram } from './transports/telegram.js';
import { startWSServer } from './transports/ws-server.js';
import {
  HealthMonitor, createHealthTool,
  ollamaCheck, anthropicCheck, telegramCheck, systemCheck, databaseCheck,
} from './health/monitor.js';
import { Updater, createUpdateTools } from './updater/updater.js';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { LLMProvider, Transport } from './gateway/types.js';

async function main() {
  // 1. Load config
  const config = loadConfig();
  console.log(`[sigil] Starting ${config.identity.name}...`);

  // 2. Open shared database
  const dbPath = resolve(config.memory.dbPath);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // 3. Set up core systems
  const context = new ContextEngine(config);

  // Create health monitor early so buildLLM can register LLM checks
  // notify is defined later, so we use a late-bound reference
  let notifyFn: ((transport: Transport, threadId: string | undefined, message: string) => Promise<void>) | null = null;

  const health = new HealthMonitor((report) => {
    const downComponents = report.components
      .filter(c => c.status === 'down')
      .map(c => `${c.component}: ${c.message}`);
    if (downComponents.length > 0 && notifyFn) {
      notifyFn('telegram', undefined, `⚠ Health alert:\n${downComponents.join('\n')}`);
    }
  });

  const { provider: llm, copilotAuth } = await buildLLM(config, health, () => {
    // Late-bound: called when the Copilot OAuth token becomes invalid
    notifyFn?.('telegram', undefined,
      '⚠ GitHub Copilot OAuth token expired. Please re-authenticate (run onboarding wizard).');
  });

  // Register Copilot health check if active
  if (copilotAuth) {
    health.register('copilot', async () => {
      const start = Date.now();
      const session = await copilotAuth.getSessionToken();
      const latency = Date.now() - start;

      if (!session) {
        return {
          component: 'copilot',
          status: 'down' as const,
          message: 'No valid session token',
          latencyMs: latency,
          lastChecked: new Date(),
        };
      }

      const now = Math.floor(Date.now() / 1000);
      const remaining = session.expiresAt - now;

      if (remaining < 300) {
        return {
          component: 'copilot',
          status: 'degraded' as const,
          message: `Session token expires in ${remaining}s`,
          latencyMs: latency,
          lastChecked: new Date(),
        };
      }

      return {
        component: 'copilot',
        status: 'healthy' as const,
        message: `Authenticated (${latency}ms, token expires in ${Math.floor(remaining / 60)}min)`,
        latencyMs: latency,
        lastChecked: new Date(),
      };
    });
  }

  // 4. Set up skills (hot-reloadable)
  const skills = new SkillLoader('./skills');

  // 5. Register tools
  const tools = new ToolRegistry();

  tools.register(createShellTool());
  tools.register(createFileReadTool());
  tools.register(createFileWriteTool());
  tools.register(createListDirTool());

  for (const memTool of createMemoryTools(context)) {
    tools.register(memTool);
  }

  tools.register(createSkillManagementTool(skills));

  // Self-extension — lets Sigil create new tools at runtime
  const selfExtender = new SelfExtender(tools);
  for (const extTool of selfExtender.getTools()) {
    tools.register(extTool);
  }
  await selfExtender.loadExistingTools();

  // Learning system — techniques and self-evaluation
  const learningStore = new LearningStore(db);
  for (const learnTool of createLearningTools(learningStore)) {
    tools.register(learnTool);
  }

  // Start skill loader (with hot-reload watcher)
  skills.start((tool) => tools.register(tool));

  // 6. Set up task system
  const taskStore = new TaskStore(db);

  // Gateway needs to exist before TaskRunner (for the notify callback)
  const gateway = new Gateway();

  // Notify function — broadcasts to ALL active transports
  const notify = async (_transport: Transport, _threadId: string | undefined, message: string) => {
    const response = {
      id: `notify_${Date.now()}`,
      replyTo: 'task',
      content: message,
      timestamp: new Date(),
    };
    gateway.broadcast(response);
    const active = gateway.getActiveTransports();
    console.log(`[notify → ${active.join(', ')}] ${message.slice(0, 100)}...`);
  };

  // Bind the late reference so health monitor can use it
  notifyFn = notify;

  const taskRunner = new TaskRunner(llm, tools, context, taskStore, notify);

  // Register task tools
  for (const taskTool of createTaskTools(taskStore, taskRunner)) {
    tools.register(taskTool);
  }

  console.log(`[sigil] Tools: ${tools.list().join(', ')}`);

  // 7. Create agent and wire to gateway
  const agent = new Agent(llm, context, tools);
  gateway.onMessage(msg => agent.process(msg));

  // 8. Start scheduler
  if (config.scheduler.enabled) {
    const scheduler = new Scheduler(taskStore, taskRunner, config.scheduler.timezone);
    scheduler.start();
  }

  // 9. Start transports

  // WebSocket server — used by TUI client and future web UI
  if (config.transports.web.enabled) {
    await startWSServer(gateway, config.transports.web.host, config.transports.web.port);
  }

  // TUI — only in foreground/dev mode (when stdin is a terminal)
  if (config.transports.tui.enabled && process.stdin.isTTY) {
    startTUI(gateway);
  }

  let telegram: ReturnType<typeof startTelegram> = null;
  if (config.transports.telegram.enabled && config.transports.telegram.tokenEnv) {
    telegram = startTelegram(gateway, config.transports.telegram.tokenEnv);
  }

  // 10. Health monitoring — register remaining component checks
  health.register('system', systemCheck());
  health.register('database', databaseCheck(resolve(config.memory.dbPath)));

  if (config.transports.telegram.enabled) {
    health.register('telegram', telegramCheck(config.transports.telegram.tokenEnv ?? ''),
      // Heal: restart the Telegram bot
      async () => {
        try {
          telegram?.stop();
          telegram = startTelegram(gateway, config.transports.telegram.tokenEnv ?? '');
          return telegram !== null;
        } catch { return false; }
      },
    );
  }

  tools.register(createHealthTool(health));

  // Start hourly health checks
  health.startSchedule(60 * 60 * 1000);

  // 11. Auto-updater
  const updater = new Updater(
    {
      autoUpdate: config.updater.autoUpdate,
      checkIntervalMs: config.updater.checkIntervalMs,
      repoDir: process.cwd(),
      branch: config.updater.branch,
    },
    (message) => {
      // Notify about updates via Telegram (or console if no transport)
      notifyFn?.('telegram', undefined, message);
    },
  );

  for (const updateTool of createUpdateTools(updater)) {
    tools.register(updateTool);
  }

  updater.startSchedule();

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[sigil] Shutting down...');
    updater.stop();
    health.stop();
    copilotAuth?.stop();
    telegram?.stop();
    skills.stop();
    context.close();
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

interface BuildLLMResult {
  provider: LLMProvider;
  copilotAuth?: CopilotAuth;
}

async function buildLLM(
  config: ReturnType<typeof loadConfig>,
  health?: HealthMonitor,
  onCopilotTokenExpired?: () => void,
): Promise<BuildLLMResult> {
  const strategy = config.routing.strategy;

  // ── Copilot provider ───────────────────────────────────────────
  if (config.llm.provider === 'copilot') {
    const copilotModel = config.llm.copilot?.model;
    if (!copilotModel) {
      console.error('[sigil] Copilot provider selected but no model configured (llm.copilot.model).');
      process.exit(1);
    }

    const copilotAuth = new CopilotAuth('./data', onCopilotTokenExpired);

    if (!copilotAuth.isAuthenticated) {
      console.error('[sigil] Copilot provider selected but not authenticated.');
      console.error('[sigil] Run the onboarding wizard to sign in: npx tsx src/onboard.ts');
      process.exit(1);
    }

    // Verify session token works
    const session = await copilotAuth.getSessionToken();
    if (!session) {
      console.error('[sigil] Copilot: failed to obtain session token. OAuth token may be invalid.');
      console.error('[sigil] Run the onboarding wizard to re-authenticate.');
      process.exit(1);
    }

    const copilotProvider = new CopilotProvider(copilotAuth, copilotModel);
    console.log(`[sigil] Cloud LLM: ${copilotModel} via GitHub Copilot ✓`);

    // Copilot can also be paired with a local Ollama model
    let localProvider: OllamaProvider | null = null;
    let hasLocal = false;

    if (config.llm.local) {
      const ollama = new OllamaProvider(
        config.llm.local.model,
        config.llm.local.baseUrl ?? 'http://localhost:11434'
      );
      const check = await ollama.healthCheck();
      if (check.ok) {
        localProvider = ollama;
        hasLocal = true;
        console.log(`[sigil] Local LLM: ${config.llm.local.model} via Ollama ✓`);
        health?.register('ollama', ollamaCheck(ollama));
      } else {
        console.warn(`[sigil] Local LLM unavailable: ${check.error}`);
      }
    }

    if (hasLocal) {
      console.log(`[sigil] Routing strategy: ${strategy}`);
      return {
        provider: createRouter(localProvider!, copilotProvider, {
          strategy,
          localToolLimit: config.routing.localToolLimit,
          cloudOnlyTools: config.routing.cloudOnlyTools,
          cloudEscalationPatterns: config.routing.escalationPatterns,
        }),
        copilotAuth,
      };
    }

    return { provider: copilotProvider, copilotAuth };
  }

  // ── Anthropic + Ollama (existing logic) ────────────────────────
  const cloudApiKey = process.env[config.llm.apiKeyEnv];
  const hasCloud = !!cloudApiKey;

  let localProvider: OllamaProvider | null = null;
  let hasLocal = false;

  if (config.llm.local) {
    const ollama = new OllamaProvider(
      config.llm.local.model,
      config.llm.local.baseUrl ?? 'http://localhost:11434'
    );

    const check = await ollama.healthCheck();
    if (check.ok) {
      localProvider = ollama;
      hasLocal = true;
      console.log(`[sigil] Local LLM: ${config.llm.local.model} via Ollama ✓`);
      health?.register('ollama', ollamaCheck(ollama));
    } else {
      console.warn(`[sigil] Local LLM unavailable: ${check.error}`);
    }
  }

  if (hasCloud) {
    health?.register('anthropic', anthropicCheck(cloudApiKey!));
  }

  if (hasLocal && hasCloud) {
    const cloud = new AnthropicProvider(config.llm.model, cloudApiKey);
    console.log(`[sigil] Cloud LLM: ${config.llm.model} via Anthropic ✓`);
    console.log(`[sigil] Routing strategy: ${strategy}`);
    return {
      provider: createRouter(localProvider!, cloud, {
        strategy,
        localToolLimit: config.routing.localToolLimit,
        cloudOnlyTools: config.routing.cloudOnlyTools,
        cloudEscalationPatterns: config.routing.escalationPatterns,
      }),
    };
  }

  if (hasLocal) {
    console.log(`[sigil] Running in local-only mode (no API key set)`);
    return { provider: localProvider! };
  }

  if (hasCloud) {
    console.log(`[sigil] Running in cloud-only mode (no local LLM)`);
    return { provider: new AnthropicProvider(config.llm.model, cloudApiKey) };
  }

  console.error('[sigil] No LLM available. Set ANTHROPIC_API_KEY or start Ollama.');
  process.exit(1);
}

main().catch(err => {
  console.error('[sigil] Fatal error:', err);
  process.exit(1);
});
