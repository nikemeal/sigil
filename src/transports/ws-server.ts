import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import type { Gateway } from '../gateway/gateway.js';
import type { WebSocket } from 'ws';

/**
 * WebSocket transport server.
 *
 * Runs inside the main Sigil process. Clients (TUI, web UI) connect
 * and exchange JSON messages:
 *
 *   Client → Server: { type: "message", content: "hello", threadId?: "..." }
 *   Server → Client: { type: "response", content: "...", actions?: [...] }
 *   Server → Client: { type: "notify", content: "..." }  (async task results)
 */

interface WSMessage {
  type: 'message';
  content: string;
  threadId?: string;
}

interface WSResponse {
  type: 'response' | 'notify';
  content: string;
  actions?: Array<{ tool: string; durationMs: number }>;
}

export async function startWSServer(
  gateway: Gateway,
  host: string,
  port: number,
): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);

  const clients = new Set<WebSocket>();
  const directReplies = new Set<string>(); // Track IDs we've already sent directly

  app.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket);
    console.log(`[ws] Client connected (${clients.size} total)`);

    socket.on('message', async (raw) => {
      try {
        const msg: WSMessage = JSON.parse(raw.toString());

        if (msg.type !== 'message' || !msg.content) {
          socket.send(JSON.stringify({ type: 'error', content: 'Invalid message format' }));
          return;
        }

        const response = await gateway.sendText(
          msg.content,
          'web',
          msg.threadId ?? `ws_${Date.now()}`,
        );

        // Mark this as already sent so the listener doesn't duplicate it
        directReplies.add(response.id);

        const reply: WSResponse = {
          type: 'response',
          content: response.content,
          actions: response.actions?.map(a => ({ tool: a.tool, durationMs: a.durationMs })),
        };

        socket.send(JSON.stringify(reply));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        socket.send(JSON.stringify({ type: 'error', content: message }));
      }
    });

    socket.on('close', () => {
      clients.delete(socket);
      console.log(`[ws] Client disconnected (${clients.size} total)`);
    });
  });

  // Listen for async notifications ONLY (task completions, health alerts, etc.)
  // Skip anything we already sent as a direct reply
  gateway.onResponse('web', (response) => {
    if (directReplies.has(response.id)) {
      directReplies.delete(response.id);
      return; // Already sent directly, don't duplicate
    }

    const msg: WSResponse = { type: 'notify', content: response.content };
    const payload = JSON.stringify(msg);
    for (const client of clients) {
      if (client.readyState === 1) {
        client.send(payload);
      }
    }
  });

  await app.listen({ host, port });
  console.log(`[ws] Server listening on ws://${host}:${port}/ws`);

  return app;
}
