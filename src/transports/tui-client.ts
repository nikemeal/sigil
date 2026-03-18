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
 * Input is blocked while waiting for a response — keeps the display clean
 * and matches the sequential nature of conversation.
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
}

// Config — in module 1 this is hardcoded, later reads from sigil.toml
const WS_URL = process.env.SIGIL_WS_URL ?? 'ws://127.0.0.1:3033/ws';

const SPINNER = ['   thinking', '.  thinking', '.. thinking', '...thinking'];

function main(): void {
  console.log(chalk.dim(`Connecting to ${WS_URL}...`));

  const ws = new WebSocket(WS_URL);
  let connected = false;
  let waiting = false;
  let spinnerInterval: ReturnType<typeof setInterval> | null = null;
  let spinnerFrame = 0;

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('you > '),
  });

  function startSpinner(): void {
    waiting = true;
    spinnerFrame = 0;
    process.stdout.write(chalk.dim(SPINNER[0]));
    spinnerInterval = setInterval(() => {
      spinnerFrame = (spinnerFrame + 1) % SPINNER.length;
      process.stdout.write(`\r\x1b[K${chalk.dim(SPINNER[spinnerFrame])}`);
    }, 400);
  }

  function stopSpinner(): void {
    waiting = false;
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

      // Ignore status messages — we handle flow with waiting flag
      if (data.type === 'status') return;

      stopSpinner();

      switch (data.type) {
        case 'response':
          console.log(chalk.green('sigil > ') + data.content);
          if (data.model) {
            console.log(chalk.dim(`  [${data.model}]`));
          }
          break;

        case 'notification': {
          const color = data.severity === 'error' ? chalk.red
            : data.severity === 'warn' ? chalk.yellow
            : chalk.blue;
          console.log(color(`[${data.severity}] `) + data.content);
          break;
        }

        case 'error':
          console.log(chalk.red('error > ') + data.content);
          break;
      }

      console.log();
      rl.prompt();
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
    // Block input while waiting for response
    if (waiting) return;

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
      startSpinner();
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
