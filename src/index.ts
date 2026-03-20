/**
 * Sigil Entry Point
 *
 * Wires everything together and starts the service.
 * This is what runs when you do `sigil start` or `npm start`.
 *
 * config → db → providers → context → tools → agent → gateway → transports
 */

// Suppress Node 22 punycode deprecation from grammy dependency
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning' && warning.message.includes('punycode')) return;
  console.warn(warning);
});

import { resolve } from 'node:path';
import { loadEnv } from './lib/env.js';
import { loadConfig } from './gateway/config.js';
import { EventBus } from './lib/event-bus.js';
import { Agent } from './agent/agent.js';
import { Gateway } from './gateway/gateway.js';
import { WSServer } from './transports/ws-server.js';
import { getDatabase, closeDatabase } from './context/db.js';
import { MemoryStore } from './context/memory.js';
import { ConversationStore } from './context/conversation.js';
import { Profile } from './context/profile.js';
import { ContextEngine } from './context/engine.js';
import { createEmbeddingProvider } from './context/embeddings.js';
import { TelegramTransport } from './transports/telegram.js';
import { ToolRegistry } from './tools/registry.js';
import { shellExecTool } from './tools/shell.js';
import { fileReadTool, fileWriteTool, listDirTool } from './tools/file-ops.js';
import { createMemoryTools } from './tools/memory-tools.js';
import { ProviderPool } from './router/provider-pool.js';
import { CostTracker } from './router/cost-tracker.js';
import { TaskStore } from './tasks/store.js';
import { Planner } from './tasks/planner.js';
import { TaskRunner } from './tasks/runner.js';
import { Scheduler } from './tasks/scheduler.js';

async function main(): Promise<void> {
  console.log('[Sigil] Starting...');

  // Load .env before anything else (API keys, etc.)
  loadEnv();

  // Load configuration
  const config = loadConfig();
  console.log(`[Sigil] Identity: ${config.identity.name}`);

  // Create event bus
  const bus = new EventBus();

  // Initialise database
  const dbPath = resolve(process.cwd(), config.memory.dbPath);
  const db = getDatabase(dbPath);
  console.log(`[Sigil] Database: ${config.memory.dbPath}`);

  // Create provider pool (one provider per configured model)
  const pool = new ProviderPool(config);
  console.log(`[Sigil] Models: ${pool.getModelNames().join(', ') || 'none'}`);

  // Create memory components
  const memories = new MemoryStore(db);
  const conversation = new ConversationStore(db);
  const profile = new Profile(resolve(process.cwd(), 'data/profile.md'));
  const embeddings = createEmbeddingProvider(config.memory, config.models);

  if (embeddings) {
    console.log(`[Sigil] Embeddings: ${config.memory.embeddingModel}`);
  }

  // Create context engine
  const context = new ContextEngine(config, memories, conversation, profile, embeddings);

  // Create cost tracker
  const costTracker = new CostTracker(db);

  // Create tool registry
  const tools = new ToolRegistry(bus);
  tools.register(shellExecTool);
  tools.register(fileReadTool);
  tools.register(fileWriteTool);
  tools.register(listDirTool);
  for (const tool of createMemoryTools(context)) {
    tools.register(tool);
  }

  // Create agent with provider pool and router
  const agent = new Agent(config, bus, pool);
  agent.setContext(context);
  agent.setTools(tools);
  agent.setCostTracker(costTracker);

  // Create gateway
  const gateway = new Gateway(bus, agent);

  // Create background task system (module 6)
  const taskStore = new TaskStore(db);
  const planner = new Planner(config, pool);
  const taskRunner = new TaskRunner(bus, pool, context, tools, costTracker, taskStore, planner, config);
  const scheduler = new Scheduler(bus, taskRunner, taskStore);
  gateway.setTaskComponents(taskStore, scheduler);
  scheduler.start();

  // Record background task results in conversation history
  bus.on('task:complete', ({ taskId, result }) => {
    context.recordMessage(taskId, 'assistant', result);
  });

  // Start WebSocket server
  const wsServer = new WSServer(bus, gateway, config);
  await wsServer.start();

  // Start Telegram bot if configured
  let telegramTransport: TelegramTransport | null = null;
  if (config.transports.telegram.enabled) {
    const botTokenEnv = config.transports.telegram.botTokenEnv ?? 'TELEGRAM_BOT_TOKEN';
    const botToken = process.env[botTokenEnv];

    if (botToken) {
      telegramTransport = new TelegramTransport(bus, gateway, config, botToken);
      await telegramTransport.start();
    } else {
      console.warn(`[Sigil] Telegram enabled but ${botTokenEnv} not set in environment.`);
    }
  }

  // Signal ready
  bus.emit('system:ready', { timestamp: new Date() });
  console.log('[Sigil] Ready.');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[Sigil] Received ${signal}, shutting down...`);
    bus.emit('system:shutdown', { reason: signal });
    scheduler.stop();
    if (telegramTransport) await telegramTransport.stop();
    await wsServer.stop();
    closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[Sigil] Fatal error:', err);
  process.exit(1);
});
