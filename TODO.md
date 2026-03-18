# Sigil TODO

Tracks improvements and ideas across sessions. See PLAN.md for the full module roadmap.

## Onboarding
- [x] Fetch models from OpenAI-compatible providers (Ollama, etc.)
- [x] Section-by-section re-configuration on re-run
- [x] Memory & embeddings setup section
- [ ] Fetch models from Anthropic API (they have /v1/models now)
- [ ] Fetch models from OpenAI API (uses same /v1/models, just needs auth)
- [ ] Validate API key works before writing config (make a test call)

## Module 1 Polish
- [ ] TUI client: read WS URL from sigil.toml instead of hardcoded default
- [ ] Graceful message when service is starting up (WS not ready yet)

## Up Next
- [ ] Module 2: Conversation Memory (SQLite, context engine, FTS5, living profile)
