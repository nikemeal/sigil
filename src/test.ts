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
        skills: { path: 'skills' },
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
    const { ProviderPool } = await import('./router/provider-pool.js');

    const bus = new EventBus();
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
      skills: { path: 'skills' },
    };
    const pool = new ProviderPool(config);
    const agent = new Agent(config, bus, pool);
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
      skills: { path: 'skills' },
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

  // ── Module 4: Tools ────────────────────────────────────────────────

  console.log(chalk.dim('\n  Module 4: Tools'));

  await test('Tool registry: register and list', async () => {
    const { EventBus } = await import('./lib/event-bus.js');
    const { ToolRegistry } = await import('./tools/registry.js');

    const bus = new EventBus();
    const registry = new ToolRegistry(bus);

    registry.register({
      name: 'test_tool',
      description: 'A test tool',
      parameters: { type: 'object', properties: {}, required: [] },
      approval: 'auto',
      execute: async () => 'result',
    });

    const tools = registry.list();
    if (!tools.includes('test_tool')) throw new Error('Tool not registered');
  });

  await test('Tool registry: get definitions excludes denied tools', async () => {
    const { EventBus } = await import('./lib/event-bus.js');
    const { ToolRegistry } = await import('./tools/registry.js');

    const bus = new EventBus();
    const registry = new ToolRegistry(bus);

    registry.register({
      name: 'allowed_tool',
      description: 'Allowed',
      parameters: { type: 'object', properties: {}, required: [] },
      approval: 'auto',
      execute: async () => 'ok',
    });
    registry.register({
      name: 'denied_tool',
      description: 'Denied',
      parameters: { type: 'object', properties: {}, required: [] },
      approval: 'deny',
      execute: async () => 'ok',
    });

    const defs = registry.getDefinitions();
    if (defs.length !== 1) throw new Error(`Expected 1 definition, got ${defs.length}`);
    if (defs[0].name !== 'allowed_tool') throw new Error('Wrong tool in definitions');
  });

  await test('Tool registry: execute auto-approved tool', async () => {
    const { EventBus } = await import('./lib/event-bus.js');
    const { ToolRegistry } = await import('./tools/registry.js');

    const bus = new EventBus();
    const registry = new ToolRegistry(bus);

    registry.register({
      name: 'echo',
      description: 'Echo back',
      parameters: { type: 'object', properties: { text: { type: 'string', description: 'Text' } }, required: ['text'] },
      approval: 'auto',
      execute: async (args) => `Echo: ${args.text}`,
    });

    const result = await registry.execute('echo', { text: 'hello' }, 'msg-1');
    if (result !== 'Echo: hello') throw new Error(`Unexpected result: ${result}`);
  });

  await test('Tool registry: execute denied tool returns error', async () => {
    const { EventBus } = await import('./lib/event-bus.js');
    const { ToolRegistry } = await import('./tools/registry.js');

    const bus = new EventBus();
    const registry = new ToolRegistry(bus);

    registry.register({
      name: 'blocked',
      description: 'Blocked tool',
      parameters: { type: 'object', properties: {}, required: [] },
      approval: 'deny',
      execute: async () => 'should not run',
    });

    const result = await registry.execute('blocked', {}, 'msg-1');
    if (!result.includes('disabled')) throw new Error(`Expected disabled message, got: ${result}`);
  });

  await test('Tool registry: execute unknown tool returns error', async () => {
    const { EventBus } = await import('./lib/event-bus.js');
    const { ToolRegistry } = await import('./tools/registry.js');

    const bus = new EventBus();
    const registry = new ToolRegistry(bus);

    const result = await registry.execute('nonexistent', {}, 'msg-1');
    if (!result.includes('Unknown tool')) throw new Error(`Expected unknown tool message, got: ${result}`);
  });

  await test('Tool registry: emits tool events', async () => {
    const { EventBus } = await import('./lib/event-bus.js');
    const { ToolRegistry } = await import('./tools/registry.js');

    const bus = new EventBus();
    const registry = new ToolRegistry(bus);
    const events: string[] = [];

    bus.on('tool:calling', () => events.push('calling'));
    bus.on('tool:result', () => events.push('result'));

    registry.register({
      name: 'event_test',
      description: 'Test events',
      parameters: { type: 'object', properties: {}, required: [] },
      approval: 'auto',
      execute: async () => 'done',
    });

    await registry.execute('event_test', {}, 'msg-1');
    if (!events.includes('calling')) throw new Error('Missing calling event');
    if (!events.includes('result')) throw new Error('Missing result event');
  });

  await test('Shell exec tool runs commands', async () => {
    const { shellExecTool } = await import('./tools/shell.js');
    const result = await shellExecTool.execute({ command: 'echo hello' });
    if (!result.includes('hello')) throw new Error(`Expected 'hello', got: ${result}`);
  });

  await test('File read tool reads files', async () => {
    const { fileReadTool } = await import('./tools/file-ops.js');
    const result = await fileReadTool.execute({ path: 'package.json' });
    if (!result.includes('"sigil"')) throw new Error('Failed to read package.json');
  });

  await test('List dir tool lists directories', async () => {
    const { listDirTool } = await import('./tools/file-ops.js');
    const result = await listDirTool.execute({ path: 'src' });
    if (!result.includes('types.ts')) throw new Error('Failed to list src directory');
  });

  await test('Memory tools: remember and recall', async () => {
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
    const { createMemoryTools } = await import('./tools/memory-tools.js');

    const config = {
      version: '2.0.0',
      identity: { name: 'Sigil', personality: 'Test.' },
      models: [], defaultModel: '',
      memory: { dbPath: ':memory:', maxRecallResults: 5 },
      transports: { tui: { enabled: false }, web: { enabled: false, port: 3033, host: '127.0.0.1' }, telegram: { enabled: false } },
      skills: { path: 'skills' },
    };

    const memories = new MemoryStore(db);
    const conversation = new ConversationStore(db);
    const profile = new Profile('/tmp/sigil-test-profile-tools.md');
    const engine = new ContextEngine(config, memories, conversation, profile, null);
    const tools = createMemoryTools(engine);

    // Find remember and recall tools
    const rememberTool = tools.find((t) => t.name === 'remember')!;
    const recallTool = tools.find((t) => t.name === 'recall')!;

    // Remember something
    const storeResult = await rememberTool.execute({ content: 'User birthday is May 15th', type: 'fact', tags: 'birthday' });
    if (!storeResult.includes('Stored')) throw new Error(`Remember failed: ${storeResult}`);

    // Recall it
    const recallResult = await recallTool.execute({ query: 'birthday' });
    if (!recallResult.includes('May 15th')) throw new Error(`Recall failed: ${recallResult}`);

    // Cleanup
    const { unlinkSync } = await import('node:fs');
    try { unlinkSync('/tmp/sigil-test-profile-tools.md'); } catch {}
    db.close();
  });

  await test('Memory tools: update profile', async () => {
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
    const { createMemoryTools } = await import('./tools/memory-tools.js');

    const config = {
      version: '2.0.0',
      identity: { name: 'Sigil', personality: 'Test.' },
      models: [], defaultModel: '',
      memory: { dbPath: ':memory:', maxRecallResults: 5 },
      transports: { tui: { enabled: false }, web: { enabled: false, port: 3033, host: '127.0.0.1' }, telegram: { enabled: false } },
      skills: { path: 'skills' },
    };

    const memories = new MemoryStore(db);
    const conversation = new ConversationStore(db);
    const profilePath = '/tmp/sigil-test-profile-update.md';
    const profile = new Profile(profilePath);
    const engine = new ContextEngine(config, memories, conversation, profile, null);
    const tools = createMemoryTools(engine);

    const updateTool = tools.find((t) => t.name === 'update_profile')!;
    await updateTool.execute({ content: '# Profile\n\n- Name: Mike\n- Likes: cats' });

    const content = profile.get();
    if (!content.includes('Mike')) throw new Error('Profile not updated');
    if (!content.includes('cats')) throw new Error('Profile missing content');

    const { unlinkSync } = await import('node:fs');
    try { unlinkSync(profilePath); } catch {}
    db.close();
  });

  // ── Module 5: Routing ──────────────────────────────────────────────

  console.log(chalk.dim('\n  Module 5: Routing'));

  await test('Classifier: casual chat detected', async () => {
    const { classify } = await import('./router/classifier.js');
    const { classification } = classify('hi');
    if (classification.type !== 'chat') throw new Error(`Expected chat, got ${classification.type}`);
  });

  await test('Classifier: tool request detected', async () => {
    const { classify } = await import('./router/classifier.js');
    const { classification } = classify('what is the uptime of this server?');
    if (classification.type !== 'tool') throw new Error(`Expected tool, got ${classification.type}`);
  });

  await test('Classifier: complex request detected', async () => {
    const { classify } = await import('./router/classifier.js');
    const { classification } = classify('explain how neural networks work in detail');
    if (classification.type !== 'complex') throw new Error(`Expected complex, got ${classification.type}`);
  });

  await test('Classifier: question detected', async () => {
    const { classify } = await import('./router/classifier.js');
    const { classification } = classify('what is the capital of France?');
    if (classification.type !== 'question') throw new Error(`Expected question, got ${classification.type}`);
  });

  await test('Classifier: /local override extracted', async () => {
    const { classify } = await import('./router/classifier.js');
    const { classification, cleanMessage } = classify('/local tell me a joke');
    if (classification.override !== 'local') throw new Error(`Expected local override, got ${classification.override}`);
    if (cleanMessage !== 'tell me a joke') throw new Error(`Message not cleaned: ${cleanMessage}`);
  });

  await test('Classifier: /cloud override extracted', async () => {
    const { classify } = await import('./router/classifier.js');
    const { classification, cleanMessage } = classify('/cloud explain quantum computing');
    if (classification.override !== 'cloud') throw new Error(`Expected cloud override`);
    if (cleanMessage !== 'explain quantum computing') throw new Error(`Message not cleaned`);
  });

  await test('Classifier: /private override extracted', async () => {
    const { classify } = await import('./router/classifier.js');
    const { classification } = classify('/private what is my salary?');
    if (classification.override !== 'private') throw new Error(`Expected private override`);
  });

  await test('Router: single model returns it for everything', async () => {
    const { Router } = await import('./router/router.js');
    const config = {
      version: '2.0.0',
      identity: { name: 'test', personality: 'test' },
      models: [{ name: 'local', provider: 'openai-compatible', model: 'qwen3:8b', tier: 'basic' as const, costPer1kInput: 0, costPer1kOutput: 0, useFor: ['general'] }],
      defaultModel: 'local',
      memory: { dbPath: ':memory:', maxRecallResults: 5 },
      transports: { tui: { enabled: false }, web: { enabled: false, port: 3033, host: '127.0.0.1' }, telegram: { enabled: false } },
      skills: { path: 'skills' },
    };
    const router = new Router(config);

    const chat = router.route('hi');
    const complex = router.route('explain quantum computing in detail');
    if (chat.model.name !== 'local') throw new Error('Wrong model for chat');
    if (complex.model.name !== 'local') throw new Error('Wrong model for complex');
  });

  await test('Router: multi-model routes by tier', async () => {
    const { Router } = await import('./router/router.js');
    const config = {
      version: '2.0.0',
      identity: { name: 'test', personality: 'test' },
      models: [
        { name: 'local', provider: 'openai-compatible', model: 'qwen3:8b', tier: 'basic' as const, costPer1kInput: 0, costPer1kOutput: 0, useFor: ['general'] },
        { name: 'claude', provider: 'anthropic', model: 'claude-sonnet', tier: 'standard' as const, costPer1kInput: 0.003, costPer1kOutput: 0.015, useFor: ['general'] },
      ],
      defaultModel: 'local',
      memory: { dbPath: ':memory:', maxRecallResults: 5 },
      transports: { tui: { enabled: false }, web: { enabled: false, port: 3033, host: '127.0.0.1' }, telegram: { enabled: false } },
      skills: { path: 'skills' },
    };
    const router = new Router(config);

    const chat = router.route('hi');
    if (chat.model.name !== 'local') throw new Error(`Chat should route to local, got ${chat.model.name}`);

    const tool = router.route('run uptime command');
    if (tool.model.name !== 'claude') throw new Error(`Tool should route to claude (standard), got ${tool.model.name}`);
  });

  await test('Router: /local override forces local model', async () => {
    const { Router } = await import('./router/router.js');
    const config = {
      version: '2.0.0',
      identity: { name: 'test', personality: 'test' },
      models: [
        { name: 'local', provider: 'openai-compatible', model: 'qwen3:8b', tier: 'basic' as const, costPer1kInput: 0, costPer1kOutput: 0, useFor: ['general'] },
        { name: 'claude', provider: 'anthropic', model: 'claude-sonnet', tier: 'standard' as const, costPer1kInput: 0.003, costPer1kOutput: 0.015, useFor: ['general'] },
      ],
      defaultModel: 'local',
      memory: { dbPath: ':memory:', maxRecallResults: 5 },
      transports: { tui: { enabled: false }, web: { enabled: false, port: 3033, host: '127.0.0.1' }, telegram: { enabled: false } },
      skills: { path: 'skills' },
    };
    const router = new Router(config);

    // This would normally route to claude (complex), but /local forces local
    const result = router.route('/local explain quantum computing in detail');
    if (result.model.name !== 'local') throw new Error(`Override should force local, got ${result.model.name}`);
  });

  await test('Context trimmer: chat gets fewer messages', async () => {
    const { getTrimConfig } = await import('./router/trimmer.js');
    const chatTrim = getTrimConfig('chat');
    const complexTrim = getTrimConfig('complex');
    if (chatTrim.maxHistory >= complexTrim.maxHistory) throw new Error('Chat should get less history than complex');
    if (!chatTrim.includeTools) throw new Error('Chat should include tools');
    if (!complexTrim.includeTools) throw new Error('Complex should include tools');
  });

  await test('Cost tracker: log and retrieve', async () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE usage (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT, model TEXT, tier TEXT, request_type TEXT, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, estimated_cost REAL DEFAULT 0, routed_by TEXT, override TEXT, timestamp TEXT);
      CREATE TABLE routing_patterns (id INTEGER PRIMARY KEY AUTOINCREMENT, pattern TEXT, classified_type TEXT, actual_tokens INTEGER, model_used TEXT, created_at TEXT);
    `);

    const { CostTracker } = await import('./router/cost-tracker.js');
    const tracker = new CostTracker(db);

    tracker.log('msg-1', {
      name: 'claude', provider: 'anthropic', model: 'claude-sonnet',
      tier: 'standard', costPer1kInput: 0.003, costPer1kOutput: 0.015, useFor: [],
    }, { inputTokens: 1000, outputTokens: 500 }, 'complex', 'heuristic', null);

    const today = tracker.getTodaySummary();
    if (today.totalRequests !== 1) throw new Error(`Expected 1 request, got ${today.totalRequests}`);
    if (today.totalCost === 0) throw new Error('Cost should be > 0');

    const total = tracker.getTotalSpend();
    if (total === 0) throw new Error('Total spend should be > 0');

    db.close();
  });

  // ── Module 9: Diagnosis ──────────────────────────────────────────

  console.log(chalk.dim('\n  Module 9: Diagnosis'));

  await test('read_source reads existing source file', async () => {
    const { EventBus } = await import('./lib/event-bus.js');
    const { createDiagnosisTools } = await import('./tools/diagnosis-tools.js');

    const bus = new EventBus();
    const tools = createDiagnosisTools(bus);
    const readSource = tools.find((t) => t.name === 'read_source')!;

    const result = await readSource.execute({ path: 'types.ts' });
    if (!result.includes('SigilConfig')) throw new Error('Should contain SigilConfig type');
    if (!result.includes('No local override')) throw new Error('Should report no override');
  });

  await test('read_source returns error for missing file', async () => {
    const { EventBus } = await import('./lib/event-bus.js');
    const { createDiagnosisTools } = await import('./tools/diagnosis-tools.js');

    const bus = new EventBus();
    const tools = createDiagnosisTools(bus);
    const readSource = tools.find((t) => t.name === 'read_source')!;

    const result = await readSource.execute({ path: 'nonexistent/file.ts' });
    if (!result.includes('not found')) throw new Error('Should report file not found');
  });

  await test('list_overrides returns empty when none exist', async () => {
    const { EventBus } = await import('./lib/event-bus.js');
    const { createDiagnosisTools } = await import('./tools/diagnosis-tools.js');

    const bus = new EventBus();
    const tools = createDiagnosisTools(bus);
    const listOverrides = tools.find((t) => t.name === 'list_overrides')!;

    const result = await listOverrides.execute({});
    if (!result.includes('No local overrides')) throw new Error('Should report no overrides');
  });

  await test('remove_override handles missing override gracefully', async () => {
    const { EventBus } = await import('./lib/event-bus.js');
    const { createDiagnosisTools } = await import('./tools/diagnosis-tools.js');

    const bus = new EventBus();
    const tools = createDiagnosisTools(bus);
    const removeOverride = tools.find((t) => t.name === 'remove_override')!;

    const result = await removeOverride.execute({ modulePath: 'nonexistent/module', reason: 'test' });
    if (!result.includes('No override found')) throw new Error('Should report no override found');
  });

  await test('Classifier: diagnosis keywords route to tool', async () => {
    const { classify } = await import('./router/classifier.js');
    const { classification } = classify('can you read source code of the gateway module?');
    if (classification.type !== 'tool') throw new Error(`Expected tool, got ${classification.type}`);
  });

  await test('Classifier: fix this routes to tool', async () => {
    const { classify } = await import('./router/classifier.js');
    const { classification } = classify('fix this error in the config parser');
    if (classification.type !== 'tool') throw new Error(`Expected tool, got ${classification.type}`);
  });

  // ── Module 10: Extensions ────────────────────────────────────────

  console.log(chalk.dim('\n  Module 10: Extensions'));

  await test('list_custom_tools returns empty when none exist', async () => {
    const { EventBus } = await import('./lib/event-bus.js');
    const { ToolRegistry } = await import('./tools/registry.js');
    const { createExtensionTools } = await import('./tools/extension-tools.js');

    const bus = new EventBus();
    const registry = new ToolRegistry(bus);
    const tools = createExtensionTools(bus, registry);
    const listTool = tools.find((t) => t.name === 'list_custom_tools')!;

    const result = await listTool.execute({});
    if (!result.includes('No custom tools')) throw new Error('Should report no custom tools');
  });

  await test('create_skill writes valid skill file', async () => {
    const { EventBus } = await import('./lib/event-bus.js');
    const { ToolRegistry } = await import('./tools/registry.js');
    const { createExtensionTools } = await import('./tools/extension-tools.js');
    const { existsSync, readFileSync, unlinkSync } = await import('node:fs');
    const { resolve } = await import('node:path');

    const bus = new EventBus();
    const registry = new ToolRegistry(bus);
    const tools = createExtensionTools(bus, registry);
    const createSkill = tools.find((t) => t.name === 'create_skill')!;

    const result = await createSkill.execute({
      name: 'test-skill-temp',
      description: 'A test skill for unit tests',
      triggers: 'test, unit test, testing',
      content: '## Testing\n\nThis is a test skill.',
    });

    if (!result.includes('test-skill-temp')) throw new Error('Should confirm skill name');

    const skillPath = resolve(process.cwd(), 'skills', 'test-skill-temp.md');
    if (!existsSync(skillPath)) throw new Error('Skill file not created');

    const content = readFileSync(skillPath, 'utf-8');
    if (!content.includes('name: test-skill-temp')) throw new Error('Missing name in frontmatter');
    if (!content.includes('triggers:')) throw new Error('Missing triggers in frontmatter');

    // Cleanup
    try { unlinkSync(skillPath); } catch {}
  });

  await test('Classifier: create tool routes to tool type', async () => {
    const { classify } = await import('./router/classifier.js');
    const { classification } = classify('create a tool that checks the weather');
    if (classification.type !== 'tool') throw new Error(`Expected tool, got ${classification.type}`);
  });

  await test('Tool loader returns empty for missing directory', async () => {
    const { loadLocalTools } = await import('./lib/tool-loader.js');
    const tools = await loadLocalTools();
    // Should return empty array (local/tools/ likely doesn't exist in test env)
    if (!Array.isArray(tools)) throw new Error('Should return an array');
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
