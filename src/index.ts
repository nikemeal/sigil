/**
 * Sigil Entry Point
 *
 * Wires everything together and starts the service.
 * This is what runs when you do `sigil start` or `npm start`.
 *
 * Module 1: config → provider → agent → gateway → WS server
 * Future modules add more components here (memory, tools, scheduler, etc.)
 */

import { loadEnv } from './lib/env.js';
import { loadConfig } from './gateway/config.js';
import { EventBus } from './lib/event-bus.js';
import { Agent } from './agent/agent.js';
import { Gateway } from './gateway/gateway.js';
import { WSServer } from './transports/ws-server.js';
import { createProvider } from './agent/providers/index.js';

async function main(): Promise<void> {
  console.log('[Sigil] Starting...');

  // Load .env before anything else (API keys, etc.)
  loadEnv();

  // Load configuration
  const config = loadConfig();
  console.log(`[Sigil] Identity: ${config.identity.name}`);

  // Create event bus — the backbone of all communication
  const bus = new EventBus();

  // Create LLM provider from config
  const provider = createProvider(config);
  console.log(`[Sigil] LLM provider: ${provider.name} (${config.defaultModel})`);

  // Create agent — processes messages via the LLM
  const agent = new Agent(provider, config, bus);

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
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[Sigil] Fatal error:', err);
  process.exit(1);
});
