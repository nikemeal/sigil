# Sigil TODO

Tracks improvements and ideas across sessions. See PLAN.md for the full module roadmap.

## Onboarding
- [ ] Fetch models from Anthropic API (they have /v1/models now)
- [ ] Fetch models from OpenAI API (uses same /v1/models, just needs auth)
- [ ] Validate API key works before writing config (make a test call)

## Polish
- [ ] TUI client: read WS URL from sigil.toml instead of hardcoded default
- [ ] Graceful message when service is starting up (WS not ready yet)

## Future Ideas
- [ ] Context trimming: make flexible/configurable beyond the fixed table
- [ ] Project tracking: compartmentalise user projects (vector DB, named contexts)
  - User works on multiple projects, agent should know which is active
  - Reference past projects by name
  - Separate memory/context per project, or cross-project recall
- [ ] Routing classifier learning: track classification accuracy over time
  - Pattern table: message patterns → actual complexity → token usage
  - Classifier improves with real usage data
