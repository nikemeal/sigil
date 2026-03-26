# Sigil — Project Plan

## Core Principle

**Everything optional gracefully degrades. The baseline experience needs only an LLM API key.**

Clone the repo, set an API key (Anthropic, OpenAI, or any OpenAI-compatible service), run it. Everything works. Multiple models, Ollama, InvokeAI, Whisper, and other local services enhance the experience but are never required.

---

## File Architecture: src/ vs local/

Two code directories, upstream and agent-owned:

```
sigil/
├── src/              ← upstream repo code. NEVER modified by the agent.
│                       Always clean for git pulls.
├── local/            ← agent modifications. Gitignored. Overrides src/.
│   ├── src/          ← patched/overridden source files (mirrors src/ structure)
│   ├── tools/        ← agent-created tools
│   └── extensions/   ← agent-created modules
├── skills/           ← knowledge files (markdown). Agent can read/write.
├── data/             ← SQLite DB, profile, persisted state. Gitignored.
└── sigil.toml        ← config. Gitignored.
```

**How loading works:** Every module import checks `local/src/` first, falls back to `src/`. If the agent patches `gateway.ts` during self-repair, it writes to `local/src/gateway/gateway.ts` which takes priority over `src/gateway/gateway.ts`.

**Why this matters:**
- `sigil update` always works — it only touches `src/`, no merge conflicts ever
- Self-repair is safe — worst case, `rm -rf local/` restores clean upstream
- Agent-created tools and extensions persist across updates
- After an update, the agent reviews `local/` overrides against new `src/` and removes any that are no longer needed (upstream fixed the issue)

**Rules:**
- The agent NEVER modifies files in `src/`
- The agent CAN read all files in `src/` (for self-diagnosis)
- The agent CAN write to `local/`, `skills/`, and `data/`
- `local/` is gitignored — it's unique to each installation
- Skills are NOT gitignored — they ship with the repo and can be community-shared

---

## Memory Architecture

Three layers, each serving a different purpose:

### Layer 1: Conversation Context (short-term, in-memory)
What you said 3 messages ago. Raw conversation history sent to the LLM.
- Last ~20 messages: kept verbatim
- Messages 20-50: summarised into a paragraph
- Messages 50+: compressed to bullet points or dropped
- Compression is continuous, not threshold-based
- Persisted to SQLite between restarts (compacted form)
- Single 'main' thread shared across all transports

### Layer 2: Long-term Memory (recall, SQLite)
Structured facts: "birthday is May 15th", "prefers dark mode."
- Stored via `remember` tool (agent decides what's worth keeping)
- Retrieved automatically: context engine searches on every message
- Dual retrieval:
  - FTS5 (keyword search) — always available, zero dependencies
  - Vector embeddings (semantic search) — activates when embedding provider configured
  - Falls back to FTS5-only when no embedding provider available
- Memory decay: relevance score decreases over time unless accessed
- Top matches injected into system prompt per-request

### Layer 3: Living Profile (always in context)
Agent's notebook about the user. Always present in system prompt.
- Stored as `data/profile.md`, agent can read and write it
- Updated by the agent as it learns preferences
- Not searched — always included. Reserved for always-relevant information.

### Context Window Assembly (per request)
```
┌─────────────────────────────────────────┐
│ SYSTEM PROMPT (scaled to request type)  │
│  - Agent identity and personality       │
│  - Living profile (always present)      │
│  - Environment notes (if needed)        │
│  - Tool guidance (if tools needed)      │
│  - Active skills (if relevant)          │
├─────────────────────────────────────────┤
│ RECALLED MEMORIES (searched per-message)│
│  - 0-5 relevant facts from FTS5/vector  │
├─────────────────────────────────────────┤
│ COMPRESSED HISTORY (if needed)          │
│  - Summary of older conversation        │
├─────────────────────────────────────────┤
│ RECENT MESSAGES (verbatim)              │
│  - Last 5-20 messages depending on type │
├─────────────────────────────────────────┤
│ CURRENT MESSAGE                         │
└─────────────────────────────────────────┘
```

---

## LLM Provider Architecture

### Provider Implementations

1. **Anthropic** — native Anthropic API (Claude models)
2. **OpenAI-compatible** — covers OpenAI, Ollama, LM Studio, Groq, Together AI, Azure OpenAI, Mistral, local llama.cpp, anything with `/v1/chat/completions`
3. **Google** — Gemini (future, lower priority)

### Model Pool

```toml
[[models]]
name = "opus"
provider = "anthropic"
model = "claude-opus-4-6"
tier = "full"
cost_per_1k_input = 0.015
cost_per_1k_output = 0.075
use_for = ["complex_reasoning", "code_review", "planning_review"]

[[models]]
name = "sonnet"
provider = "anthropic"
model = "claude-sonnet-4-20250514"
tier = "standard"
cost_per_1k_input = 0.003
cost_per_1k_output = 0.015
use_for = ["general", "writing", "tool_use"]

[[models]]
name = "haiku"
provider = "anthropic"
model = "claude-haiku-4-5-20251001"
tier = "basic"
cost_per_1k_input = 0.0008
cost_per_1k_output = 0.004
use_for = ["planning", "classification", "summarisation", "extraction"]

[[models]]
name = "local"
provider = "openai-compatible"
base_url = "http://10.0.0.50:11434"
model = "qwen3:8b"
tier = "basic"
cost_per_1k_input = 0
cost_per_1k_output = 0
use_for = ["chat", "simple_tool_use"]
```

### Model Capability Tiers

| Tier | Context | Tools | Multi-step | Examples |
|------|---------|-------|------------|---------|
| **Minimal** | ≤8k | 2-3 max | No | Small 1-3B, CPU-only |
| **Basic** | 8-32k | 3-5 max | Simple | 7-8B, Haiku, small cloud |
| **Standard** | 32-128k | 10+ | Yes | 14B+, Sonnet, GPT-4o-mini |
| **Full** | 128k+ | Unlimited | Complex | Opus, GPT-4, large cloud |

### Routing Modes

**1. Single Model (modules 1-4):** One model, context trimmed per request type.

**2. Auto-Route (module 5):** Pick best model per request based on complexity analysis.

**3. Orchestrated (module 6+):** Planner model breaks tasks into steps, assigns optimal model per step. Only for multi-step work — simple requests skip planning.

### Context Trimming Per Request

| Type | System prompt | Memories | History | Tools | Model |
|------|--------------|----------|---------|-------|-------|
| Casual chat | Identity + profile | None | Last 5 msgs | None | Cheapest |
| Quick question | Identity + profile | Relevant | Last 5 msgs | None | Cheapest |
| Tool request | + tool guidance | Relevant | Last 10 msgs | 2-3 relevant | Mid-tier |
| Complex task | Full + skills | All relevant | Full compacted | All available | Top-tier |
| Orchestrated step | Step-specific | Step-specific | Task context | Step-specific | Per-plan |

### Rate Limiting + Backoff
All providers: exponential backoff on 429/500/503, provider-specific headers respected.

---

## Build Order

### Module 1: Skeleton + Config + TUI
**You can:** Chat with your agent in the terminal.
- Core types and interfaces
- Event bus (pub/sub for all inter-component communication)
- Config loader (sigil.toml)
  - Model pool config structure (single model to start, supports multiple)
- Module loader with local/ override support (checks local/src/ first, falls back to src/)
- Gateway (message routing via event bus)
- LLM provider interface + Anthropic + OpenAI-compatible providers
  - Rate limiting with exponential backoff
- Agent core (single-turn, no tools, single model)
- WS server (Fastify + WebSocket on localhost)
- TUI client (standalone CLI)
- Onboarding wizard (agent name, personality, provider + key)
- Provisioning script + Dockerfile + docker-compose.yml
- Version tracking
- Basic test script (`sigil test`)

**Test:** `sigil start`, `sigil tui`, send message, get reply.

### Module 2: Conversation Memory
**You can:** Multi-turn conversations with context.
- SQLite setup
- Conversation thread (single 'main')
- Context engine: system prompt + progressive compression + FTS5 + optional vectors
- Memory decay
- Living profile (data/profile.md)
- Conversation persistence
- Context trimming per request type

**Test:** Context maintained across turns. Restart preserves history. Long conversations stay manageable.

### Module 3: Telegram Transport
**You can:** Message from phone. Consolidated across TUI and Telegram.
- Telegram bot (grammy, long-polling)
- Chat ID persistence
- Cross-transport broadcast via event bus
- Channel-aware responses (concise on Telegram)

**Test:** TUI ↔ Telegram. No duplicates. Appropriate response length per transport.

### Module 4: Tools
**You can:** Agent runs commands, manages files, remembers facts.
- Tool registry, multi-round tool calling
- Tool events via event bus
- Built-in: shell_exec, file_read, file_write, list_dir, remember, recall
- Approval framework (configurable autonomy)

**Test:** Shell commands, memory storage/recall across restarts.

### Module 5: Smart Routing + Multi-Model
**You can:** Multiple models, intelligent routing, context trimming.
- Model pool, auto-route mode
- Request analysis (predict complexity before executing)
- Context trimming (the cost saver)
- Model tier detection + adaptive tool limiting
- Explicit overrides (/local, /cloud, /private)
- Cost tracking
- Transparency tools: "why did you route that to Claude?"

**Test:** Routing decisions visible in logs. Cost estimates. Manual overrides work.

### Module 6: Background Tasks + Orchestration
**You can:** Complex work in background. Multi-model orchestration.
- Task store, runner, scheduler
- Task events via event bus
- Orchestrated routing: planner assigns models to steps
- Natural acknowledgements: "I'll dig into this and get back to you"
- Async notifications via broadcast

**Test:** "Research X and message me back." Watch model assignments. Cost breakdown.

### Module 7: Skills + Onboarding Expansion
**You can:** Domain knowledge via markdown. Full guided setup.
- Skill loader (hot-reload)
- Format compatible with OpenClaw/Claude Code
- Full onboarding expansion

**Test:** Drop skill, ask about it. Clean install onboarding.

### Module 8: Health + Self-Monitoring
**You can:** Monitors systems, alerts on failures, self-heals.
- Health monitor, scheduled checks, self-healing
- Health events, notification preferences

**Test:** Disable provider → alert. Kill Telegram → recover.

### Module 9: Self-Diagnosis + Self-Repair
**You can:** Agent reads its code, fixes issues, verifies fixes.
- Reads from `src/`, writes fixes to `local/src/`
- Never touches upstream code
- Sandboxed testing before applying
- Audit trail, git commits on local branch
- Repair loop (max 3-4 attempts)
- After `sigil update`: reviews local/ overrides, removes fixed ones
- Escape hatch: `rm -rf local/` restores clean upstream

**Test:** Break something, tell agent, watch it fix via local override.

### Module 10: Self-Extension + Skill Authoring
**You can:** Agent builds new tools and skills.
- Tools written to `local/tools/`
- Skill self-authoring (knowledge, tool, composite)
- Discovery chain: existing → MCP → build → save

**Test:** "Create a Bitcoin price tool." Use it.

### Module 11: Learning + Self-Improvement
**You can:** Agent improves at recurring tasks.
- Technique store, self-evaluation, iteration

**Test:** Same task twice, second uses learned approach.

### Module 12: Auto-Updater
**You can:** Checks for and applies updates.
- Git pull on `src/` only — never conflicts with `local/`
- After update: agent reviews local/ overrides against new src/
- Auto or notify mode

**Test:** Push commit, update applies cleanly even with local overrides present.

---

## Wishlist

Built after core modules. Ordered by usefulness.

### Conversation Compression + Context Caching
- Continuous compression, token budget tracking
- Prompt caching where provider supports it

### MCP Client
- Connect to MCP servers, discover tools
- First resort before custom tools
- Priority: Calendar, Gmail, GitHub, Drive, Chrome MCP

### Cost Tracking + Budgeting
- Per-request, daily/monthly, budget limits
- Orchestration cost comparison
- Cost-aware routing

### Proactive Behaviours + Heartbeat
- Periodic assessment, follow-up tagging
- Configurable proactiveness, quiet hours

### Daily/Weekly Auto-Summaries
- Tasks, conversations, learnings, costs

### Notification Preferences
- Per-severity, per-type, quiet hours

### Privacy Mode
- Force local-only, /private trigger

### Rich Output
- Code blocks, charts, tables, images per transport

### Browser Automation
- Puppeteer/Playwright or Chrome MCP

### Webhook Ingestion
- HTTP endpoint for Sentry, GitHub, monitors

### File + Document Processing
- PDFs, spreadsheets, images via Telegram

### Image Generation (InvokeAI)
- Local or cloud, generate → send

### Voice Notes (Whisper + TTS)
- Telegram voice → transcribe → process → optional voice response

### Codebase Awareness
- Git repos, PRs, tests, side projects

### Tailscale Integration
- Remote access without port forwarding

### Sandbox Execution
- Isolated environment for untrusted code

### Transparency Tools
- "Why did you route that?" / "Show me your system prompt" / "How much context did you send?"
- Debugging and trust-building

### Multi-Channel Context Merging
- Synthesise across sources via MCP

### Graceful Degradation
- Provider failover, tool workarounds, transport queuing

### Audit Trail
- Every modification logged via event bus

### Vector Embeddings
- Activates with embedding provider, FTS5 fallback

### AI Service Integration (LAN)
- Ollama, InvokeAI, Whisper, TTS

### Smart Home
- Home Assistant via MCP

### Skill Format + Sharing
- OpenClaw/Claude Code compatible, community shareable

### Additional Transports
- Added as needed, Discord likely next

---

## Design Principles

1. **Test on real hardware before moving on.**
2. **Each module extends, never rewrites.**
3. **Agent-readable code.** Clean files, good comments.
4. **One thread, shared context.** All transports share 'main'.
5. **Broadcast by default.** Responses to all active transports.
6. **Fail gracefully.** Component down, rest works.
7. **Config grows with modules.**
8. **Prefer existing services.** MCP and local APIs first.
9. **Cost awareness.** Trim context, route cheaply, track spend.
10. **Agent owns its evolution.** Reads plan, suggests next, helps build.
11. **Event-driven.** Components communicate via events.
12. **Adapt to user.** Living prompt, learned preferences.
13. **Everything optional degrades gracefully.** Baseline = one API key.
14. **Smart about resources.** Match model and context to request.
15. **Right model for the job.** Cheap plans, expensive reasons.
16. **Upstream is sacred.** Agent never modifies src/. Self-repair lives in local/.
