/**
 * Basic Test Script
 *
 * Runs when you do `sigil test` or `npm test`.
 * Checks that the core components can be loaded and wired together.
 * Does NOT call the LLM — this is a structural health check.
 */

import chalk from 'chalk';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.then(() => {
        console.log(chalk.green(`  ✓ ${name}`));
        passed++;
      }).catch((err) => {
        console.log(chalk.red(`  ✗ ${name}: ${err}`));
        failed++;
      });
    } else {
      console.log(chalk.green(`  ✓ ${name}`));
      passed++;
    }
  } catch (err) {
    console.log(chalk.red(`  ✗ ${name}: ${err}`));
    failed++;
  }
}

async function run(): Promise<void> {
  console.log(chalk.bold('\n  Sigil Tests\n'));

  // Test: types can be imported
  test('Core types import', async () => {
    const types = await import('./types.js');
    if (!types) throw new Error('Failed to import types');
  });

  // Test: event bus works
  test('Event bus pub/sub', async () => {
    const { EventBus } = await import('./lib/event-bus.js');
    const bus = new EventBus();
    let received = false;
    bus.on('system:ready', () => { received = true; });
    bus.emit('system:ready', { timestamp: new Date() });
    if (!received) throw new Error('Event not received');
  });

  // Test: event bus once() fires only once
  test('Event bus once()', async () => {
    const { EventBus } = await import('./lib/event-bus.js');
    const bus = new EventBus();
    let count = 0;
    bus.once('system:ready', () => { count++; });
    bus.emit('system:ready', { timestamp: new Date() });
    bus.emit('system:ready', { timestamp: new Date() });
    if (count !== 1) throw new Error(`Expected 1, got ${count}`);
  });

  // Test: config loads with defaults when no file exists
  test('Config loads defaults', async () => {
    const { loadConfig } = await import('./gateway/config.js');
    const config = loadConfig();
    if (!config.identity.name) throw new Error('No identity name');
    if (!config.transports.web.port) throw new Error('No web port');
  });

  // Test: module loader reports no overrides on clean install
  test('Module loader — no local overrides', async () => {
    const { listLocalOverrides } = await import('./lib/loader.js');
    const overrides = listLocalOverrides();
    if (overrides.length !== 0) throw new Error(`Expected 0 overrides, got ${overrides.length}`);
  });

  // Test: provider factory errors on missing config
  test('Provider factory requires models', async () => {
    const { createProvider } = await import('./agent/providers/index.js');
    try {
      createProvider({
        version: '2.0.0',
        identity: { name: 'test', personality: 'test' },
        models: [],
        defaultModel: '',
        transports: {
          tui: { enabled: false },
          web: { enabled: false, port: 3033, host: '127.0.0.1' },
          telegram: { enabled: false },
        },
      });
      throw new Error('Should have thrown');
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('No models configured')) {
        throw err;
      }
    }
  });

  // Test: WebSocket server can start and stop
  test('WS server start/stop', async () => {
    const { EventBus } = await import('./lib/event-bus.js');
    const { Agent } = await import('./agent/agent.js');
    const { Gateway } = await import('./gateway/gateway.js');
    const { WSServer } = await import('./transports/ws-server.js');

    // Minimal config with a dummy provider
    const bus = new EventBus();
    const dummyProvider = {
      name: 'test',
      providerType: 'anthropic' as const,
      complete: async () => ({
        content: 'test',
        model: 'test',
        usage: { inputTokens: 0, outputTokens: 0 },
        finishReason: 'end' as const,
      }),
      isAvailable: async () => true,
    };
    const config = {
      version: '2.0.0',
      identity: { name: 'test', personality: 'test' },
      models: [],
      defaultModel: '',
      transports: {
        tui: { enabled: false },
        web: { enabled: true, port: 13033, host: '127.0.0.1' },
        telegram: { enabled: false },
      },
    };
    const agent = new Agent(dummyProvider, config, bus);
    const gateway = new Gateway(bus, agent);
    const server = new WSServer(bus, gateway, config);

    await server.start();
    await server.stop();
  });

  // Wait for async tests to complete
  await new Promise((resolve) => setTimeout(resolve, 500));

  console.log();
  console.log(chalk.bold(`  ${passed} passed, ${failed} failed\n`));
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
