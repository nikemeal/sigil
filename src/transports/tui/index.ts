import * as readline from 'node:readline';
import chalk from 'chalk';
import type { Gateway } from '../../gateway/gateway.js';

export function startTUI(gateway: Gateway): void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(chalk.bold.cyan('\n  ╔══════════════════════════════╗'));
  console.log(chalk.bold.cyan('  ║') + chalk.bold('        Sigil v0.1.0         ') + chalk.bold.cyan('║'));
  console.log(chalk.bold.cyan('  ╚══════════════════════════════╝'));
  console.log(chalk.dim('  Type a message to chat. Ctrl+C to exit.\n'));

  // Track state for interim/final message handling
  let awaitingResponse = false;
  let receivedInterim = false;

  // Register for cross-transport broadcasts and interim notifications
  gateway.onResponse('tui', (response) => {
    if (awaitingResponse) {
      // We're in the middle of a request — this is an interim message
      // from the agent ("I'll work on that..."). Show it immediately.
      receivedInterim = true;

      // Clear the "thinking..." indicator
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);

      console.log(chalk.yellow('sigil > ') + response.content);
      console.log(chalk.dim('  [working...]'));
      return;
    }

    // Not awaiting — this is an async notification (task complete, etc.)
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    console.log(chalk.magenta('sigil > ') + response.content);
    console.log('');
    rl.prompt();
  });

  const prompt = () => {
    rl.question(chalk.green('you > '), async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        prompt();
        return;
      }

      // Special commands
      if (trimmed === '/quit' || trimmed === '/exit') {
        console.log(chalk.dim('\nGoodbye.'));
        process.exit(0);
      }

      if (trimmed === '/clear') {
        console.clear();
        prompt();
        return;
      }

      if (trimmed === '/help') {
        console.log(chalk.dim(`
  Commands:
    /quit, /exit  — Exit Sigil
    /clear        — Clear screen
    /help         — Show this help
    /tools        — List available tools
        `));
        prompt();
        return;
      }

      try {
        // Show thinking indicator
        process.stdout.write(chalk.dim('  thinking...'));

        awaitingResponse = true;
        receivedInterim = false;
        const response = await gateway.sendText(trimmed, 'tui');
        awaitingResponse = false;

        if (receivedInterim) {
          // We already showed the interim. Now show the final result.
          // Clear the "[working...]" line
          readline.clearLine(process.stdout, 0);
          readline.cursorTo(process.stdout, 0);

          console.log(chalk.cyan('sigil > ') + response.content);
        } else {
          // Normal flow — no interim, just clear "thinking..." and show result
          readline.clearLine(process.stdout, 0);
          readline.cursorTo(process.stdout, 0);

          console.log(chalk.cyan('sigil > ') + response.content);
        }

        // Show tool actions if any
        if (response.actions && response.actions.length > 0) {
          console.log(chalk.dim(`  [${response.actions.length} tool action(s)]`));
        }

        console.log('');

        // Broadcast to all other transports (Telegram, web, etc.)
        gateway.broadcastExcept('tui', response);
      } catch (err) {
        awaitingResponse = false;
        receivedInterim = false;
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.error(chalk.red(`  Error: ${err instanceof Error ? err.message : err}`));
        console.log('');
      }

      prompt();
    });
  };

  prompt();

  rl.on('close', () => {
    console.log(chalk.dim('\nGoodbye.'));
    process.exit(0);
  });
}
