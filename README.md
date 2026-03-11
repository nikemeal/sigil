# Sigil

A personal AI agent that runs on your own hardware. Not a chatbot — a coworker. Give it a task, it works autonomously in the background, and messages you back when it's done.

Sigil was built as a lean alternative to tools like [OpenClaw](https://github.com/openclaw/openclaw). Where OpenClaw tries to be everything for everyone (100k+ lines, 50+ integrations, complex multi-user setup), Sigil is designed for a single user, stays under 4,000 lines, and only does what you need it to.

## What it does

- **Autonomous task execution** — ask it to do something complex, it breaks the work into steps, executes them in the background, and messages you back with results
- **Self-scheduling** — the agent can create its own reminders, follow-ups, and recurring jobs without being prompted
- **Smart LLM routing** — uses a local model (Ollama) for simple tasks and a cloud model (Claude) for complex ones, keeping costs low and latency fast
- **Persistent memory** — remembers facts, preferences, and conversation context across sessions via SQLite
- **Self-extending** — if it needs a capability it doesn't have, it can write and load new tools at runtime
- **Self-improving** — logs what works and what doesn't, stores effective techniques, and gets better at recurring tasks over time
- **Hot-reloadable skills** — drop a markdown file into `/skills/` and the agent picks it up immediately

## Architecture

```
You (TUI / Web / Telegram / Discord)
         │
    ┌────▼────┐
    │ Gateway │──── notify back (async results)
    └────┬────┘
         │
    ┌────▼────┐     ┌──────────────┐
    │  Agent  │────▶│ Task System  │
    └────┬────┘     │ (background) │
         │          └──────┬───────┘
    ┌────▼────┐            │
    │  Smart  │      ┌─────▼──────┐
    │  Router │      │  Scheduler │
    └──┬───┬──┘      └────────────┘
       │   │
   ┌───┘   └───┐
   ▼           ▼
┌──────┐  ┌────────┐
│Local │  │ Cloud  │
│Ollama│  │ Claude │
└──────┘  └────────┘
```

## Requirements

- **Node.js 22+**
- **Ollama** (optional, for local LLM) — [install guide](https://ollama.ai)
- **Anthropic API key** (optional, for cloud LLM) — [get one here](https://console.anthropic.com)

You need at least one of Ollama or an API key. If both are available, Sigil routes intelligently between them. If only one is available, it uses that exclusively.

### Recommended local models

| Model | VRAM/RAM | Best for |
|-------|----------|----------|
| `qwen3:8b` | 8GB | Best all-rounder |
| `qwen3:14b` | 16GB | Near GPT-4 quality |
| `llama3.3:8b` | 8GB | General + coding |
| `mistral:7b` | 8GB | Fast chat |

## Quick start

```bash
git clone https://github.com/youruser/sigil.git
cd sigil
npm install

# Run the interactive setup wizard
npm run onboard

# Start Sigil
npm run dev
```

The onboarding wizard walks you through naming your agent, choosing LLM providers, setting up transports (Telegram, Discord, etc.), and configuring personal context.

### Manual setup

If you'd prefer to configure things by hand:

```bash
cp sigil.example.toml sigil.toml
# Edit sigil.toml with your preferences

export ANTHROPIC_API_KEY="sk-ant-..."  # if using cloud
ollama pull qwen3:8b                    # if using local

npm run dev
```

## Deploying on a server

Sigil is designed to run 24/7 on a small Linux box — an LXC container, a Raspberry Pi, a cheap VPS. A provisioning script is included for Ubuntu:

```bash
# On a fresh Ubuntu 24.04 machine
sudo ./provision.sh
```

This installs Node.js, creates a dedicated system user, sets up a systemd service with auto-restart, configures log rotation, and creates a `sigil` CLI wrapper for easy management:

```bash
sigil start        # start the service
sigil stop         # stop the service
sigil restart      # restart after config changes
sigil status       # check if running
sigil logs         # follow live logs
sigil config       # edit sigil.toml
sigil env          # edit API keys
sigil onboard      # re-run setup wizard
sigil update       # pull latest code + restart
sigil tasks        # list background tasks
```

### Connecting to Ollama on another machine

If Ollama runs on a separate host (e.g. another LXC on the same Proxmox node), update `sigil.toml`:

```toml
[llm.local]
model = "qwen3:8b"
base_url = "http://10.0.0.50:11434"  # Ollama host IP
```

Make sure Ollama is listening on all interfaces:

```bash
# In Ollama's systemd service or environment
OLLAMA_HOST=0.0.0.0 ollama serve
```

## Configuration

All configuration lives in a single `sigil.toml` file. See `sigil.example.toml` for the full reference with comments.

Key sections:

| Section | What it controls |
|---------|-----------------|
| `[identity]` | Agent name and personality |
| `[llm]` | Cloud model provider and settings |
| `[llm.local]` | Local model via Ollama |
| `[routing]` | How requests are split between local and cloud |
| `[memory]` | SQLite database path and recall settings |
| `[transports.*]` | Which interfaces are enabled (TUI, web, Telegram, Discord) |
| `[scheduler]` | Background task scheduling and timezone |
| `[tools]` | Tool allow/deny lists |

### Routing strategies

| Strategy | Behaviour |
|----------|-----------|
| `smart` | Analyses each message and routes based on complexity, context length, and tools needed |
| `local_first` | Always tries local, falls back to cloud on failure |
| `local_only` | Never calls cloud — fully offline, zero cost |
| `cloud_only` | Always uses cloud — ignores local model |
| `cloud_first` | Always uses cloud, local as fallback |

## Skills

Skills are markdown files in the `/skills/` directory that get injected into the agent's system prompt. They're hot-reloaded — drop a new file in and it's immediately available.

```markdown
<!-- skills/travel-planning.md -->
# Travel Planning

## Preferences
- Prefer direct flights where possible
- Budget range: mid-range, not luxury
- Always check visa requirements

## Useful APIs
- Skyscanner for flights
- Booking.com for hotels
```

The agent can also create its own skills via the `manage_skills` tool.

## Self-extension

When Sigil encounters a task it can't handle with its current tools, it can build new ones at runtime. The agent writes a JavaScript module, loads it dynamically, and uses it immediately — no restart needed.

Custom tools are saved to `skills/tools/` and persist across restarts.

The agent can also install npm packages it needs via `install_package` before creating a tool that depends on them.

## Learning

Sigil improves over time through a structured learning system:

1. Before complex work, it checks for relevant **techniques** it has previously discovered
2. After completing tasks, it **self-evaluates** with a score
3. If the score is low, it **iterates** with a different approach
4. Effective approaches are saved as techniques with a rolling effectiveness score
5. Next time a similar task comes up, it starts with the best known approach

Techniques and learning history are stored in SQLite and persist across restarts.

## Project structure

```
sigil/
├── sigil.toml                    # main config (create from .example)
├── provision.sh                  # server provisioning script
├── src/
│   ├── index.ts                  # entry point
│   ├── onboard.ts                # interactive setup wizard
│   ├── gateway/                  # message bus + types + config
│   ├── agent/                    # core agent loop
│   │   └── providers/            # LLM providers (Anthropic, Ollama, Router)
│   ├── context/                  # memory store + context assembly
│   ├── tasks/                    # background task system (store, runner, tools)
│   ├── scheduler/                # cron-based task scheduling
│   ├── skills/                   # skill loader, self-extension, learning
│   ├── tools/                    # built-in tools (shell, files, memory)
│   └── transports/               # TUI (+ web, telegram, discord planned)
├── skills/                       # your skill files (.md)
├── data/                         # SQLite database (auto-created)
└── tests/
```

## Built-in tools

| Tool | What it does |
|------|-------------|
| `shell_exec` | Run shell commands |
| `file_read` / `file_write` / `list_dir` | File operations |
| `remember` / `recall` | Long-term memory |
| `create_task` | Spawn background tasks |
| `schedule_self` | Self-schedule future work |
| `list_tasks` / `cancel_task` | Task management |
| `manage_skills` | View, create, and manage skills |
| `create_tool` | Write new tools at runtime |
| `install_package` | Install npm dependencies |
| `recall_techniques` / `save_technique` | Learning system |
| `log_attempt` / `review_past_attempts` | Self-evaluation history |

## Roadmap

- [ ] Web UI transport (React + WebSocket)
- [ ] Telegram transport
- [ ] Discord transport
- [ ] Vector embeddings for semantic memory recall
- [ ] Tool approval workflow for destructive actions
- [ ] Multi-agent delegation (sub-agents for parallel work)
- [ ] MCP (Model Context Protocol) server support

## Security considerations

Sigil runs as your user on your machine with access to shell commands and the filesystem. Keep the following in mind:

- **API keys** are stored in `.env` with restricted permissions, never in the config file
- **The web UI** binds to `127.0.0.1` by default — use a tunnel (Tailscale, Cloudflare) for remote access rather than exposing it directly
- **Shell execution** has configurable timeouts but no sandboxing by default
- **Self-created tools** run in the same process — review `skills/tools/` if you want to audit what the agent has built
- **The SQLite database** contains your conversations and memories — consider encrypting the volume if that matters to you

## Tech stack

| Component | Choice |
|-----------|--------|
| Language | TypeScript |
| Runtime | Node.js 22+ |
| Database | SQLite via better-sqlite3 |
| Cloud LLM | Anthropic Claude |
| Local LLM | Ollama |
| Config | TOML |
| Scheduling | node-cron |

## License

MIT
