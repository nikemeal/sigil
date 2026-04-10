/**
 * Telegram Transport
 *
 * Connects Sigil to Telegram via grammy (long-polling).
 * Messages flow through the event bus like any other transport:
 *   - Incoming Telegram message → gateway.send() → agent processes
 *   - broadcast:response → sent back to Telegram chat
 *
 * Security: only responds to chat IDs in the allowlist.
 * If no allowlist is configured, logs unknown chat IDs so the user
 * can find theirs and add it via sigil onboard.
 *
 * Auto-splits long messages at Telegram's 4096 character limit.
 */
import type { SigilConfig } from '../types.js';
import { EventBus } from '../lib/event-bus.js';
import { Gateway } from '../gateway/gateway.js';
export declare class TelegramTransport {
    private bot;
    private bus;
    private gateway;
    private config;
    private allowedChatIds;
    private activeChatIds;
    private started;
    constructor(bus: EventBus, gateway: Gateway, config: SigilConfig, botToken: string);
    start(): Promise<void>;
    stop(): Promise<void>;
    private setupBot;
    /** Subscribe to event bus broadcasts and forward to Telegram */
    private setupBroadcasts;
    /** Send a message to all active Telegram chats */
    private broadcastToChats;
    /** Check if a message is from an allowed chat */
    private isAllowed;
}
//# sourceMappingURL=telegram.d.ts.map