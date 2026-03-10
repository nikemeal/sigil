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
   *  Listeners are only for async notifications via notify(). */
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

  /** Push an async notification to a transport's listeners.
   *  Used by task runner, health monitor, etc. — NOT for direct replies. */
  notify(transport: Transport, response: Response): void {
    const transportListeners = this.listeners.get(transport) ?? [];
    for (const listener of transportListeners) {
      listener(response);
    }
  }
}
