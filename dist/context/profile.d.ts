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
export declare class Profile {
    private path;
    private content;
    constructor(profilePath: string);
    /** Get the full profile content (for system prompt injection) */
    get(): string;
    /** Update the profile content and persist to disk */
    update(newContent: string): void;
    /** Reload from disk (in case it was edited externally) */
    reload(): void;
    private save;
}
//# sourceMappingURL=profile.d.ts.map