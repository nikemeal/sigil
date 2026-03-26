---
name: sigil-help
description: Help with Sigil configuration, commands, and troubleshooting
triggers: [sigil, config, setup, onboard, toml, configuration, settings, commands]
---

## Sigil Commands

- `sigil start` or `npm run dev` — start the service
- `sigil tui` or `npm run tui` — connect via terminal
- `sigil onboard` or `npm run onboard` — run setup wizard
- `sigil test` or `npm run test` — run diagnostics

## Configuration

Config lives in `sigil.toml`. Key sections:

- `[identity]` — agent name and personality
- `[[models]]` — LLM provider configuration (name, provider, model, tier, costs)
- `[memory]` — database path, recall settings, optional embedding model
- `[transports]` — TUI, web, Telegram settings
- `[skills]` — skill directory path and enabled list

## Message Prefixes

- `/local` — force local (free) model
- `/cloud` — force cloud (paid) model
- `/private` — force local model (network isolation)
- `/bg` — run as background task

## Troubleshooting

- No response: check that at least one model is configured and API key is set
- Telegram not working: verify bot token and allowed chat IDs in config
- Memory issues: check database path in `[memory]` section
- Skills not loading: ensure `.md` files in skills/ have valid frontmatter (name, description)
