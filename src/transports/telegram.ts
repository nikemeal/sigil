import { Bot, Context } from 'grammy';
import type { Gateway } from '../gateway/gateway.js';
import type { Response } from '../gateway/types.js';

/**
 * Telegram transport adapter.
 *
 * Maps Telegram messages → Gateway Messages, and Gateway Responses → Telegram replies.
 * Also handles async notifications from background tasks.
 *
 * Setup:
 *  1. Message @BotFather on Telegram, /newbot, follow prompts
 *  2. Copy the token
 *  3. Set TELEGRAM_BOT_TOKEN in your .env
 *  4. Enable in sigil.toml: [transports.telegram] enabled = true
 *  5. Start Sigil, message your bot
 *
 * The bot only responds to messages from allowed chat IDs.
 * On first message from an unknown chat, it logs the chat ID so you can
 * add it to the allowlist. If no allowlist is configured, it responds to everyone
 * (single-user setup — lock it down if you share the bot token).
 */

interface TelegramConfig {
  token: string;
  allowedChatIds?: number[];
}

export class TelegramTransport {
  private bot: Bot;
  private gateway: Gateway;
  private allowedChatIds: Set<number>;
  private activeChatId: number | null = null;

  constructor(gateway: Gateway, config: TelegramConfig) {
    this.gateway = gateway;
    this.bot = new Bot(config.token);
    this.allowedChatIds = new Set(config.allowedChatIds ?? []);

    this.setupHandlers();
    this.setupNotifications();
  }

  private setupHandlers(): void {
    // Handle text messages
    this.bot.on('message:text', async (ctx) => {
      if (!this.isAllowed(ctx)) return;

      const chatId = ctx.chat.id;
      this.activeChatId = chatId;

      const text = ctx.message.text;

      // Skip bot commands that aren't meant as chat
      if (text.startsWith('/') && !text.startsWith('/ask ')) {
        await this.handleCommand(ctx, text);
        return;
      }

      // Strip /ask prefix if used
      const content = text.startsWith('/ask ') ? text.slice(5) : text;

      try {
        // Send typing indicator while processing
        await ctx.replyWithChatAction('typing');

        // Keep sending typing every 4 seconds for long requests
        const typingInterval = setInterval(() => {
          ctx.replyWithChatAction('typing').catch(() => {});
        }, 4000);

        const response = await this.gateway.sendText(
          content,
          'telegram',
          'main',
        );

        clearInterval(typingInterval);

        // Send the response, splitting if too long for Telegram's 4096 char limit
        await this.sendResponse(ctx, response);

        // Also push to all other transports (TUI, web, etc.) so messages are consolidated
        this.gateway.broadcastExcept('telegram', response);

      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[telegram] Error processing message: ${message}`);
        await ctx.reply(`Something went wrong: ${message}`).catch(() => {});
      }
    });

    // Handle documents/files
    this.bot.on('message:document', async (ctx) => {
      if (!this.isAllowed(ctx)) return;
      await ctx.reply('File handling coming soon. For now, send me text messages.');
    });
  }

  /** Register for async notifications from the gateway (task completions, etc.) */
  private setupNotifications(): void {
    this.gateway.onResponse('telegram', async (response: Response) => {
      // This fires for async notifications (task completions, health alerts, etc.)
      if (!this.activeChatId) {
        console.warn('[telegram] Got notification but no active chat ID — message dropped');
        return;
      }

      try {
        await this.sendText(this.activeChatId, response.content);
      } catch (err) {
        console.error(`[telegram] Failed to send notification: ${err}`);
      }
    });
  }

  private async handleCommand(ctx: Context, text: string): Promise<void> {
    const command = text.split(' ')[0].replace('/', '').replace(`@${this.bot.botInfo?.username}`, '');

    switch (command) {
      case 'start':
        await ctx.reply(
          `Hey! I'm your Sigil agent. Just send me a message and I'll get to work.\n\n` +
          `You can talk to me naturally — ask questions, give me tasks, or tell me to remember things.\n\n` +
          `Commands:\n` +
          `/status — check what I'm working on\n` +
          `/tasks — list active tasks\n` +
          `/help — show this message`
        );
        break;

      case 'status':
        try {
          const response = await this.gateway.sendText(
            'Give me a brief status update: what tasks are active, any recent completions, and your current state.',
            'telegram',
            'main',
          );
          await this.sendResponse(ctx, response);
        } catch {
          await ctx.reply('Could not fetch status.');
        }
        break;

      case 'tasks':
        try {
          const response = await this.gateway.sendText(
            'List all active tasks with their status.',
            'telegram',
            'main',
          );
          await this.sendResponse(ctx, response);
        } catch {
          await ctx.reply('Could not fetch tasks.');
        }
        break;

      case 'help':
        await ctx.reply(
          `Just send me a message — no commands needed.\n\n` +
          `/status — what am I working on\n` +
          `/tasks — list background tasks\n` +
          `/help — this message`
        );
        break;

      default:
        // Unknown command — treat as a regular message
        await ctx.reply(`Unknown command: /${command}. Try /help or just send me a message.`);
    }
  }

  /** Send a potentially long response, splitting at Telegram's character limit */
  private async sendResponse(ctx: Context, response: Response): Promise<void> {
    const text = response.content;

    if (text.length <= 4000) {
      await ctx.reply(text, { parse_mode: undefined });
      return;
    }

    // Split on paragraph boundaries where possible
    const chunks = this.splitMessage(text, 4000);
    for (const chunk of chunks) {
      await ctx.reply(chunk, { parse_mode: undefined });
      // Small delay to maintain order
      await new Promise(r => setTimeout(r, 100));
    }
  }

  /** Send a message to a specific chat ID (for async notifications) */
  async sendText(chatId: number, text: string): Promise<void> {
    if (text.length <= 4000) {
      await this.bot.api.sendMessage(chatId, text);
      return;
    }

    const chunks = this.splitMessage(text, 4000);
    for (const chunk of chunks) {
      await this.bot.api.sendMessage(chatId, chunk);
      await new Promise(r => setTimeout(r, 100));
    }
  }

  private splitMessage(text: string, maxLen: number): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > maxLen) {
      // Try to split at a paragraph break
      let splitAt = remaining.lastIndexOf('\n\n', maxLen);
      if (splitAt < maxLen * 0.3) {
        // No good paragraph break — try a single newline
        splitAt = remaining.lastIndexOf('\n', maxLen);
      }
      if (splitAt < maxLen * 0.3) {
        // No good newline — try a space
        splitAt = remaining.lastIndexOf(' ', maxLen);
      }
      if (splitAt < maxLen * 0.3) {
        // Give up and hard-cut
        splitAt = maxLen;
      }

      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }

    if (remaining.length > 0) {
      chunks.push(remaining);
    }

    return chunks;
  }

  /** Check if a message is from an allowed chat */
  private isAllowed(ctx: Context): boolean {
    const chatId = ctx.chat?.id;
    if (!chatId) return false;

    // If no allowlist configured, allow everyone (single-user mode)
    if (this.allowedChatIds.size === 0) {
      return true;
    }

    if (!this.allowedChatIds.has(chatId)) {
      console.log(`[telegram] Blocked message from unknown chat ID: ${chatId}. Add to allowlist if this is you.`);
      return false;
    }

    return true;
  }

  async start(): Promise<void> {
    console.log('[telegram] Starting bot...');

    // Get bot info (validates token)
    try {
      const me = await this.bot.api.getMe();
      console.log(`[telegram] Connected as @${me.username}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[telegram] Failed to connect: ${message}`);
      console.error('[telegram] Check your TELEGRAM_BOT_TOKEN in .env');
      return;
    }

    // Start polling (long-polling, not webhooks — simpler for self-hosted)
    this.bot.start({
      onStart: () => console.log('[telegram] Bot is running'),
      drop_pending_updates: true,
    });
  }

  stop(): void {
    this.bot.stop();
    console.log('[telegram] Bot stopped');
  }
}

/**
 * Create and start the Telegram transport if configured.
 */
export function startTelegram(gateway: Gateway, tokenEnv: string): TelegramTransport | null {
  const token = process.env[tokenEnv];

  if (!token) {
    console.warn(`[telegram] No bot token found (${tokenEnv} not set). Skipping.`);
    return null;
  }

  const transport = new TelegramTransport(gateway, { token });
  transport.start();

  return transport;
}
