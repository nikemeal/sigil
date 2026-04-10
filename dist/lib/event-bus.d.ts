/**
 * Typed Event Bus
 *
 * Foundation for all inter-component communication in Sigil.
 * Every module publishes and subscribes to events through this bus
 * instead of calling each other directly. This enables:
 *   - Loose coupling between modules
 *   - Easy addition of new modules (just subscribe to events)
 *   - Self-diagnosis (module 9 can observe all system activity)
 *   - Audit trail (module wishlist — log every event)
 *
 * Usage:
 *   bus.on('message:received', (msg) => { ... });
 *   bus.emit('message:received', message);
 */
import { EventMap, EventPayload } from '../types.js';
type Listener<K extends keyof EventMap> = (payload: EventPayload<K>) => void;
export declare class EventBus {
    private listeners;
    private onceListeners;
    /** Subscribe to an event. Returns an unsubscribe function. */
    on<K extends keyof EventMap>(event: K, listener: Listener<K>): () => void;
    /** Subscribe to an event, but only fire once then auto-unsubscribe. */
    once<K extends keyof EventMap>(event: K, listener: Listener<K>): () => void;
    /** Emit an event to all subscribers. */
    emit<K extends keyof EventMap>(event: K, payload: EventPayload<K>): void;
    /** Remove all listeners for a specific event, or all events if no event specified. */
    clear(event?: keyof EventMap): void;
    /** Get count of listeners for a specific event (useful for diagnostics). */
    listenerCount(event: keyof EventMap): number;
}
export {};
//# sourceMappingURL=event-bus.d.ts.map