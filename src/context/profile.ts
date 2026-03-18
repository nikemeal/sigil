/**
 * Living Profile
 *
 * Agent's notebook about the user. Always present in the system prompt.
 * Stored as data/profile.md — the agent can read and write it.
 *
 * Unlike memories (which are searched), the profile is always included.
 * Reserve it for always-relevant information: name, key preferences,
 * communication style, important context.
 *
 * The agent updates this as it learns about the user.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DEFAULT_PROFILE = `# User Profile

*This is the agent's notebook about you. It updates as it learns your preferences.*

- No information yet. The agent will fill this in as you chat.
`;

export class Profile {
  private path: string;
  private content: string;

  constructor(profilePath: string) {
    this.path = profilePath;

    // Ensure directory exists
    const dir = dirname(this.path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Load or create
    if (existsSync(this.path)) {
      this.content = readFileSync(this.path, 'utf-8');
    } else {
      this.content = DEFAULT_PROFILE;
      this.save();
    }
  }

  /** Get the full profile content (for system prompt injection) */
  get(): string {
    return this.content;
  }

  /** Update the profile content and persist to disk */
  update(newContent: string): void {
    this.content = newContent;
    this.save();
  }

  /** Reload from disk (in case it was edited externally) */
  reload(): void {
    if (existsSync(this.path)) {
      this.content = readFileSync(this.path, 'utf-8');
    }
  }

  private save(): void {
    writeFileSync(this.path, this.content, 'utf-8');
  }
}
