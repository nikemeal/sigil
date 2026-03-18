#!/usr/bin/env bash
#
# Sigil Provisioning Script
#
# Sets up Sigil on a fresh Ubuntu/Debian system:
#   - Installs Node.js 22
#   - Creates a dedicated system user
#   - Sets up systemd service
#   - Creates the `sigil` CLI wrapper
#   - Configures log rotation
#
# Usage: sudo ./provision.sh [--install-dir /opt/sigil] [--user sigil]
#
# Also works on systems with Node.js already installed (skips that step).

set -euo pipefail

# ── Defaults ─────────────────────────────────────────────────────────
INSTALL_DIR="${INSTALL_DIR:-/opt/sigil}"
SIGIL_USER="${SIGIL_USER:-sigil}"
NODE_MAJOR=22

# ── Parse args ───────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --user) SIGIL_USER="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

echo "=== Sigil Provisioning ==="
echo "  Install dir: ${INSTALL_DIR}"
echo "  User:        ${SIGIL_USER}"
echo

# ── Must be root ─────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo "Error: Run this script with sudo."
  exit 1
fi

# ── Stop existing service if running ─────────────────────────────────
if systemctl is-active sigil &>/dev/null; then
  echo "Stopping existing Sigil service..."
  systemctl stop sigil
fi

# ── Install Node.js if not present ───────────────────────────────────
if command -v node &>/dev/null; then
  NODE_VER=$(node --version)
  echo "Node.js already installed: ${NODE_VER}"
else
  echo "Installing Node.js ${NODE_MAJOR}..."
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates gnupg
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs
  echo "Node.js $(node --version) installed."
fi

# ── Create system user ───────────────────────────────────────────────
if id "${SIGIL_USER}" &>/dev/null; then
  echo "User '${SIGIL_USER}' already exists."
else
  echo "Creating user '${SIGIL_USER}'..."
  useradd --system --shell /usr/sbin/nologin --home-dir "${INSTALL_DIR}" "${SIGIL_USER}"
fi

# ── Set up install directory ─────────────────────────────────────────
if [[ -d "${INSTALL_DIR}" ]]; then
  echo "Install directory exists, updating..."
else
  echo "Creating install directory..."
  mkdir -p "${INSTALL_DIR}"
fi

# Copy repo files (assumes running from repo root)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
rsync -a --exclude=node_modules --exclude=.git --exclude=data --exclude=local \
  "${SCRIPT_DIR}/" "${INSTALL_DIR}/"

# Create directories the agent needs
mkdir -p "${INSTALL_DIR}/data"
mkdir -p "${INSTALL_DIR}/local"

# Install dependencies
echo "Installing dependencies..."
cd "${INSTALL_DIR}"
npm install --production 2>&1 | tail -1

# Build (needed before onboarding can run)
echo "Building..."
npx tsc 2>&1 | tail -5

# Fix ownership
chown -R "${SIGIL_USER}:${SIGIL_USER}" "${INSTALL_DIR}"

# ── .env file ────────────────────────────────────────────────────────
if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
  echo "# Sigil environment variables" > "${INSTALL_DIR}/.env"
  echo "# ANTHROPIC_API_KEY=sk-..." >> "${INSTALL_DIR}/.env"
  chown "${SIGIL_USER}:${SIGIL_USER}" "${INSTALL_DIR}/.env"
  chmod 600 "${INSTALL_DIR}/.env"
  echo "Created .env file (edit to add your API key)."
fi

# ── Systemd service ──────────────────────────────────────────────────
echo "Setting up systemd service..."
cat > /etc/systemd/system/sigil.service << EOF
[Unit]
Description=Sigil AI Agent
After=network.target

[Service]
Type=simple
User=${SIGIL_USER}
Group=${SIGIL_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=/usr/bin/node ${INSTALL_DIR}/dist/index.js
Restart=on-failure
RestartSec=5

# Security
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${INSTALL_DIR}/data ${INSTALL_DIR}/local ${INSTALL_DIR}/skills

# Resource limits
MemoryMax=512M
CPUQuota=80%

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable sigil

# ── CLI wrapper ──────────────────────────────────────────────────────
echo "Installing 'sigil' CLI command..."
cat > /usr/local/bin/sigil << 'SIGIL_CLI'
#!/usr/bin/env bash
#
# Sigil CLI — manage your personal AI agent
#

INSTALL_DIR="${SIGIL_INSTALL_DIR:-/opt/sigil}"

case "${1:-help}" in
  start)
    sudo systemctl start sigil
    echo "Sigil started."
    ;;
  stop)
    sudo systemctl stop sigil
    echo "Sigil stopped."
    ;;
  restart)
    sudo systemctl restart sigil
    echo "Sigil restarted."
    ;;
  status)
    systemctl status sigil --no-pager
    ;;
  logs)
    journalctl -u sigil -f --no-pager -n "${2:-50}"
    ;;
  tui)
    cd "${INSTALL_DIR}" && node dist/transports/tui-client.js
    ;;
  onboard)
    cd "${INSTALL_DIR}" && sudo -u sigil node dist/onboard.js
    ;;
  config)
    ${EDITOR:-nano} "${INSTALL_DIR}/sigil.toml"
    ;;
  env)
    sudo ${EDITOR:-nano} "${INSTALL_DIR}/.env"
    ;;
  build)
    cd "${INSTALL_DIR}" && npx tsc
    echo "Build complete."
    ;;
  test)
    cd "${INSTALL_DIR}" && node dist/test.js
    ;;
  update)
    cd "${INSTALL_DIR}"
    echo "Pulling latest from git..."
    sudo -u sigil git pull
    sudo -u sigil npm install --production
    sudo -u sigil npx tsc
    sudo systemctl restart sigil
    echo "Updated and restarted."
    ;;
  help|*)
    echo "Usage: sigil <command>"
    echo
    echo "Commands:"
    echo "  start     Start the Sigil service"
    echo "  stop      Stop the Sigil service"
    echo "  restart   Restart the Sigil service"
    echo "  status    Show service status"
    echo "  logs [n]  Follow logs (last n lines, default 50)"
    echo "  tui       Connect terminal UI"
    echo "  onboard   Run setup wizard"
    echo "  config    Edit sigil.toml"
    echo "  env       Edit .env (API keys)"
    echo "  build     Compile TypeScript"
    echo "  test      Run basic tests"
    echo "  update    Pull latest and restart"
    ;;
esac
SIGIL_CLI

chmod +x /usr/local/bin/sigil

# ── Log rotation ─────────────────────────────────────────────────────
cat > /etc/logrotate.d/sigil << EOF
/var/log/journal/*sigil* {
  weekly
  rotate 4
  compress
  missingok
  notifempty
}
EOF

# ── Run onboarding ───────────────────────────────────────────────────
echo
echo "=== Provisioning complete ==="
echo

# Check if existing config is v2 format (has [[models]] section)
NEEDS_ONBOARD=true
if [[ -f "${INSTALL_DIR}/sigil.toml" ]]; then
  if grep -q '^\[\[models\]\]' "${INSTALL_DIR}/sigil.toml" 2>/dev/null; then
    NEEDS_ONBOARD=false
    echo "Valid v2 config found. To reconfigure: sigil onboard"
    echo "To start: sigil start"
    echo "To connect: sigil tui"
  else
    # Old v1 config — back it up so onboarding runs fresh
    BACKUP="${INSTALL_DIR}/sigil.toml.v1-backup"
    cp "${INSTALL_DIR}/sigil.toml" "${BACKUP}"
    rm "${INSTALL_DIR}/sigil.toml"
    echo "Old v1 config backed up to ${BACKUP}"
  fi
fi

if [[ "${NEEDS_ONBOARD}" == "true" ]]; then
  echo "Running onboarding wizard..."
  echo "(This will configure, build, and start Sigil)"
  echo
  cd "${INSTALL_DIR}" && sudo -u "${SIGIL_USER}" node dist/onboard.js
fi
echo
