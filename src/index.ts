/**
 * Sigil Entry Point
 *
 * Wires everything together and starts the service.
 * This is what runs when you do `sigil start` or `npm start`.
 *
 * config → db → provider → context engine → agent → gateway → WS server
 */

import { resolve } from 'node:path';
import { loadEnv } from './lib/env.js';
import { loadConfig } from './gateway/config.js';
import { EventBus } from './lib/event-bus.js';
import { Agent } from './agent/agent.js';
import { Gateway } from './gateway/gateway.js';
import { WSServer } from './transports/ws-server.js';
import { createProvider } from './agent/providers/index.js';
import { getDatabase, closeDatabase } from './context/db.js';
import { MemoryStore } from './context/memory.js';
import { ConversationStore } from './context/conversation.js';
import { Profile } from './context/profile.js';
import { ContextEngine } from './context/engine.js';
import { createEmbeddingProvider } from './context/embeddings.js';

async function main(): Promise<void> {
  console.log('[Sigil] Starting...');

  // Load .env before anything else (API keys, etc.)
  loadEnv();

  // Load configuration
  const config = loadConfig();
  console.log(`[Sigil] Identity: ${config.identity.name}`);

  // Create event bus — the backbone of all communication
  const bus = new EventBus();

  // Initialise database
  const dbPath = resolve(process.cwd(), config.memory.dbPath);
  const db = getDatabase(dbPath);
  console.log(`[Sigil] Database: ${config.memory.dbPath}`);

  // Create memory components
  const memories = new MemoryStore(db);
  const conversation = new ConversationStore(db);
  const profile = new Profile(resolve(process.cwd(), 'data/profile.md'));
  const embeddings = createEmbeddingProvider(config.memory, config.models);

  if (embeddings) {
    console.log(`[Sigil] Embeddings: ${config.memory.embeddingModel}`);
  }

  // Create context engine — assembles the LLM's working memory
  const context = new ContextEngine(config, memories, conversation, profile, embeddings);

  // Create LLM provider from config
  const provider = createProvider(config);
  console.log(`[Sigil] LLM provider: ${provider.name} (${config.defaultModel})`);

  // Create agent and attach context
  const agent = new Agent(provider, config, bus);
  agent.setContext(context);

  // Create gateway — routes messages between transports and agent
  const gateway = new Gateway(bus, agent);

  // Start WebSocket server
  const wsServer = new WSServer(bus, gateway, config);
  await wsServer.start();

  // Signal that the system is ready
  bus.emit('system:ready', { timestamp: new Date() });
  console.log('[Sigil] Ready.');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[Sigil] Received ${signal}, shutting down...`);
    bus.emit('system:shutdown', { reason: signal });
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
