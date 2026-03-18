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
 * "queued" badges for messages waiting in line.
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

  // Track pending messages: messageId → status
  const pending = new Map<string, 'queued' | 'processing'>();

  // Track the messageId we're currently showing the spinner for
  let activeMessageId: string | null = null;

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('you > '),
  });

  /** Redraw the status line showing thinking + queued count */
  function redrawStatus(): void {
    stopSpinner();

    const processingCount = [...pending.values()].filter((s) => s === 'processing').length;
    const queuedCount = [...pending.values()].filter((s) => s === 'queued').length;

    if (processingCount === 0 && queuedCount === 0) {
      rl.prompt();
      return;
    }

    // Show spinner for the active message
    if (processingCount > 0) {
      const queueLabel = queuedCount > 0 ? chalk.yellow(` +${queuedCount} queued`) : '';
      spinnerFrame = 0;
      process.stdout.write(chalk.dim(SPINNER[0]) + queueLabel);
      spinnerInterval = setInterval(() => {
        spinnerFrame = (spinnerFrame + 1) % SPINNER.length;
        process.stdout.write(`\r\x1b[K${chalk.dim(SPINNER[spinnerFrame])}${queueLabel}`);
      }, 400);
    }
  }

  function stopSpinner(): void {
    if (spinnerInterval) {
      clearInterval(spinnerInterval);
      spinnerInterval = null;
    }
    process.stdout.write('\r\x1b[K');
  }

  ws.on('open', () => {
    connected = true;
    console.log(chalk.green('Connected to Sigil.'));
    console.log(chalk.dim('Type a message and press Enter. Ctrl+C to quit.\n'));
    rl.prompt();
  });

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString()) as ServerMessage;

      switch (data.type) {
        case 'status':
          if (data.messageId && data.status) {
            pending.set(data.messageId, data.status);
            redrawStatus();
          }
          break;

        case 'response':
          // Remove from pending
          if (data.messageId) pending.delete(data.messageId);

          stopSpinner();
          console.log(chalk.green('sigil > ') + data.content);
          if (data.model) {
            console.log(chalk.dim(`  [${data.model}]`));
          }
          console.log();

          // If more messages pending, redraw status; otherwise show prompt
          if (pending.size > 0) {
            redrawStatus();
          } else {
            rl.prompt();
          }
          break;

        case 'notification': {
          stopSpinner();
          const color = data.severity === 'error' ? chalk.red
            : data.severity === 'warn' ? chalk.yellow
            : chalk.blue;
          console.log(color(`[${data.severity}] `) + data.content);
          console.log();
          if (pending.size > 0) {
            redrawStatus();
          } else {
            rl.prompt();
          }
          break;
        }

        case 'error':
          if (data.messageId) pending.delete(data.messageId);
          stopSpinner();
          console.log(chalk.red('error > ') + data.content);
          console.log();
          if (pending.size > 0) {
            redrawStatus();
          } else {
            rl.prompt();
          }
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
      rl.prompt();
      return;
    }

    // Special commands
    if (input === '/quit' || input === '/exit') {
      ws.close();
      return;
    }

    if (input === '/help') {
      stopSpinner();
      console.log(chalk.dim('\nCommands:'));
      console.log(chalk.dim('  /quit, /exit  — Disconnect'));
      console.log(chalk.dim('  /help         — Show this help'));
      console.log();
      rl.prompt();
      return;
    }

    // Send message to server
    if (connected && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'message', content: input }));
    } else {
      console.log(chalk.red('Not connected to Sigil.'));
      rl.prompt();
    }
  });

  rl.on('close', () => {
    stopSpinner();
    ws.close();
    process.exit(0);
  });
}

main();
