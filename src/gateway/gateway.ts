/**
 * Gateway
 *
 * Central message router. Transports push messages in, the agent processes
 * them, responses flow back out via the event bus.
 *
 * Messages are queued and processed sequentially. This matters because:
 *   - Conversations are inherently ordered (message 2 may depend on response 1)
 *   - Module 2 adds conversation history — order must be preserved
 *   - Transports get predictable, in-order responses
 *
 * All communication goes through events:
 *   - Transport sends message → gateway queues it
 *   - Gateway processes queue one at a time via the agent
 *   - Agent emits 'broadcast:response' → all transports receive it
 */

import { randomUUID } from 'node:crypto';
import type { Message, TransportType } from '../types.js';
import { EventBus } from '../lib/event-bus.js';
import { Agent } from '../agent/agent.js';

export class Gateway {
  private bus: EventBus;
  private agent: Agent;
  private queue: Message[] = [];
  private processing = false;

  constructor(bus: EventBus, agent: Agent) {
    this.bus = bus;
    this.agent = agent;
  }

  /**
   * Accept a message from a transport. This is the main entry point.
   * Creates a proper Message object, queues it, and starts processing.
   */
  send(content: string, source: TransportType): Message {
    const message: Message = {
      id: randomUUID(),
      content,
      source,
      timestamp: new Date(),
    };

    this.bus.emit('message:received', message);
    this.queue.push(message);
    this.processQueue();

    return message;
  }

  /** Get the event bus (transports need this to subscribe to broadcasts) */
  getBus(): EventBus {
    return this.bus;
  }

  /**
   * Process queued messages one at a time.
   * If already processing, the current call returns — the active loop
   * will pick up the new message when it finishes the current one.
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const message = this.queue.shift()!;

      try {
        await this.agent.process(message);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error(`[Gateway] Error processing message ${message.id}:`, error);
        this.bus.emit('message:error', {
          messageId: message.id,
          error,
        });
      }
    }

    this.processing = false;
  }
}
