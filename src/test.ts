/**
 * Sigil Test Suite
 *
 * Runs when you do `sigil test` or `npm test`.
 * Tests core functionality without calling the LLM.
 * Uses an in-memory SQLite database so tests don't affect real data.
 */

import chalk from 'chalk';
import Database from 'better-sqlite3';

// ── Test runner ───────────────────────────────────────────────────────

const results: Array<{ name: string; passed: boolean; error?: string }> = [];

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(chalk.green(`  ✓ ${name}`));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, error: message });
    console.log(chalk.red(`  ✗ ${name}`));
    console.log(chalk.dim(`    ${message}`));
  }
}

// ── Tests ─────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log(chalk.bold('\n  Sigil Tests\n'));

  // ── Module 1: Core ────────────────────────────────────────────────

  console.log(chalk.dim('  Module 1: Core'));

  await test('Core types import', async () => {
    const types = await import('./types.js');
    if (!types) throw new Error('Failed to import types');
  });

  await test('Event bus pub/sub', async () => {
    const { EventBus } = await import('./lib/event-bus.js');
    const bus = new EventBus();
    let received = false;
    bus.on('system:ready', () => { received = true; });
    bus.emit('system:ready', { timestamp: new Date() });
    if (!received) throw new Error('Event not received');
  });

  await test('Event bus once() fires only once', async () => {
    const { EventBus } = await import('./lib/event-bus.js');
    const bus = new EventBus();
    let count = 0;
    bus.once('system:ready', () => { count++; });
    bus.emit('system:ready', { timestamp: new Date() });
    bus.emit('system:ready', { timestamp: new Date() });
    if (count !== 1) throw new Error(`Expected 1, got ${count}`);
  });

  await test('Event bus unsubscribe', async () => {
    const { EventBus } = await import('./lib/event-bus.js');
    const bus = new EventBus();
    let count = 0;
    const unsub = bus.on('system:ready', () => { count++; });
    bus.emit('system:ready', { timestamp: new Date() });
    unsub();
    bus.emit('system:ready', { timestamp: new Date() });
    if (count !== 1) throw new Error(`Expected 1, got ${count}`);
  });

  await test('Config loads defaults when no file exists', async () => {
    const { loadConfig } = await import('./gateway/config.js');
    const config = loadConfig();
    if (!config.identity.name) throw new Error('No identity name');
    if (!config.transports.web.port) throw new Error('No web port');
    if (!config.memory.dbPath) throw new Error('No memory dbPath');
  });

  await test('Module loader reports no local overrides', async () => {
    const { listLocalOverrides } = await import('./lib/loader.js');
    const overrides = listLocalOverrides();
    if (overrides.length !== 0) throw new Error(`Expected 0 overrides, got ${overrides.length}`);
  });

  await test('Provider factory requires models', async () => {
    const { createProvider } = await import('./agent/providers/index.js');
    try {
      createProvider({
        version: '2.0.0',
        identity: { name: 'test', personality: 'test' },
        models: [],
        defaultModel: '',
        memory: { dbPath: 'data/sigil.db', maxRecallResults: 5 },
        transports: {
          tui: { enabled: false },
          web: { enabled: false, port: 3033, host: '127.0.0.1' },
          telegram: { enabled: false },
        },
      });
      throw new Error('Should have thrown');
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('No models configured')) throw err;
    }
  });

  await test('WS server start/stop', async () => {
    const { EventBus } = await import('./lib/event-bus.js');
    const { Agent } = await import('./agent/agent.js');
    const { Gateway } = await import('./gateway/gateway.js');
    const { WSServer } = await import('./transports/ws-server.js');

    const bus = new EventBus();
    const dummyProvider = {
      name: 'test', providerType: 'anthropic' as const,
      complete: async () => ({
        content: 'test', model: 'test',
        usage: { inputTokens: 0, outputTokens: 0 },
        finishReason: 'end' as const,
      }),
      isAvailable: async () => true,
    };
    const config = {
      version: '2.0.0',
      identity: { name: 'test', personality: 'test' },
      models: [], defaultModel: '',
      memory: { dbPath: 'data/sigil.db', maxRecallResults: 5 },
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

  // ── Module 2: Memory ──────────────────────────────────────────────

  console.log(chalk.dim('\n  Module 2: Memory'));

  await test('SQLite database initialises with tables', async () => {
    const { getDatabase, closeDatabase } = await import('./context/db.js');
    const db = getDatabase(':memory:');
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);
    if (!tableNames.includes('messages')) throw new Error('Missing messages table');
    if (!tableNames.includes('memories')) throw new Error('Missing memories table');
    if (!tableNames.includes('embeddings')) throw new Error('Missing embeddings table');
    if (!tableNames.includes('summaries')) throw new Error('Missing summaries table');
    closeDatabase();
  });

  await test('Memory store: store and keyword search', async () => {
    const db = new Database(':memory:');
    // Run migrations manually for isolated test
    db.exec(`
      CREATE TABLE memories (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL DEFAULT 'fact', content TEXT NOT NULL, tags TEXT, relevance REAL NOT NULL DEFAULT 1.0, access_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_accessed TEXT NOT NULL);
      CREATE VIRTUAL TABLE memories_fts USING fts5(content, tags, content='memories', content_rowid='id');
      CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags); END;
      CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags); END;
      CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags); INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags); END;
      CREATE TABLE embeddings (memory_id INTEGER PRIMARY KEY, vector BLOB NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL);
    `);

    const { MemoryStore } = await import('./context/memory.js');
    const store = new MemoryStore(db);

    store.store('User birthday is May 15th', 'fact', ['birthday']);
    store.store('User prefers dark mode', 'preference', ['ui']);
    store.store('User works at Acme Corp', 'fact', ['work']);

    const results = store.searchByKeyword('birthday');
    if (results.length === 0) throw new Error('No results for "birthday"');
    if (!results[0].memory.content.includes('May 15th')) throw new Error('Wrong memory returned');

    const workResults = store.searchByKeyword('Acme');
    if (workResults.length === 0) throw new Error('No results for "Acme"');

    db.close();
  });

  await test('Memory store: combined search deduplicates', async () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE memories (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL DEFAULT 'fact', content TEXT NOT NULL, tags TEXT, relevance REAL NOT NULL DEFAULT 1.0, access_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_accessed TEXT NOT NULL);
      CREATE VIRTUAL TABLE memories_fts USING fts5(content, tags, content='memories', content_rowid='id');
      CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags); END;
      CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags); END;
      CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags); INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags); END;
      CREATE TABLE embeddings (memory_id INTEGER PRIMARY KEY, vector BLOB NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL);
    `);

    const { MemoryStore } = await import('./context/memory.js');
    const store = new MemoryStore(db);

    store.store('The sky is blue', 'fact');
    store.store('Water is wet', 'fact');

    // Combined search with no vector — should still return FTS results
    const results = store.search('sky blue', null, 5);
    if (results.length === 0) throw new Error('No results from combined search');

    db.close();
  });

  await test('Conversation store: add and retrieve messages', async () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, source TEXT, timestamp TEXT NOT NULL, token_count INTEGER);
      CREATE TABLE summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, message_range_start TEXT NOT NULL, message_range_end TEXT NOT NULL, created_at TEXT NOT NULL);
    `);

    const { ConversationStore } = await import('./context/conversation.js');
    const store = new ConversationStore(db);

    store.addMessage('msg-1', 'user', 'Hello', 'tui');
    store.addMessage('msg-2', 'assistant', 'Hi there!');
    store.addMessage('msg-3', 'user', 'How are you?', 'tui');

    const recent = store.getRecent(10);
    if (recent.length !== 3) throw new Error(`Expected 3 messages, got ${recent.length}`);
    if (recent[0].content !== 'Hello') throw new Error('Wrong message order');
    if (recent[2].content !== 'How are you?') throw new Error('Wrong last message');

    db.close();
  });

  await test('Conversation store: message count', async () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, source TEXT, timestamp TEXT NOT NULL, token_count INTEGER);
      CREATE TABLE summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, message_range_start TEXT NOT NULL, message_range_end TEXT NOT NULL, created_at TEXT NOT NULL);
    `);

    const { ConversationStore } = await import('./context/conversation.js');
    const store = new ConversationStore(db);

    if (store.getMessageCount() !== 0) throw new Error('Expected 0 messages');
    store.addMessage('msg-1', 'user', 'Hello');
    store.addMessage('msg-2', 'assistant', 'Hi');
    if (store.getMessageCount() !== 2) throw new Error('Expected 2 messages');

    db.close();
  });

  await test('Living profile: create and read', async () => {
    const { Profile } = await import('./context/profile.js');
    const testPath = '/tmp/sigil-test-profile.md';
    const profile = new Profile(testPath);

    const content = profile.get();
    if (!content.includes('User Profile')) throw new Error('Profile missing default content');

    profile.update('# Test Profile\n\nName: Mike');
    if (!profile.get().includes('Mike')) throw new Error('Profile update failed');

    // Cleanup
    const { unlinkSync } = await import('node:fs');
    try { unlinkSync(testPath); } catch {}
  });

  await test('Memory store: vector storage and retrieval', async () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE memories (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL DEFAULT 'fact', content TEXT NOT NULL, tags TEXT, relevance REAL NOT NULL DEFAULT 1.0, access_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_accessed TEXT NOT NULL);
      CREATE VIRTUAL TABLE memories_fts USING fts5(content, tags, content='memories', content_rowid='id');
      CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags); END;
      CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags); END;
      CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags); INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags); END;
      CREATE TABLE embeddings (memory_id INTEGER PRIMARY KEY, vector BLOB NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL);
    `);

    const { MemoryStore } = await import('./context/memory.js');
    const store = new MemoryStore(db);

    const id = store.store('Cats are great pets', 'fact');
    // Store a fake embedding
    store.storeEmbedding(id, [0.1, 0.2, 0.3, 0.4], 'test-model');

    // Search by vector (similar direction)
    const results = store.searchByVector([0.1, 0.2, 0.3, 0.4], 5);
    if (results.length === 0) throw new Error('No vector results');
    if (!results[0].memory.content.includes('Cats')) throw new Error('Wrong memory from vector search');

    db.close();
  });

  await test('Context engine builds messages with history', async () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, source TEXT, timestamp TEXT NOT NULL, token_count INTEGER);
      CREATE TABLE summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, message_range_start TEXT NOT NULL, message_range_end TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE memories (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL DEFAULT 'fact', content TEXT NOT NULL, tags TEXT, relevance REAL NOT NULL DEFAULT 1.0, access_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_accessed TEXT NOT NULL);
      CREATE VIRTUAL TABLE memories_fts USING fts5(content, tags, content='memories', content_rowid='id');
      CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags); END;
      CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags); END;
      CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags); INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags); END;
      CREATE TABLE embeddings (memory_id INTEGER PRIMARY KEY, vector BLOB NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL);
    `);

    const { MemoryStore } = await import('./context/memory.js');
    const { ConversationStore } = await import('./context/conversation.js');
    const { Profile } = await import('./context/profile.js');
    const { ContextEngine } = await import('./context/engine.js');

    const memories = new MemoryStore(db);
    const conversation = new ConversationStore(db);
    const profile = new Profile('/tmp/sigil-test-profile-ctx.md');

    const config = {
      version: '2.0.0',
      identity: { name: 'Sigil', personality: 'Helpful agent.' },
      models: [], defaultModel: '',
      memory: { dbPath: ':memory:', maxRecallResults: 5 },
      transports: { tui: { enabled: false }, web: { enabled: false, port: 3033, host: '127.0.0.1' }, telegram: { enabled: false } },
    };

    const engine = new ContextEngine(config, memories, conversation, profile, null);

    // Add some conversation history
    conversation.addMessage('m1', 'user', 'My name is Mike');
    conversation.addMessage('m2', 'assistant', 'Nice to meet you Mike!');

    // Store a memory
    memories.store('User name is Mike', 'fact', ['name']);

    // Build context for a new message
    const message = { id: 'test', content: 'What is my name?', source: 'tui' as const, timestamp: new Date() };
    const llmMessages = await engine.buildContext(message);

    // Should have: system prompt, history (2 msgs), current message
    if (llmMessages.length < 4) throw new Error(`Expected at least 4 messages, got ${llmMessages.length}`);

    // System prompt should include identity
    if (!llmMessages[0].content.includes('Sigil')) throw new Error('System prompt missing identity');

    // Should include the memory about Mike's name
    if (!llmMessages[0].content.includes('Mike')) throw new Error('System prompt missing recalled memory');

    // Last message should be the current one
    const last = llmMessages[llmMessages.length - 1];
    if (last.content !== 'What is my name?') throw new Error('Current message not at end');

    // Cleanup
    const { unlinkSync } = await import('node:fs');
    try { unlinkSync('/tmp/sigil-test-profile-ctx.md'); } catch {}
    db.close();
  });

  // ── Summary ───────────────────────────────────────────────────────

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log();
  console.log(chalk.bold(`  ${passed} passed, ${failed} failed\n`));
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
