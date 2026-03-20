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
 * Queue status is broadcast so transports can show feedback:
 *   - message:queued — message is waiting (position in queue)
 *   - message:processing — message is now being handled by the LLM
 */

import { randomUUID } from 'node:crypto';
import type { Message, Response, TransportType } from '../types.js';
import { EventBus } from '../lib/event-bus.js';
import { Agent } from '../agent/agent.js';
import { classify } from '../router/classifier.js';
import { TaskStore } from '../tasks/store.js';
import { Scheduler } from '../tasks/scheduler.js';

export class Gateway {
  private bus: EventBus;
  private agent: Agent;
  private queue: Message[] = [];
  private processing = false;
  private taskStore: TaskStore | null = null;
  private scheduler: Scheduler | null = null;

  constructor(bus: EventBus, agent: Agent) {
    this.bus = bus;
    this.agent = agent;
  }

  /** Enable background task support */
  setTaskComponents(taskStore: TaskStore, scheduler: Scheduler): void {
    this.taskStore = taskStore;
    this.scheduler = scheduler;
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

    // If already processing, this message is queued behind others
    if (this.processing) {
      this.bus.emit('message:queued', {
        messageId: message.id,
        position: this.queue.length,
      });
    }

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

      this.bus.emit('message:processing', { messageId: message.id });

      // Check if this should be a background task
      if (this.taskStore && this.scheduler) {
        const { classification, cleanMessage } = classify(message.content);
        if (classification.type === 'background') {
          this.handleBackgroundTask(message, cleanMessage);
          continue;
        }
      }

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

  /** Create a background task and send an immediate acknowledgement */
  private handleBackgroundTask(message: Message, cleanMessage: string): void {
    const task = this.taskStore!.create(cleanMessage, message.source);
    this.scheduler!.enqueue(task.id);

    console.log(`[Gateway] Background task created: ${task.id.slice(0, 8)}`);
    this.bus.emit('task:created', { task });

    // Send immediate acknowledgement
    const ack: Response = {
      id: randomUUID(),
      messageId: message.id,
      content: `I'll dig into that and get back to you. (Task ${task.id.slice(0, 8)})`,
      model: 'system',
      timestamp: new Date(),
    };
    this.bus.emit('message:complete', ack);
    this.bus.emit('broadcast:response', ack);

    // Record user message in conversation
    const context = this.agent.getContext();
    if (context) {
      context.recordMessage(message.id, 'user', cleanMessage, message.source);
      context.recordMessage(ack.id, 'assistant', ack.content);
    }
  }
}
