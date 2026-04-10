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
import type { Message, TransportType } from '../types.js';
import { EventBus } from '../lib/event-bus.js';
import { Agent } from '../agent/agent.js';
import { TaskStore } from '../tasks/store.js';
import { Scheduler } from '../tasks/scheduler.js';
export declare class Gateway {
    private bus;
    private agent;
    private queue;
    private processing;
    private taskStore;
    private scheduler;
    constructor(bus: EventBus, agent: Agent);
    /** Enable background task support */
    setTaskComponents(taskStore: TaskStore, scheduler: Scheduler): void;
    /**
     * Accept a message from a transport. This is the main entry point.
     * Creates a proper Message object, queues it, and starts processing.
     */
    send(content: string, source: TransportType): Message;
    /** Get the event bus (transports need this to subscribe to broadcasts) */
    getBus(): EventBus;
    /**
     * Process queued messages one at a time.
     * If already processing, the current call returns — the active loop
     * will pick up the new message when it finishes the current one.
     */
    private processQueue;
    /** Create a background task and send an immediate acknowledgement */
    private handleBackgroundTask;
}
//# sourceMappingURL=gateway.d.ts.map