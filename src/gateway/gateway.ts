/**
 * Gateway
 *
 * Central message router. Transports push messages in, the agent processes
 * them, responses flow back out via the event bus.
 *
 * All communication goes through events:
 *   - Transport sends message → gateway emits 'message:received'
 *   - Agent processes → emits 'broadcast:response'
 *   - All transports receive the broadcast
 *
 * The gateway itself is thin — it just connects the dots.
 * The event bus does the heavy lifting.
 */

import { randomUUID } from 'node:crypto';
import type { Message, TransportType } from '../types.js';
import { EventBus } from '../lib/event-bus.js';
import { Agent } from '../agent/agent.js';

export class Gateway {
  private bus: EventBus;
  private agent: Agent;

  constructor(bus: EventBus, agent: Agent) {
    this.bus = bus;
    this.agent = agent;

    // Wire up: when a message is received, process it
    this.bus.on('message:received', async (message) => {
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
    });
  }

  /**
   * Accept a message from a transport. This is the main entry point.
   * Creates a proper Message object and emits it to the bus.
   */
  send(content: string, source: TransportType): Message {
    const message: Message = {
      id: randomUUID(),
      content,
      source,
      timestamp: new Date(),
    };

    this.bus.emit('message:received', message);
    return message;
  }

  /** Get the event bus (transports need this to subscribe to broadcasts) */
  getBus(): EventBus {
    return this.bus;
  }
}
