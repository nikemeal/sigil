#!/usr/bin/env node

/**
 * Sigil TUI Client
 *
 * Connects to the running Sigil service via WebSocket and provides
 * a terminal chat interface. Run with: sigil tui
 *
 * This is a standalone process — Sigil runs in the background as a service,
 * and you connect/disconnect the TUI as needed without affecting it.
 */

import * as readline from 'node:readline';
import { WebSocket } from 'ws';

// ── Config ──────────────────────────────────────────────────────

const DEFAULT_URL = 'ws://127.0.0.1:3000/ws';
const url = process.argv[2] ?? process.env.SIGIL_WS_URL ?? DEFAULT_URL;

// ── Colours (inline to avoid chalk dependency in the client) ────

const c = {
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
};

// ── Main ────────────────────────────────────────────────────────

function main() {
  console.log(c.bold(c.cyan('\n  ╔══════════════════════════════╗')));
  console.log(c.bold(c.cyan('  ║')) + c.bold('       Sigil TUI v0.1.0       ') + c.bold(c.cyan('║')));
  console.log(c.bold(c.cyan('  ╚══════════════════════════════╝')));
  console.log(c.dim(`  Connecting to ${url}...\n`));

  const ws = new WebSocket(url);
  let connected = false;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // ── Connection lifecycle ────────────────────────────────────

  ws.on('open', () => {
    connected = true;
    console.log(c.dim('  Connected. Type a message to chat. Ctrl+C to disconnect.\n'));
    prompt();
  });

  ws.on('error', (err) => {
    if (!connected) {
      console.error(c.red('\n  Could not connect to Sigil.'));
      console.error(c.dim('  Is the service running? Check: sigil status'));
      console.error(c.dim(`  Tried: ${url}\n`));
      process.exit(1);
    }
    console.error(c.red(`\n  Connection error: ${err.message}`));
  });

  ws.on('close', () => {
    if (connected) {
      console.log(c.dim('\n  Disconnected from Sigil.'));
    }
    rl.close();
    process.exit(0);
  });

  // ── Incoming messages ───────────────────────────────────────

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'response') {
        // Clear the "thinking..." line
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);

        console.log(c.cyan('sigil > ') + msg.content);

        if (msg.actions?.length) {
          console.log(c.dim(`  [${msg.actions.length} tool action(s)]`));
        }
        console.log('');
        prompt();

      } else if (msg.type === 'notify') {
        // Async notification from a background task
        console.log('');
        console.log(c.yellow('  ── notification ──'));
        console.log(c.cyan('sigil > ') + msg.content);
        console.log('');
        prompt();

      } else if (msg.type === 'error') {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.error(c.red(`  Error: ${msg.content}`));
        console.log('');
        prompt();
      }
    } catch {
      // Non-JSON message, ignore
    }
  });

  // ── User input ──────────────────────────────────────────────

  function prompt() {
    rl.question(c.green('you > '), (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        prompt();
        return;
      }

      // Local commands (not sent to Sigil)
      if (trimmed === '/quit' || trimmed === '/exit') {
        console.log(c.dim('\n  Disconnecting...'));
        ws.close();
        return;
      }

      if (trimmed === '/help') {
        console.log(c.dim(`
  Commands:
    /quit, /exit  — Disconnect from Sigil (service keeps running)
    /help         — Show this help

  Everything else is sent to your Sigil agent.
        `));
        prompt();
        return;
      }

      // Send to Sigil
      if (ws.readyState !== WebSocket.OPEN) {
        console.error(c.red('  Not connected. Sigil may have restarted — try reconnecting.'));
        process.exit(1);
      }

      ws.send(JSON.stringify({ type: 'message', content: trimmed }));
      process.stdout.write(c.dim('  thinking...'));
    });
  }

  // ── Graceful exit ───────────────────────────────────────────

  rl.on('close', () => {
    ws.close();
  });

  process.on('SIGINT', () => {
    console.log(c.dim('\n  Disconnecting...'));
    ws.close();
  });
}

main();
