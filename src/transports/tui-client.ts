/**
 * TUI Client
 *
 * Standalone CLI process that connects to the running Sigil service via WebSocket.
 * This is what runs when you do `sigil tui`.
 *
 * The service runs headless in the background. This client connects to it,
 * sends messages, and displays responses. Multiple TUI clients can connect
 * simultaneously (they all see the same conversation).
 */

import { createInterface } from 'node:readline';
import WebSocket from 'ws';
import chalk from 'chalk';

/** Server message format */
interface ServerMessage {
  type: 'response' | 'notification' | 'error';
  content: string;
  model?: string;
  messageId?: string;
  severity?: string;
}

// Config — in module 1 this is hardcoded, later reads from sigil.toml
const WS_URL = process.env.SIGIL_WS_URL ?? 'ws://127.0.0.1:3033/ws';

// Thinking indicator frames
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

  /** Show a thinking indicator on the current line */
  function startThinking(): void {
    waiting = true;
    spinnerFrame = 0;
    process.stdout.write(chalk.dim(SPINNER[0]));
    spinnerInterval = setInterval(() => {
      spinnerFrame = (spinnerFrame + 1) % SPINNER.length;
      // Move to start of line, clear it, write new frame
      process.stdout.write(`\r\x1b[K${chalk.dim(SPINNER[spinnerFrame])}`);
    }, 400);
  }

  /** Clear the thinking indicator */
  function stopThinking(): void {
    waiting = false;
    if (spinnerInterval) {
      clearInterval(spinnerInterval);
      spinnerInterval = null;
    }
    // Clear the thinking line
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

      stopThinking();

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

      console.log(); // blank line for readability
      rl.prompt();
    } catch {
      // Ignore malformed messages
    }
  });

  ws.on('close', () => {
    stopThinking();
    if (connected) {
      console.log(chalk.yellow('\nDisconnected from Sigil.'));
    } else {
      console.log(chalk.red('Could not connect to Sigil. Is the service running?'));
      console.log(chalk.dim('Start it with: sigil start'));
    }
    process.exit(0);
  });

  ws.on('error', (err) => {
    stopThinking();
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
      startThinking();
    } else {
      console.log(chalk.red('Not connected to Sigil.'));
      rl.prompt();
    }
  });

  rl.on('close', () => {
    stopThinking();
    ws.close();
    process.exit(0);
  });
}

main();
