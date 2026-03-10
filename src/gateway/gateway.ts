import { randomUUID } from 'node:crypto';
import type { Message, Response, Transport } from './types.js';

type MessageHandler = (message: Message) => Promise<Response>;
type ResponseListener = (response: Response) => void;

/**
 * Gateway is the central message bus.
 * Transports push messages in, the agent processes them, responses flow back out.
 */
export class Gateway {
  private handler: MessageHandler | null = null;
  private listeners = new Map<Transport, ResponseListener[]>();

  /** Register the agent as the message handler */
  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  /** Transports subscribe to async notifications (task completions, alerts, etc.) */
  onResponse(transport: Transport, listener: ResponseListener): void {
    const existing = this.listeners.get(transport) ?? [];
    existing.push(listener);
    this.listeners.set(transport, existing);
  }

  /** Send a message into the system (called by transports).
   *  Returns the response directly — does NOT fire listeners.
   *  Listeners are only for async notifications via notify/broadcast. */
  async send(message: Omit<Message, 'id' | 'timestamp'>): Promise<Response> {
    if (!this.handler) {
      throw new Error('No message handler registered. Is the agent running?');
    }

    const fullMessage: Message = {
      ...message,
      id: randomUUID(),
      timestamp: new Date(),
    };

    return this.handler(fullMessage);
  }

  /** Convenience: create a message from a simple string */
  async sendText(content: string, source: Transport = 'tui', threadId?: string): Promise<Response> {
    return this.send({ source, content, threadId });
  }

  /** Push an async notification to a single transport's listeners. */
  notify(transport: Transport, response: Response): void {
    const transportListeners = this.listeners.get(transport) ?? [];
    for (const listener of transportListeners) {
      listener(response);
    }
  }

  /** Broadcast an async notification to ALL active transports. */
  broadcast(response: Response): void {
    for (const [, transportListeners] of this.listeners) {
      for (const listener of transportListeners) {
        listener(response);
      }
    }
  }

  /** Broadcast to all active transports EXCEPT the specified one.
   *  Used after a direct reply — the originating transport already has the response. */
  broadcastExcept(exclude: Transport, response: Response): void {
    for (const [transport, transportListeners] of this.listeners) {
      if (transport === exclude) continue;
      for (const listener of transportListeners) {
        listener(response);
      }
    }
  }

  /** Get which transports have listeners registered (i.e. are active). */
  getActiveTransports(): Transport[] {
    return Array.from(this.listeners.keys()).filter(
      t => (this.listeners.get(t)?.length ?? 0) > 0
    );
  }
}
