/**
 * Configuration Loader
 *
 * Reads sigil.toml, merges with defaults, and returns a typed SigilConfig.
 * Config grows with each module — new sections are added with sensible defaults
 * so existing installs don't break on update.
 *
 * TOML uses snake_case, TypeScript uses camelCase. Conversion happens here.
 */
import type { SigilConfig } from '../types.js';
/**
 * Load and validate configuration from sigil.toml.
 * Returns defaults merged with whatever the user has configured.
 * Missing file is not an error — we return defaults (onboarding will create the file).
 */
export declare function loadConfig(): SigilConfig;
//# sourceMappingURL=config.d.ts.map