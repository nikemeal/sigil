#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
#  Sigil — Provisioning Script for Ubuntu LXC
# ══════════════════════════════════════════════════════════════════
#
#  Run on a fresh Ubuntu 24.04 LXC:
#    curl -fsSL https://raw.githubusercontent.com/you/sigil/main/provision.sh | bash
#
#  Or copy to the LXC and run:
#    chmod +x provision.sh && sudo ./provision.sh
#
#  What this does:
#    1. System updates + essential packages
#    2. Creates a dedicated 'sigil' user
#    3. Installs Node.js 22 LTS
#    4. Clones and builds Sigil
#    5. Creates systemd service (auto-start, auto-restart)
#    6. Sets up log rotation
#    7. Drops you into the onboarding wizard
#
# ══════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────
SIGIL_USER="sigil"
SIGIL_HOME="/opt/sigil"
SIGIL_REPO="https://github.com/you/sigil.git"   # ← change this
SIGIL_BRANCH="main"
NODE_MAJOR=22
LOG_DIR="/var/log/sigil"

# Colours
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[sigil]${NC} $*"; }
warn() { echo -e "${YELLOW}[sigil]${NC} $*"; }
err()  { echo -e "${RED}[sigil]${NC} $*" >&2; }

# ── Pre-flight checks ───────────────────────────────────────────

if [[ $EUID -ne 0 ]]; then
  err "This script must be run as root (or with sudo)"
  exit 1
fi

log "Starting Sigil provisioning on $(hostname)"
log "OS: $(cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d '"')"

# ── 1. System packages ──────────────────────────────────────────

log "Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

log "Installing essentials..."
apt-get install -y -qq \
  curl \
  git \
  build-essential \
  ca-certificates \
  gnupg \
  sqlite3 \
  jq \
  unzip \
  logrotate

# ── 2. Create dedicated user ────────────────────────────────────

if id "$SIGIL_USER" &>/dev/null; then
  log "User '$SIGIL_USER' already exists"
else
  log "Creating user '$SIGIL_USER'..."
  useradd --system --create-home --home-dir "$SIGIL_HOME" --shell /bin/bash "$SIGIL_USER"
fi

# ── 3. Install Node.js 22 ───────────────────────────────────────

if command -v node &>/dev/null && [[ "$(node -v)" == v${NODE_MAJOR}.* ]]; then
  log "Node.js $(node -v) already installed"
else
  log "Installing Node.js ${NODE_MAJOR}..."
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg

  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list

  apt-get update -qq
  apt-get install -y -qq nodejs

  log "Node.js $(node -v) installed, npm $(npm -v)"
fi

# ── 4. Clone and build Sigil ────────────────────────────────────

if [[ -d "${SIGIL_HOME}/src" ]]; then
  log "Sigil source already exists, pulling latest..."
  cd "$SIGIL_HOME"
  # Fix ownership warning when running as root on a user-owned repo
  git config --global --add safe.directory "$SIGIL_HOME"
  sudo -u "$SIGIL_USER" git config --global --add safe.directory "$SIGIL_HOME"
  sudo -u "$SIGIL_USER" git pull --ff-only || warn "Git pull failed, continuing with existing code"
else
  log "Cloning Sigil..."
  # If the repo doesn't exist yet (local dev), set up the directory manually
  if git ls-remote "$SIGIL_REPO" &>/dev/null; then
    sudo -u "$SIGIL_USER" git clone --branch "$SIGIL_BRANCH" "$SIGIL_REPO" "$SIGIL_HOME"
  else
    warn "Repository not reachable. Setting up local directory structure..."
    # Assume files have been copied to SIGIL_HOME already
    if [[ ! -f "${SIGIL_HOME}/package.json" ]]; then
      err "No package.json found at ${SIGIL_HOME}. Copy Sigil source files there first."
      err "  scp -r ./sigil/* root@<lxc-ip>:${SIGIL_HOME}/"
      exit 1
    fi
  fi
fi

cd "$SIGIL_HOME"

# Ensure ownership
chown -R "${SIGIL_USER}:${SIGIL_USER}" "$SIGIL_HOME"

log "Installing dependencies..."
sudo -u "$SIGIL_USER" npm install --production=false 2>&1 | tail -1

log "Building..."
if sudo -u "$SIGIL_USER" npx tsc 2>&1; then
  log "Build successful"
else
  warn "TypeScript build had issues — will use tsx for runtime (dev mode)"
fi

# Create data directory
sudo -u "$SIGIL_USER" mkdir -p "${SIGIL_HOME}/data"
sudo -u "$SIGIL_USER" mkdir -p "${SIGIL_HOME}/skills"

# ── 5. Environment file ─────────────────────────────────────────

ENV_FILE="${SIGIL_HOME}/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  log "Creating environment file..."
  cat > "$ENV_FILE" << 'ENVEOF'
# Sigil environment variables
# Add your API keys here — this file is read by the systemd service.

# Cloud LLM (Anthropic) — optional if using local-only mode
# ANTHROPIC_API_KEY=sk-ant-...

# Telegram bot token — get from @BotFather
# TELEGRAM_BOT_TOKEN=

# Discord bot token — get from Discord Developer Portal
# DISCORD_BOT_TOKEN=
ENVEOF

  chown "${SIGIL_USER}:${SIGIL_USER}" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  log "Edit ${ENV_FILE} to add your API keys"
fi

# ── 6. Systemd service ──────────────────────────────────────────

log "Creating systemd service..."

cat > /etc/systemd/system/sigil.service << EOF
[Unit]
Description=Sigil — Personal AI Agent
Documentation=https://github.com/you/sigil
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SIGIL_USER}
Group=${SIGIL_USER}
WorkingDirectory=${SIGIL_HOME}
EnvironmentFile=${ENV_FILE}

# Use tsx in dev (if tsc build failed), node in production
ExecStart=/usr/bin/npx tsx src/index.ts
# For production (after successful tsc build), use:
# ExecStart=/usr/bin/node dist/index.js

# Restart policy — always restart unless explicitly stopped
Restart=on-failure
RestartSec=10
StartLimitIntervalSec=300
StartLimitBurst=5

# Graceful shutdown (SIGINT → 30s timeout → SIGKILL)
KillSignal=SIGINT
TimeoutStopSec=30

# Security hardening
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=${SIGIL_HOME}/data ${SIGIL_HOME}/skills ${LOG_DIR}
PrivateTmp=yes

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=sigil

# Resource limits (adjust if needed)
MemoryMax=512M
TasksMax=64

[Install]
WantedBy=multi-user.target
EOF

# ── 7. Log rotation ─────────────────────────────────────────────

log "Setting up log rotation..."

mkdir -p "$LOG_DIR"
chown "${SIGIL_USER}:${SIGIL_USER}" "$LOG_DIR"

cat > /etc/logrotate.d/sigil << EOF
/var/log/sigil/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 ${SIGIL_USER} ${SIGIL_USER}
}
EOF

# ── 8. Helper scripts ───────────────────────────────────────────

log "Creating helper scripts..."

# sigil CLI wrapper
cat > /usr/local/bin/sigil << 'SCRIPT'
#!/usr/bin/env bash
# Quick helper for managing Sigil

case "${1:-}" in
  start)
    sudo systemctl start sigil
    echo "Sigil started"
    ;;
  stop)
    sudo systemctl stop sigil
    echo "Sigil stopped"
    ;;
  restart)
    sudo systemctl restart sigil
    echo "Sigil restarted"
    ;;
  status)
    systemctl status sigil --no-pager
    ;;
  logs)
    journalctl -u sigil -f --no-pager "${@:2}"
    ;;
  logs-recent)
    journalctl -u sigil --since "1 hour ago" --no-pager
    ;;
  config)
    ${EDITOR:-nano} /opt/sigil/sigil.toml
    ;;
  env)
    sudo ${EDITOR:-nano} /opt/sigil/.env
    ;;
  onboard)
    cd /opt/sigil && sudo -u sigil npx tsx src/onboard.ts
    ;;
  update)
    echo "Pulling latest..."
    cd /opt/sigil
    # Ensure sigil user owns everything (fixes clones done as root/other users)
    sudo chown -R sigil:sigil /opt/sigil
    sudo -u sigil git config --global --add safe.directory /opt/sigil 2>/dev/null
    sudo -u sigil git pull --ff-only
    sudo -u sigil npm install
    sudo systemctl restart sigil
    echo "Updated and restarted"
    ;;
  db)
    sqlite3 /opt/sigil/data/memory.db "${@:2}"
    ;;
  tasks)
    sqlite3 /opt/sigil/data/memory.db \
      "SELECT substr(id,1,8) as id, status, substr(objective,1,60) as objective, updated_at FROM tasks ORDER BY updated_at DESC LIMIT 20;"
    ;;
  tui)
    cd /opt/sigil && npx tsx src/transports/tui-client.ts "${@:2}"
    ;;
  health)
    echo "Running health checks..."
    cd /opt/sigil && npx tsx -e "
      const ws = new (await import('ws')).WebSocket('ws://127.0.0.1:3000/ws');
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'message', content: 'Run a full health check on all systems and report the results.' }));
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'response') { console.log(msg.content); ws.close(); }
      });
      ws.on('error', () => { console.error('Cannot connect — is Sigil running?'); process.exit(1); });
      setTimeout(() => { console.error('Timeout'); process.exit(1); }, 30000);
    "
    ;;
  *)
    echo "Usage: sigil {start|stop|restart|status|logs|logs-recent|config|env|onboard|update|tui|db|tasks}"
    echo ""
    echo "  start        Start Sigil service"
    echo "  stop         Stop Sigil service"
    echo "  restart      Restart Sigil service"
    echo "  status       Show service status"
    echo "  logs         Follow live logs"
    echo "  logs-recent  Show last hour of logs"
    echo "  config       Edit sigil.toml"
    echo "  env          Edit API keys (.env)"
    echo "  onboard      Run onboarding wizard"
    echo "  update       Pull latest code and restart"
    echo "  tui          Open terminal chat (connects to running service)"
    echo "  health       Run health checks on all systems"
    echo "  db [sql]     Query the SQLite database"
    echo "  tasks        List recent tasks"
    ;;
esac
SCRIPT

chmod +x /usr/local/bin/sigil

# ── 9. Systemd reload ───────────────────────────────────────────

log "Enabling Sigil service..."
systemctl daemon-reload
systemctl enable sigil.service

# ── 10. Firewall (if ufw is active) ─────────────────────────────

if command -v ufw &>/dev/null && ufw status | grep -q "active"; then
  log "Configuring firewall..."
  # Web UI (only if enabled — localhost by default, but open if user changes host)
  # ufw allow 3000/tcp comment "Sigil Web UI"
  warn "UFW is active. If you enable the web UI on 0.0.0.0, run: ufw allow 3000/tcp"
fi

# ══════════════════════════════════════════════════════════════════
#  Done
# ══════════════════════════════════════════════════════════════════

echo ""
echo -e "${CYAN}  ╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}  ║${NC}          Sigil provisioning complete!               ${CYAN}║${NC}"
echo -e "${CYAN}  ╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${GREEN}Next steps:${NC}"
echo ""
echo "  1. Add your API keys:"
echo "     sigil env"
echo ""
echo "  2. Run the onboarding wizard:"
echo "     sigil onboard"
echo ""
echo "  3. Start Sigil:"
echo "     sigil start"
echo ""
echo "  4. Watch the logs:"
echo "     sigil logs"
echo ""
echo -e "  ${YELLOW}Useful commands:${NC}"
echo "     sigil status       — check if it's running"
echo "     sigil restart      — restart after config changes"
echo "     sigil config       — edit sigil.toml"
echo "     sigil tasks        — see background tasks"
echo "     sigil update       — pull latest + restart"
echo ""
echo -e "  ${YELLOW}Ollama connection:${NC}"
echo "  If Ollama is on another LXC/VM on the same Proxmox host,"
echo "  set the base_url in sigil.toml to its IP, e.g.:"
echo "     http://10.0.0.50:11434"
echo ""
echo "  Make sure Ollama is listening on 0.0.0.0:"
echo "     OLLAMA_HOST=0.0.0.0 ollama serve"
echo "  Or in Ollama's systemd service:"
echo "     Environment=\"OLLAMA_HOST=0.0.0.0\""
echo ""
