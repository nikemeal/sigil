/**
 * Simple .env Loader
 *
 * Reads .env file and sets process.env variables.
 * No dependencies — just reads lines and splits on first '='.
 * Skips comments (#) and empty lines.
 *
 * Called early in the entry point before config is loaded.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadEnv(): void {
  const envPath = resolve(process.cwd(), '.env');

  if (!existsSync(envPath)) return;

  try {
    const content = readFileSync(envPath, 'utf-8');

    for (const line of content.split('\n')) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Split on first '=' only
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;

      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();

      // Strip surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      // Don't overwrite existing env vars (explicit env takes priority)
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch (err) {
    console.warn('[Env] Failed to read .env file:', (err as Error).message);
  }
}
