/**
 * WebSocket Server
 *
 * Fastify + WebSocket server that the TUI client (and future web UI) connects to.
 * The service runs headless — this is its external interface.
 *
 * JSON protocol:
 *   Client → Server: { type: "message", content: "..." }
 *   Server → Client: { type: "response", content: "...", model: "...", messageId: "..." }
 *   Server → Client: { type: "notification", content: "...", severity: "info"|"warn"|"error" }
 *   Server → Client: { type: "error", content: "...", messageId: "..." }
 */

import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import type { SigilConfig } from '../types.js';
import { EventBus } from '../lib/event-bus.js';
import { Gateway } from '../gateway/gateway.js';

/** Message from client to server */
interface ClientMessage {
  type: 'message';
  content: string;
}

/** Messages from server to client */
interface ServerMessage {
  type: 'response' | 'notification' | 'error' | 'status';
  content: string;
  model?: string;
  messageId?: string;
  severity?: string;
  status?: 'queued' | 'processing';
  position?: number;
}

export class WSServer {
  private fastify = Fastify({ logger: false });
  private bus: EventBus;
  private gateway: Gateway;
  private config: SigilConfig;
  private clients = new Set<WebSocket>();

  constructor(bus: EventBus, gateway: Gateway, config: SigilConfig) {
    this.bus = bus;
    this.gateway = gateway;
    this.config = config;
  }

  async start(): Promise<void> {
    await this.fastify.register(websocket);

    // WebSocket endpoint
    this.fastify.get('/ws', { websocket: true }, (socket) => {
      this.clients.add(socket);
      console.log(`[WS] Client connected (${this.clients.size} total)`);

      this.bus.emit('transport:connected', { type: 'websocket', id: String(this.clients.size) });

      socket.on('message', (raw) => {
        try {
          const data = JSON.parse(raw.toString()) as ClientMessage;

          if (data.type === 'message' && data.content) {
            this.gateway.send(data.content, 'websocket');
          }
        } catch (err) {
          this.sendTo(socket, {
            type: 'error',
            content: 'Invalid message format. Expected: { type: "message", content: "..." }',
          });
        }
      });

      socket.on('close', () => {
        this.clients.delete(socket);
        console.log(`[WS] Client disconnected (${this.clients.size} total)`);
        this.bus.emit('transport:disconnected', { type: 'websocket', id: '' });
      });

      socket.on('error', (err) => {
        console.error('[WS] Socket error:', err.message);
        this.clients.delete(socket);
      });
    });

    // Health check endpoint (useful for monitoring)
    this.fastify.get('/health', async () => {
      return { status: 'ok', clients: this.clients.size };
    });

    // Subscribe to broadcasts and send to all connected clients
    this.bus.on('broadcast:response', (response) => {
      this.broadcast({
        type: 'response',
        content: response.content,
        model: response.model,
        messageId: response.messageId,
      });
    });

    this.bus.on('broadcast:notification', (notification) => {
      this.broadcast({
        type: 'notification',
        content: notification.content,
        severity: notification.severity,
      });
    });

    this.bus.on('message:queued', (data) => {
      this.broadcast({
        type: 'status',
        content: '',
        messageId: data.messageId,
        status: 'queued',
        position: data.position,
      });
    });

    this.bus.on('message:processing', (data) => {
      this.broadcast({
        type: 'status',
        content: '',
        messageId: data.messageId,
        status: 'processing',
      });
    });

    this.bus.on('message:error', (error) => {
      this.broadcast({
        type: 'error',
        content: error.error,
        messageId: error.messageId,
      });
    });

    // Task events (module 6)
    this.bus.on('task:complete', ({ taskId, result, cost }) => {
      this.broadcast({
        type: 'response',
        content: result,
        model: 'background-task',
        messageId: taskId,
      });
    });

    this.bus.on('task:error', ({ taskId, error }) => {
      this.broadcast({
        type: 'error',
        content: `Task ${taskId.slice(0, 8)} failed: ${error}`,
        messageId: taskId,
      });
    });

    // Start listening
    const { port, host } = this.config.transports.web;
    await this.fastify.listen({ port, host });
    console.log(`[WS] Server listening on ${host}:${port}`);
  }

  async stop(): Promise<void> {
    // Close all client connections
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
    await this.fastify.close();
    console.log('[WS] Server stopped');
  }

  /** Send a message to a specific client */
  private sendTo(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  /** Broadcast a message to all connected clients */
  private broadcast(message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) {
        client.send(data);
      }
    }
  }
}
