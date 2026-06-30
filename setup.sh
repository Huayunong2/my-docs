#!/usr/bin/env bash
# daily-summary one-command deploy / upgrade script.
#
# Fast incremental deploy:
#   ./setup.sh 1.2.3.4
#
# First install / repair system integration:
#   ./setup.sh --bootstrap 1.2.3.4
#
# Custom project path:
#   APP_DIR=/root/MyDocs/daily-summary ./setup.sh 1.2.3.4

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$SCRIPT_DIR}"
SERVICE_NAME="${SERVICE_NAME:-daily-summary}"
ENV_FILE="$APP_DIR/server/.env"
SERVER_BIN="$APP_DIR/server/target/release/daily-summary"
BOOTSTRAP=0
FORCE_DEPS=0
FORCE_SYSTEMD=0
NO_BACKUP=0
HOST=""

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

STEPS=()
TOKEN=""
MODE=""
PUBLIC_URL=""
API_URL=""
BIND_ADDR=""

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

info() {
  echo "==> $*"
}

record_step() {
  STEPS+=("$1")
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

usage() {
  cat <<EOF
Usage:
  ./setup.sh [options] <public-ip-or-domain>

Examples:
  ./setup.sh 1.2.3.4
  ./setup.sh --bootstrap 1.2.3.4
  ./setup.sh your.domain.com
  APP_DIR=/root/MyDocs/daily-summary ./setup.sh 1.2.3.4

Options:
  --bootstrap       First install / repair dependencies, systemd, firewall or Caddy
  --force-deps      Force dependency checks and apt-get update
  --force-systemd   Force rewrite systemd service
  --no-backup       Skip pre-upgrade SQLite snapshot
  -h, --help        Show this help

Environment overrides:
  APP_DIR=/path/to/project
  SERVICE_NAME=daily-summary
  FORCE_NEW_TOKEN=1
  SKIP_DEP_INSTALL=1
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --bootstrap)
      BOOTSTRAP=1
      ;;
    --force-deps)
      FORCE_DEPS=1
      ;;
    --force-systemd)
      FORCE_SYSTEMD=1
      ;;
    --no-backup)
      NO_BACKUP=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      fail "Unknown option: $1"
      ;;
    *)
      if [ -n "$HOST" ]; then
        fail "Only one public IP or domain can be provided"
      fi
      HOST="$1"
      ;;
  esac
  shift
done

if [ -z "$HOST" ]; then
  usage
  exit 1
fi

[ -d "$APP_DIR" ] || fail "Project directory not found: $APP_DIR"
[ -f "$APP_DIR/package.json" ] || fail "package.json not found in $APP_DIR"
[ -f "$APP_DIR/server/Cargo.toml" ] || fail "server/Cargo.toml not found in $APP_DIR"

if [[ "$HOST" =~ ^https?:// ]]; then
  fail "Pass only the host, not a URL. Example: ./setup.sh 1.2.3.4"
fi

if [[ "$HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  MODE="ip"
  PUBLIC_URL="http://$HOST:8080"
  API_URL="$PUBLIC_URL/api"
  BIND_ADDR="0.0.0.0:8080"
else
  MODE="domain"
  PUBLIC_URL="https://$HOST"
  API_URL="$PUBLIC_URL/api"
  BIND_ADDR="127.0.0.1:8080"
fi

read_env_value() {
  local key="$1"
  if [ -f "$ENV_FILE" ]; then
    grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true
  fi
}

random_token() {
  if has_cmd openssl; then
    openssl rand -hex 32
  else
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
    printf '\n'
  fi
}

node_is_supported() {
  has_cmd node && node -v | grep -Eq '^v(20|21|22|23|24)\.'
}

apt_update_once() {
  if [ "${APT_UPDATED:-0}" = "1" ]; then
    return
  fi
  has_cmd apt-get || fail "apt-get not found. Install dependencies manually or run on Debian/Ubuntu."
  info "Running apt-get update"
  $SUDO apt-get update
  APT_UPDATED=1
  record_step "apt-get update executed"
}

install_system_deps() {
  if [ "${SKIP_DEP_INSTALL:-0}" = "1" ]; then
    info "Skipping dependency installation because SKIP_DEP_INSTALL=1"
    record_step "deps skipped by SKIP_DEP_INSTALL"
    return
  fi

  local missing_base=()
  for cmd in curl openssl cc pkg-config; do
    if ! has_cmd "$cmd"; then
      missing_base+=("$cmd")
    fi
  done

  if [ "$BOOTSTRAP" = "0" ] && [ "$FORCE_DEPS" = "0" ] && [ "${#missing_base[@]}" -eq 0 ] && node_is_supported && { [ "$MODE" = "ip" ] || has_cmd caddy; }; then
    info "System dependencies unchanged"
    record_step "deps skipped"
    return
  fi

  if ! has_cmd apt-get; then
    echo "This script can install dependencies automatically on Debian/Ubuntu."
    echo "For other Linux distributions, install these manually:"
    echo "  curl ca-certificates build-essential pkg-config openssl nodejs npm rust/cargo"
    if [ "$MODE" = "domain" ]; then
      echo "  caddy"
    fi
    record_step "deps manual check required"
    return
  fi

  if [ "$BOOTSTRAP" = "1" ] || [ "$FORCE_DEPS" = "1" ] || [ "${#missing_base[@]}" -gt 0 ]; then
    apt_update_once
    info "Installing required system packages"
    $SUDO apt-get install -y curl ca-certificates build-essential pkg-config openssl
    record_step "base deps checked"
  fi

  if ! node_is_supported; then
    apt_update_once
    info "Installing Node.js 20.x"
    if [ -n "$SUDO" ]; then
      curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
    else
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    fi
    $SUDO apt-get install -y nodejs
    record_step "node installed/updated"
  else
    record_step "node unchanged"
  fi

  if [ "$MODE" = "domain" ] && ! has_cmd caddy; then
    apt_update_once
    info "Installing Caddy for HTTPS"
    $SUDO apt-get install -y debian-keyring debian-archive-keyring apt-transport-https gnupg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | $SUDO gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      | $SUDO tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    info "Refreshing apt indexes after adding Caddy repository"
    $SUDO apt-get update
    record_step "apt-get update executed for caddy"
    $SUDO apt-get install -y caddy
    record_step "caddy installed"
  elif [ "$MODE" = "domain" ]; then
    record_step "caddy unchanged"
  fi
}

install_rust() {
  if has_cmd cargo; then
    record_step "rust unchanged"
    return
  fi

  info "Installing Rust toolchain"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  # shellcheck disable=SC1090
  source "$HOME/.cargo/env"
  record_step "rust installed"
}

create_pre_upgrade_backup() {
  if [ "$NO_BACKUP" = "1" ]; then
    info "Skipping pre-upgrade backup because --no-backup was used"
    record_step "backup skipped"
    return
  fi

  local data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
  local db_path="$data_home/.daily-summary/data.db"
  local backup_dir="$data_home/.daily-summary/backups"

  if [ -f "$db_path" ]; then
    mkdir -p "$backup_dir"
    local backup="$backup_dir/pre-upgrade-$(date +%Y%m%d-%H%M%S).db"
    cp "$db_path" "$backup"
    chmod 600 "$backup" || true
    info "Created pre-upgrade database backup: $backup"
    record_step "backup created"
  else
    record_step "backup skipped: no database yet"
  fi
}

write_env_file() {
  mkdir -p "$APP_DIR/server"

  local token
  token="$(read_env_value DAILY_SUMMARY_TOKEN)"
  if [ -z "$token" ] || [ "${FORCE_NEW_TOKEN:-0}" = "1" ]; then
    token="$(random_token)"
  fi

  local ai_key ai_base ai_model
  ai_key="$(read_env_value DAILY_SUMMARY_AI_API_KEY)"
  ai_base="$(read_env_value DAILY_SUMMARY_AI_BASE_URL)"
  ai_model="$(read_env_value DAILY_SUMMARY_AI_MODEL)"

  local next_env
  next_env="$(mktemp)"
  cat >"$next_env" <<EOF
DAILY_SUMMARY_TOKEN=$token
DAILY_SUMMARY_BIND=$BIND_ADDR
DAILY_SUMMARY_ALLOWED_ORIGINS=$PUBLIC_URL
DAILY_SUMMARY_AI_API_KEY=$ai_key
DAILY_SUMMARY_AI_BASE_URL=${ai_base:-https://api.openai.com/v1}
DAILY_SUMMARY_AI_MODEL=${ai_model:-gpt-4o-mini}
EOF

  if [ -f "$ENV_FILE" ] && cmp -s "$next_env" "$ENV_FILE"; then
    rm -f "$next_env"
    record_step "env unchanged"
  else
    umask 077
    mv "$next_env" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    record_step "env written"
  fi
  TOKEN="$token"
}

build_app() {
  cd "$APP_DIR"

  info "Installing frontend dependencies"
  if [ -f package-lock.json ]; then
    npm ci || fail "npm ci failed. If package-lock.json is stale, run npm install locally and commit the updated lockfile."
  else
    npm install
  fi
  record_step "frontend deps installed"

  info "Building frontend for $API_URL"
  VITE_API_BASE_URL="$API_URL" npm run build
  record_step "frontend built"

  info "Building Rust server"
  cd "$APP_DIR/server"
  cargo build --release
  [ -x "$SERVER_BIN" ] || fail "Server binary was not built: $SERVER_BIN"
  record_step "server built"
}

render_service_file() {
  cat <<EOF
[Unit]
Description=daily-summary server
After=network.target

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=$APP_DIR/server
EnvironmentFile=$ENV_FILE
ExecStart=$SERVER_BIN
Restart=always
RestartSec=3
UMask=0077
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
}

systemd_unit_path() {
  echo "/etc/systemd/system/$SERVICE_NAME.service"
}

service_file_needs_write() {
  if [ "$BOOTSTRAP" = "1" ] || [ "$FORCE_SYSTEMD" = "1" ]; then
    return 0
  fi

  local unit_path
  unit_path="$(systemd_unit_path)"
  if ! $SUDO test -f "$unit_path"; then
    return 0
  fi

  local current desired
  current="$(mktemp)"
  desired="$(mktemp)"
  $SUDO cat "$unit_path" >"$current"
  render_service_file >"$desired"
  if cmp -s "$current" "$desired"; then
    rm -f "$current" "$desired"
    return 1
  fi
  rm -f "$current" "$desired"
  return 0
}

ensure_systemd_service() {
  if ! has_cmd systemctl; then
    record_step "systemd unavailable"
    echo "systemctl not found; run the server manually with:"
    echo "  DAILY_SUMMARY_BIND=$BIND_ADDR $SERVER_BIN"
    return
  fi

  if service_file_needs_write; then
    info "Writing systemd service: $SERVICE_NAME"
    render_service_file | $SUDO tee "$(systemd_unit_path)" >/dev/null
    $SUDO systemctl daemon-reload
    $SUDO systemctl enable "$SERVICE_NAME"
    record_step "systemd written"
  else
    record_step "systemd unchanged"
  fi

  info "Restarting service: $SERVICE_NAME"
  $SUDO systemctl restart "$SERVICE_NAME"
  record_step "service restarted"
}

configure_caddy_if_needed() {
  [ "$MODE" = "domain" ] || return
  if ! has_cmd caddy; then
    record_step "caddy skipped: not installed"
    echo "Caddy is not installed. Re-run with --bootstrap or --force-deps to install it."
    return
  fi

  local desired current
  desired="$(mktemp)"
  current="$(mktemp)"
  cat >"$desired" <<EOF
$HOST {
  reverse_proxy $BIND_ADDR
}
EOF
  if $SUDO test -f /etc/caddy/Caddyfile; then
    $SUDO cat /etc/caddy/Caddyfile >"$current"
  fi

  if [ "$BOOTSTRAP" = "1" ] || ! cmp -s "$desired" "$current"; then
    info "Configuring Caddy reverse proxy"
    $SUDO tee /etc/caddy/Caddyfile <"$desired" >/dev/null
    $SUDO systemctl enable caddy
    $SUDO systemctl reload caddy || $SUDO systemctl restart caddy
    record_step "caddy configured"
  else
    record_step "caddy unchanged"
  fi
  rm -f "$desired" "$current"
}

configure_firewall_if_needed() {
  [ "$MODE" = "ip" ] || return
  if ! has_cmd ufw; then
    record_step "firewall skipped: ufw missing"
    return
  fi

  local status
  status="$($SUDO ufw status 2>/dev/null || true)"
  if ! echo "$status" | grep -qi "Status: active"; then
    record_step "firewall skipped: ufw inactive"
    return
  fi
  if echo "$status" | grep -Eq '^8080/tcp[[:space:]]+ALLOW|^8080[[:space:]]+ALLOW'; then
    record_step "firewall unchanged"
    return
  fi

  info "Allowing 8080/tcp in ufw"
  $SUDO ufw allow 8080/tcp || true
  record_step "firewall updated"
}

print_result() {
  cat <<EOF

Deployment complete.

Mode:       $MODE
URL:        $PUBLIC_URL
API URL:    $API_URL
App dir:    $APP_DIR
Env file:   $ENV_FILE
Service:    $SERVICE_NAME

Steps:
EOF
  for step in "${STEPS[@]}"; do
    echo "  - $step"
  done

  cat <<EOF

Access token:
$TOKEN

Next steps:
1. Open $PUBLIC_URL
2. Go to Settings -> Connection
3. Server URL: $API_URL
4. Access token: the token printed above

Useful commands:
  systemctl status $SERVICE_NAME
  journalctl -u $SERVICE_NAME -f
  curl $PUBLIC_URL/api/articles?page=1\\&page_size=1
EOF

  if [ "$MODE" = "ip" ]; then
    cat <<EOF

Security warning:
IP mode uses plain HTTP. Your records and token are not encrypted in transit.
Use a long token, avoid untrusted Wi-Fi, and rotate the token if a device is lost:
  FORCE_NEW_TOKEN=1 APP_DIR=$APP_DIR ./setup.sh $HOST
EOF
  fi
}

info "daily-summary deployment"
echo "Mode:       $MODE"
echo "Public URL: $PUBLIC_URL"
echo "App dir:    $APP_DIR"
if [ "$BOOTSTRAP" = "1" ]; then
  echo "Deploy:     bootstrap"
else
  echo "Deploy:     incremental"
fi

install_system_deps
install_rust
create_pre_upgrade_backup
write_env_file
build_app
ensure_systemd_service
configure_caddy_if_needed
configure_firewall_if_needed
print_result
