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
import { Bot } from 'grammy';
/** Telegram's max message length */
const MAX_MESSAGE_LENGTH = 4096;
export class TelegramTransport {
    bot;
    bus;
    gateway;
    config;
    allowedChatIds;
    activeChatIds = new Set();
    started = false;
    constructor(bus, gateway, config, botToken) {
        this.bus = bus;
        this.gateway = gateway;
        this.config = config;
        this.bot = new Bot(botToken);
        // Build allowlist
        this.allowedChatIds = new Set(config.transports.telegram.allowedChatIds ?? []);
        this.setupBot();
        this.setupBroadcasts();
    }
    async start() {
        if (this.started)
            return;
        try {
            // Start long-polling (non-blocking)
            this.bot.start({
                onStart: () => {
                    this.started = true;
                    console.log('[Telegram] Bot connected and polling.');
                    this.bus.emit('transport:connected', { type: 'telegram', id: 'telegram' });
                },
            });
        }
        catch (err) {
            console.error('[Telegram] Failed to start:', err.message);
        }
    }
    async stop() {
        if (!this.started)
            return;
        this.bot.stop();
        this.started = false;
        console.log('[Telegram] Bot stopped.');
    }
    setupBot() {
        // Handle /start command
        this.bot.command('start', async (ctx) => {
            if (!this.isAllowed(ctx))
                return;
            await ctx.reply(`Hi! I'm ${this.config.identity.name}. Send me a message and I'll respond.`);
        });
        // Handle /help command
        this.bot.command('help', async (ctx) => {
            if (!this.isAllowed(ctx))
                return;
            await ctx.reply('Just send me a message. I share context with all other transports (TUI, web, etc.).');
        });
        // Handle all text messages
        this.bot.on('message:text', async (ctx) => {
            if (!ctx.chat || !ctx.message?.text)
                return;
            const chatId = String(ctx.chat.id);
            console.log(`[Telegram] Message from chat ${chatId}: ${ctx.message.text.slice(0, 50)}${ctx.message.text.length > 50 ? '...' : ''}`);
            if (!this.isAllowed(ctx))
                return;
            this.activeChatIds.add(chatId);
            // Send to gateway for processing
            this.gateway.send(ctx.message.text, 'telegram');
        });
    }
    /** Subscribe to event bus broadcasts and forward to Telegram */
    setupBroadcasts() {
        this.bus.on('broadcast:response', async (response) => {
            await this.broadcastToChats(response.content);
        });
        this.bus.on('broadcast:notification', async (notification) => {
            const prefix = notification.severity === 'error' ? '⚠️ '
                : notification.severity === 'warn' ? '⚡ '
                    : 'ℹ️ ';
            await this.broadcastToChats(prefix + notification.content);
        });
        // Task events (module 6)
        this.bus.on('task:complete', async ({ taskId, result }) => {
            await this.broadcastToChats(result);
        });
        this.bus.on('task:error', async ({ taskId, error }) => {
            await this.broadcastToChats(`⚠️ Task ${taskId.slice(0, 8)} failed: ${error}`);
        });
        // Health reconnect (module 8)
        this.bus.on('health:reconnect_requested', async ({ transport }) => {
            if (transport !== 'telegram')
                return;
            console.log('[Telegram] Reconnect requested by health monitor');
            try {
                await this.stop();
                await new Promise((resolve) => setTimeout(resolve, 2000));
                await this.start();
            }
            catch (err) {
                console.error('[Telegram] Reconnect failed:', err.message);
                this.bus.emit('system:error', { component: 'transport:telegram', error: err.message });
            }
        });
    }
    /** Send a message to all active Telegram chats */
    async broadcastToChats(text) {
        const chunks = splitMessage(text);
        for (const chatId of this.activeChatIds) {
            for (const chunk of chunks) {
                try {
                    await this.bot.api.sendMessage(chatId, chunk, { parse_mode: 'Markdown' })
                        .catch(() => {
                        // If Markdown fails, send as plain text
                        return this.bot.api.sendMessage(chatId, chunk);
                    });
                }
                catch (err) {
                    console.error(`[Telegram] Failed to send to ${chatId}:`, err.message);
                }
            }
        }
    }
    /** Check if a message is from an allowed chat */
    isAllowed(ctx) {
        const chatId = String(ctx.chat?.id);
        // No allowlist = allow everyone (but log for setup)
        if (this.allowedChatIds.size === 0) {
            console.log(`[Telegram] Message from chat ID: ${chatId} (no allowlist configured)`);
            return true;
        }
        if (this.allowedChatIds.has(chatId)) {
            return true;
        }
        console.log(`[Telegram] Blocked message from unknown chat ID: ${chatId}`);
        return false;
    }
}
/**
 * Split a message into chunks that fit within Telegram's limit.
 * Tries to break at paragraph boundaries, then sentence boundaries.
 */
function splitMessage(text) {
    if (text.length <= MAX_MESSAGE_LENGTH)
        return [text];
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
        if (remaining.length <= MAX_MESSAGE_LENGTH) {
            chunks.push(remaining);
            break;
        }
        // Find a good break point
        let breakAt = MAX_MESSAGE_LENGTH;
        // Try paragraph break
        const paraBreak = remaining.lastIndexOf('\n\n', MAX_MESSAGE_LENGTH);
        if (paraBreak > MAX_MESSAGE_LENGTH * 0.3) {
            breakAt = paraBreak;
        }
        else {
            // Try line break
            const lineBreak = remaining.lastIndexOf('\n', MAX_MESSAGE_LENGTH);
            if (lineBreak > MAX_MESSAGE_LENGTH * 0.3) {
                breakAt = lineBreak;
            }
            else {
                // Try sentence break
                const sentenceBreak = remaining.lastIndexOf('. ', MAX_MESSAGE_LENGTH);
                if (sentenceBreak > MAX_MESSAGE_LENGTH * 0.3) {
                    breakAt = sentenceBreak + 1;
                }
            }
        }
        chunks.push(remaining.slice(0, breakAt).trimEnd());
        remaining = remaining.slice(breakAt).trimStart();
    }
    return chunks;
}
//# sourceMappingURL=telegram.js.map