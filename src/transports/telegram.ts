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

import { Bot, type Context } from 'grammy';
import type { SigilConfig } from '../types.js';
import { EventBus } from '../lib/event-bus.js';
import { Gateway } from '../gateway/gateway.js';

/** Telegram's max message length */
const MAX_MESSAGE_LENGTH = 4096;

export class TelegramTransport {
  private bot: Bot;
  private bus: EventBus;
  private gateway: Gateway;
  private config: SigilConfig;
  private allowedChatIds: Set<string>;
  private activeChatIds = new Set<string>();
  private started = false;

  constructor(bus: EventBus, gateway: Gateway, config: SigilConfig, botToken: string) {
    this.bus = bus;
    this.gateway = gateway;
    this.config = config;
    this.bot = new Bot(botToken);

    // Build allowlist
    this.allowedChatIds = new Set(config.transports.telegram.allowedChatIds ?? []);

    this.setupBot();
    this.setupBroadcasts();
  }

  async start(): Promise<void> {
    if (this.started) return;

    try {
      // Start long-polling (non-blocking)
      this.bot.start({
        onStart: () => {
          this.started = true;
          console.log('[Telegram] Bot connected and polling.');
          this.bus.emit('transport:connected', { type: 'telegram', id: 'telegram' });
        },
      });
    } catch (err) {
      console.error('[Telegram] Failed to start:', (err as Error).message);
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.bot.stop();
    this.started = false;
    console.log('[Telegram] Bot stopped.');
  }

  private setupBot(): void {
    // Handle /start command
    this.bot.command('start', async (ctx) => {
      if (!this.isAllowed(ctx)) return;
      await ctx.reply(
        `Hi! I'm ${this.config.identity.name}. Send me a message and I'll respond.`
      );
    });

    // Handle /help command
    this.bot.command('help', async (ctx) => {
      if (!this.isAllowed(ctx)) return;
      await ctx.reply(
        'Just send me a message. I share context with all other transports (TUI, web, etc.).'
      );
    });

    // Handle all text messages
    this.bot.on('message:text', async (ctx) => {
      if (!this.isAllowed(ctx)) return;

      const chatId = String(ctx.chat.id);
      this.activeChatIds.add(chatId);

      // Send to gateway for processing
      this.gateway.send(ctx.message.text, 'telegram');
    });
  }

  /** Subscribe to event bus broadcasts and forward to Telegram */
  private setupBroadcasts(): void {
    this.bus.on('broadcast:response', async (response) => {
      await this.broadcastToChats(response.content);
    });

    this.bus.on('broadcast:notification', async (notification) => {
      const prefix = notification.severity === 'error' ? '⚠️ '
        : notification.severity === 'warn' ? '⚡ '
        : 'ℹ️ ';
      await this.broadcastToChats(prefix + notification.content);
    });
  }

  /** Send a message to all active Telegram chats */
  private async broadcastToChats(text: string): Promise<void> {
    const chunks = splitMessage(text);

    for (const chatId of this.activeChatIds) {
      for (const chunk of chunks) {
        try {
          await this.bot.api.sendMessage(chatId, chunk, { parse_mode: 'Markdown' })
            .catch(() => {
              // If Markdown fails, send as plain text
              return this.bot.api.sendMessage(chatId, chunk);
            });
        } catch (err) {
          console.error(`[Telegram] Failed to send to ${chatId}:`, (err as Error).message);
        }
      }
    }
  }

  /** Check if a message is from an allowed chat */
  private isAllowed(ctx: Context): boolean {
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
function splitMessage(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) return [text];

  const chunks: string[] = [];
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
    } else {
      // Try line break
      const lineBreak = remaining.lastIndexOf('\n', MAX_MESSAGE_LENGTH);
      if (lineBreak > MAX_MESSAGE_LENGTH * 0.3) {
        breakAt = lineBreak;
      } else {
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
