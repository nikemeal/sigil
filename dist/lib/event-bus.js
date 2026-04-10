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
export class EventBus {
    listeners = new Map();
    onceListeners = new Map();
    /** Subscribe to an event. Returns an unsubscribe function. */
    on(event, listener) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(listener);
        // Return unsubscribe function for cleanup
        return () => {
            this.listeners.get(event)?.delete(listener);
        };
    }
    /** Subscribe to an event, but only fire once then auto-unsubscribe. */
    once(event, listener) {
        if (!this.onceListeners.has(event)) {
            this.onceListeners.set(event, new Set());
        }
        this.onceListeners.get(event).add(listener);
        return () => {
            this.onceListeners.get(event)?.delete(listener);
        };
    }
    /** Emit an event to all subscribers. */
    emit(event, payload) {
        // Fire regular listeners
        const listeners = this.listeners.get(event);
        if (listeners) {
            for (const listener of listeners) {
                try {
                    listener(payload);
                }
                catch (err) {
                    console.error(`[EventBus] Error in listener for '${String(event)}':`, err);
                }
            }
        }
        // Fire and remove once-listeners
        const onceListeners = this.onceListeners.get(event);
        if (onceListeners) {
            for (const listener of onceListeners) {
                try {
                    listener(payload);
                }
                catch (err) {
                    console.error(`[EventBus] Error in once-listener for '${String(event)}':`, err);
                }
            }
            this.onceListeners.delete(event);
        }
    }
    /** Remove all listeners for a specific event, or all events if no event specified. */
    clear(event) {
        if (event) {
            this.listeners.delete(event);
            this.onceListeners.delete(event);
        }
        else {
            this.listeners.clear();
            this.onceListeners.clear();
        }
    }
    /** Get count of listeners for a specific event (useful for diagnostics). */
    listenerCount(event) {
        const regular = this.listeners.get(event)?.size ?? 0;
        const once = this.onceListeners.get(event)?.size ?? 0;
        return regular + once;
    }
}
//# sourceMappingURL=event-bus.js.map