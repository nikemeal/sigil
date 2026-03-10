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

        const response = await gateway.sendText(trimmed, 'tui');

        // Clear thinking indicator
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);

        // Show response
        console.log(chalk.cyan('sigil > ') + response.content);

        // Show tool actions if any
        if (response.actions && response.actions.length > 0) {
          console.log(chalk.dim(`  [${response.actions.length} tool action(s)]`));
        }

        console.log('');
      } catch (err) {
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
