# Sigil TODO

Tracks improvements and ideas across sessions. See PLAN.md for the full module roadmap.

## Onboarding
- [ ] Fetch models from Anthropic API when they add a models endpoint
- [ ] Validate API key works before writing config (make a test call)
- [ ] Section-by-section re-configuration (e.g. `sigil onboard --provider`)

## Module 1 Polish
- [ ] TUI client: read WS URL from sigil.toml instead of hardcoded default
- [ ] Graceful message when service is starting up (WS not ready yet)

## Up Next
- [ ] Module 2: Conversation Memory (SQLite, context engine, FTS5, living profile)
