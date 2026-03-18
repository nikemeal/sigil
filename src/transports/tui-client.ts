/**
 * TUI Client
 *
 * Standalone CLI process that connects to the running Sigil service via WebSocket.
 * This is what runs when you do `sigil tui`.
 *
 * The service runs headless in the background. This client connects to it,
 * sends messages, and displays responses. Multiple TUI clients can connect
 * simultaneously (they all see the same conversation).
 *
 * Shows real-time status: thinking indicator for active processing,
 * "queued" badges for messages waiting in line. The spinner pauses
 * when the user is typing so it doesn't interfere with input.
 */

import { createInterface } from 'node:readline';
import WebSocket from 'ws';
import chalk from 'chalk';

/** Server message format */
interface ServerMessage {
  type: 'response' | 'notification' | 'error' | 'status';
  content: string;
  model?: string;
  messageId?: string;
  severity?: string;
  status?: 'queued' | 'processing';
  position?: number;
}

// Config — in module 1 this is hardcoded, later reads from sigil.toml
const WS_URL = process.env.SIGIL_WS_URL ?? 'ws://127.0.0.1:3033/ws';

// Thinking indicator frames
const SPINNER = ['   thinking', '.  thinking', '.. thinking', '...thinking'];

function main(): void {
  console.log(chalk.dim(`Connecting to ${WS_URL}...`));

  const ws = new WebSocket(WS_URL);
  let connected = false;
  let spinnerInterval: ReturnType<typeof setInterval> | null = null;
  let spinnerFrame = 0;
  let userTyping = false;

  // Track pending messages: messageId → status
  const pending = new Map<string, 'queued' | 'processing'>();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('you > '),
  });

  /** Build the status suffix for queued messages */
  function queueSuffix(): string {
    const queuedCount = [...pending.values()].filter((s) => s === 'queued').length;
    return queuedCount > 0 ? chalk.yellow(` +${queuedCount} queued`) : '';
  }

  /** Show thinking spinner (only when user isn't typing) */
  function startSpinner(): void {
    stopSpinner();

    const processingCount = [...pending.values()].filter((s) => s === 'processing').length;
    if (processingCount === 0 || userTyping) return;

    const suffix = queueSuffix();
    spinnerFrame = 0;
    process.stdout.write(chalk.dim(SPINNER[0]) + suffix);
    spinnerInterval = setInterval(() => {
      spinnerFrame = (spinnerFrame + 1) % SPINNER.length;
      process.stdout.write(`\r\x1b[K${chalk.dim(SPINNER[spinnerFrame])}${suffix}`);
    }, 400);
  }

  function stopSpinner(): void {
    if (spinnerInterval) {
      clearInterval(spinnerInterval);
      spinnerInterval = null;
    }
    process.stdout.write('\r\x1b[K');
  }

  /** Show prompt and let the user type. Spinner is paused while typing. */
  function showPrompt(): void {
    stopSpinner();
    userTyping = true;
    rl.prompt();
  }

  /** After sending, give control back to the spinner */
  function afterSend(): void {
    userTyping = false;
    if (pending.size > 0) {
      startSpinner();
    } else {
      showPrompt();
    }
  }

  /** Handle incoming status/response — clear spinner, print, resume */
  function handleOutput(fn: () => void): void {
    stopSpinner();
    fn();
    if (pending.size > 0) {
      startSpinner();
    } else {
      showPrompt();
    }
  }

  ws.on('open', () => {
    connected = true;
    console.log(chalk.green('Connected to Sigil.'));
    console.log(chalk.dim('Type a message and press Enter. Ctrl+C to quit.\n'));
    showPrompt();
  });

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString()) as ServerMessage;

      switch (data.type) {
        case 'status':
          if (data.messageId && data.status) {
            pending.set(data.messageId, data.status);
            // Only update spinner if user isn't typing
            if (!userTyping) {
              stopSpinner();
              startSpinner();
            }
          }
          break;

        case 'response':
          if (data.messageId) pending.delete(data.messageId);
          handleOutput(() => {
            console.log(chalk.green('sigil > ') + data.content);
            if (data.model) {
              console.log(chalk.dim(`  [${data.model}]`));
            }
            console.log();
          });
          break;

        case 'notification':
          handleOutput(() => {
            const color = data.severity === 'error' ? chalk.red
              : data.severity === 'warn' ? chalk.yellow
              : chalk.blue;
            console.log(color(`[${data.severity}] `) + data.content);
            console.log();
          });
          break;

        case 'error':
          if (data.messageId) pending.delete(data.messageId);
          handleOutput(() => {
            console.log(chalk.red('error > ') + data.content);
            console.log();
          });
          break;
      }
    } catch {
      // Ignore malformed messages
    }
  });

  ws.on('close', () => {
    stopSpinner();
    if (connected) {
      console.log(chalk.yellow('\nDisconnected from Sigil.'));
    } else {
      console.log(chalk.red('Could not connect to Sigil. Is the service running?'));
      console.log(chalk.dim('Start it with: sigil start'));
    }
    process.exit(0);
  });

  ws.on('error', (err) => {
    stopSpinner();
    if (!connected) {
      console.log(chalk.red('Could not connect to Sigil. Is the service running?'));
      console.log(chalk.dim(`Error: ${err.message}`));
      console.log(chalk.dim('Start it with: sigil start'));
      process.exit(1);
    }
    console.error(chalk.red(`[WS Error] ${err.message}`));
  });

  rl.on('line', (line) => {
    const input = line.trim();
    if (!input) {
      showPrompt();
      return;
    }

    // Special commands
    if (input === '/quit' || input === '/exit') {
      ws.close();
      return;
    }

    if (input === '/help') {
      console.log(chalk.dim('\nCommands:'));
      console.log(chalk.dim('  /quit, /exit  — Disconnect'));
      console.log(chalk.dim('  /help         — Show this help'));
      console.log();
      showPrompt();
      return;
    }

    // Send message to server
    if (connected && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'message', content: input }));
      afterSend();
    } else {
      console.log(chalk.red('Not connected to Sigil.'));
      showPrompt();
    }
  });

  rl.on('close', () => {
    stopSpinner();
    ws.close();
    process.exit(0);
  });
}

main();
