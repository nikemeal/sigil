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
import type { SigilConfig } from '../types.js';
import { EventBus } from '../lib/event-bus.js';
import { Gateway } from '../gateway/gateway.js';
export declare class WSServer {
    private fastify;
    private bus;
    private gateway;
    private config;
    private clients;
    constructor(bus: EventBus, gateway: Gateway, config: SigilConfig);
    start(): Promise<void>;
    stop(): Promise<void>;
    /** Send a message to a specific client */
    private sendTo;
    /** Broadcast a message to all connected clients */
    private broadcast;
}
//# sourceMappingURL=ws-server.d.ts.map