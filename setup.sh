#!/usr/bin/env bash
# daily-summary one-command deploy / upgrade script.
#
# Fast incremental deploy using the current public address:
#   ./setup.sh --cur
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
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-$APP_DIR/server/.env.backup}"
SERVER_BIN="$APP_DIR/server/target/release/daily-summary"
OPS_SCRIPT="$APP_DIR/ops.sh"
DEPLOY_TARGET_DIR="${DEPLOY_TARGET_DIR:-$APP_DIR/server/target/deploy-build}"
MAINTENANCE_JOURNAL="${MAINTENANCE_JOURNAL:-$APP_DIR/server/target/$SERVICE_NAME-maintenance-rollback}"
BOOTSTRAP=0
FORCE_DEPS=0
FORCE_SYSTEMD=0
NO_BACKUP=0
USE_CURRENT_HOST=0
HOST=""
STAGE_DIR=""
STAGED_DIST=""
STAGED_BIN=""
STAGED_ENV=""
SERVICE_WAS_ACTIVE=0
ACTIVATED=0
DIST_SWAPPED=0
BIN_SWAPPED=0
ENV_SWAPPED=0
UNIT_SWAPPED=0
UNIT_HAD_PREVIOUS=0
UNIT_WAS_ENABLED=0
CADDY_SWAPPED=0
CADDY_HAD_PREVIOUS=0
CADDY_WAS_ENABLED=0
MAINTENANCE_SWAPPED=0
DEPLOY_COMMITTED=0
LOCK_DIR=""
LOCK_DIR_HELD=0
BUILD_ID=""

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

backup_configured() {
  [ -f "$BACKUP_ENV_FILE" ] \
    && grep -q '^RESTIC_REPOSITORY=.' "$BACKUP_ENV_FILE" \
    && grep -Eq '^RESTIC_PASSWORD(_FILE)?=.' "$BACKUP_ENV_FILE"
}

secure_secret_file() {
  local path="$1"
  local label="$2"
  [ -f "$path" ] || { echo "ERROR: $label not found: $path" >&2; return 1; }
  local owner mode
  owner="$(stat -c '%u' "$path")" || return 1
  [ "$owner" = "$(id -u)" ] || {
    echo "ERROR: $label must be owned by $(id -un): $path" >&2
    return 1
  }
  chmod 600 "$path" || return 1
  mode="$(stat -c '%a' "$path")" || return 1
  (( (8#$mode & 8#177) == 0 )) || {
    echo "ERROR: $label permissions must not exceed 0600: $path" >&2
    return 1
  }
  [ -r "$path" ] || { echo "ERROR: $label is not readable: $path" >&2; return 1; }
}

validate_backup_secrets() {
  [ -f "$BACKUP_ENV_FILE" ] || return 0
  secure_secret_file "$BACKUP_ENV_FILE" "Backup environment file" || return 1
  local password_file
  password_file="$(bash -c 'source "$1"; printf "%s" "${RESTIC_PASSWORD_FILE:-}"' _ "$BACKUP_ENV_FILE")" \
    || return 1
  if [ -n "$password_file" ]; then
    [[ "$password_file" = /* ]] || {
      echo "ERROR: RESTIC_PASSWORD_FILE must be an absolute path" >&2
      return 1
    }
    secure_secret_file "$password_file" "Restic password file" || return 1
  fi
}

usage() {
  cat <<EOF
Usage:
  ./setup.sh [options] <public-ip-or-domain>
  ./setup.sh --cur

Examples:
  ./setup.sh 1.2.3.4
  ./setup.sh --bootstrap 1.2.3.4
  ./setup.sh your.domain.com
  ./setup.sh --cur
  APP_DIR=/root/MyDocs/daily-summary ./setup.sh 1.2.3.4

Options:
  --bootstrap       First install / repair dependencies, systemd, firewall or Caddy
  --force-deps      Force dependency checks and apt-get update
  --force-systemd   Force rewrite systemd service
  --no-backup       Skip pre-upgrade SQLite snapshot
  --cur             Reuse the configured domain, or detect the current public IPv4
  -h, --help        Show this help

Environment overrides:
  APP_DIR=/path/to/project
  BACKUP_ENV_FILE=/path/to/backup-env
  DEPLOY_TARGET_DIR=/path/to/cargo-target
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
    --cur)
      USE_CURRENT_HOST=1
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

[ -d "$APP_DIR" ] || fail "Project directory not found: $APP_DIR"
[ -f "$APP_DIR/package.json" ] || fail "package.json not found in $APP_DIR"
[ -f "$APP_DIR/server/Cargo.toml" ] || fail "server/Cargo.toml not found in $APP_DIR"

read_env_value() {
  local key="$1"
  if [ -f "$ENV_FILE" ]; then
    grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true
  fi
}

valid_ipv4() {
  local address="$1"
  local octet
  local -a octets
  [[ "$address" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
  IFS=. read -r -a octets <<<"$address"
  for octet in "${octets[@]}"; do
    ((10#$octet <= 255)) || return 1
  done
}

valid_host() {
  if [[ "$1" =~ ^[0-9.]+$ ]]; then
    valid_ipv4 "$1"
  else
    [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]
  fi
}

configured_host() {
  local origin authority
  origin="$(read_env_value DAILY_SUMMARY_ALLOWED_ORIGINS)"
  [ -n "$origin" ] || return 1
  authority="${origin#*://}"
  authority="${authority%%/*}"
  authority="${authority%%:*}"
  valid_host "$authority" || return 1
  printf '%s\n' "$authority"
}

probe_public_ipv4() {
  local endpoint candidate
  if ! has_cmd curl && ! has_cmd wget; then
    if has_cmd apt-get; then
      info "Installing curl for public IPv4 detection" >&2
      $SUDO apt-get update >&2
      APT_UPDATED=1
      $SUDO apt-get install -y curl >&2
    else
      return 1
    fi
  fi
  for endpoint in https://api.ipify.org https://ifconfig.me/ip; do
    candidate=""
    if has_cmd curl; then
      candidate="$(curl -4 -fsS --max-time 5 "$endpoint" 2>/dev/null || true)"
    elif has_cmd wget; then
      candidate="$(wget -qO- --timeout=5 "$endpoint" 2>/dev/null || true)"
    fi
    candidate="${candidate//$'\n'/}"
    candidate="${candidate//$'\r'/}"
    if valid_ipv4 "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

resolve_current_host() {
  local configured detected
  configured="$(configured_host || true)"
  if [ -n "$configured" ] && ! valid_ipv4 "$configured"; then
    info "Reusing configured public domain: $configured"
    HOST="$configured"
    return
  fi
  detected="$(probe_public_ipv4 || true)"
  if [ -n "$detected" ]; then
    if [ -n "$configured" ] && [ "$configured" != "$detected" ]; then
      info "Public IPv4 changed: $configured -> $detected"
    fi
    info "Detected current public IPv4: $detected"
    HOST="$detected"
    return
  fi
  fail "Could not detect the current public IPv4. Pass the IP/domain explicitly or ensure curl/wget can reach api.ipify.org."
}

if [ "$USE_CURRENT_HOST" = "1" ]; then
  [ -z "$HOST" ] || fail "Use either --cur or an explicit IP/domain, not both"
  resolve_current_host
elif [ -z "$HOST" ]; then
  usage
  exit 1
fi

if [[ "$HOST" =~ ^https?:// ]]; then
  fail "Pass only the host, not a URL. Example: ./setup.sh 1.2.3.4"
fi

valid_host "$HOST" || fail "Invalid public IP or domain: $HOST"

if valid_ipv4 "$HOST"; then
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

  if [ "$BOOTSTRAP" = "0" ] && [ "$FORCE_DEPS" = "0" ] && [ "${#missing_base[@]}" -eq 0 ] && node_is_supported \
    && { [ "$MODE" = "ip" ] || has_cmd caddy; } \
    && { ! backup_configured || has_cmd restic; }; then
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

  if backup_configured && ! has_cmd restic; then
    apt_update_once
    info "Installing Restic for encrypted offsite backups"
    $SUDO apt-get install -y restic
    record_step "restic installed"
  elif backup_configured; then
    record_step "restic unchanged"
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

apply_backup_maintenance() {
  [ -x "$STAGED_BIN" ] || return 0
  "$STAGED_BIN" --maintain-backups >/dev/null \
    || fail "Could not apply backup retention and stale-file cleanup"
}

create_pre_upgrade_backup() {
  if [ "$NO_BACKUP" = "1" ]; then
    info "Skipping pre-upgrade backup because --no-backup was used"
    record_step "backup skipped"
    apply_backup_maintenance
    record_step "backup retention applied"
    return
  fi

  apply_backup_maintenance

  local data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
  local db_path="$data_home/.daily-summary/data.db"
  local backup_dir="$data_home/.daily-summary/backups"

  if [ -f "$db_path" ]; then
    mkdir -p "$backup_dir"
    local disk_usage
    disk_usage="$(df -Pk "$backup_dir" 2>/dev/null | awk 'NR == 2 { value=$5; gsub(/%/, "", value); print value }' || true)"
    [[ "$disk_usage" =~ ^[0-9]+$ ]] || fail "Could not determine disk usage before the pre-upgrade backup"
    if [ "$disk_usage" -ge 90 ]; then
      fail "Disk usage is ${disk_usage}%; refusing to create a pre-upgrade backup at or above 90%"
    fi
    local backup="$backup_dir/pre-upgrade-$(date +%Y%m%d-%H%M%S).db"
    local paused_service=0
    if has_cmd systemctl && $SUDO systemctl is-active --quiet "$SERVICE_NAME"; then
      info "Pausing $SERVICE_NAME for a consistent SQLite snapshot"
      $SUDO systemctl stop "$SERVICE_NAME"
      paused_service=1
    fi
    if ! cp "$db_path" "$backup"; then
      if [ "$paused_service" = "1" ]; then
        $SUDO systemctl start "$SERVICE_NAME" || true
      fi
      fail "Could not create pre-upgrade database backup"
    fi
    if [ "$paused_service" = "1" ]; then
      $SUDO systemctl start "$SERVICE_NAME"
    elif ! has_cmd systemctl; then
      info "Service state could not be managed; ensure no writes occur during this file copy"
    fi
    chmod 600 "$backup" || true
    info "Created pre-upgrade database backup: $backup"
    record_step "backup created"
  else
    record_step "backup skipped: no database yet"
  fi

  apply_backup_maintenance
  record_step "backup retention applied"
}

write_env_file() {
  [ -n "$STAGED_ENV" ] || fail "Deployment staging directory is not ready"

  local token
  token="$(read_env_value DAILY_SUMMARY_TOKEN)"
  if [ -z "$token" ] || [ "${FORCE_NEW_TOKEN:-0}" = "1" ]; then
    token="$(random_token)"
  fi

  local ai_key ai_base ai_model ai_temperature ai_max_tokens ai_timeout_secs ai_retries ai_min_interval_ms
  ai_key="$(read_env_value DAILY_SUMMARY_AI_API_KEY)"
  ai_base="$(read_env_value DAILY_SUMMARY_AI_BASE_URL)"
  ai_model="$(read_env_value DAILY_SUMMARY_AI_MODEL)"
  ai_temperature="$(read_env_value DAILY_SUMMARY_AI_TEMPERATURE)"
  ai_max_tokens="$(read_env_value DAILY_SUMMARY_AI_MAX_TOKENS)"
  ai_timeout_secs="$(read_env_value DAILY_SUMMARY_AI_TIMEOUT_SECS)"
  ai_retries="$(read_env_value DAILY_SUMMARY_AI_RETRIES)"
  ai_min_interval_ms="$(read_env_value DAILY_SUMMARY_AI_MIN_INTERVAL_MS)"

  cat >"$STAGED_ENV" <<EOF
DAILY_SUMMARY_TOKEN=$token
DAILY_SUMMARY_BIND=$BIND_ADDR
DAILY_SUMMARY_ALLOWED_ORIGINS=$PUBLIC_URL
DAILY_SUMMARY_AI_API_KEY=$ai_key
DAILY_SUMMARY_AI_BASE_URL=${ai_base:-https://api.openai.com/v1}
DAILY_SUMMARY_AI_MODEL=${ai_model:-gpt-4o-mini}
DAILY_SUMMARY_AI_TEMPERATURE=${ai_temperature:-0.2}
DAILY_SUMMARY_AI_MAX_TOKENS=${ai_max_tokens:-0}
DAILY_SUMMARY_AI_TIMEOUT_SECS=${ai_timeout_secs:-45}
DAILY_SUMMARY_AI_RETRIES=${ai_retries:-2}
DAILY_SUMMARY_AI_MIN_INTERVAL_MS=${ai_min_interval_ms:-1200}
EOF
  chmod 600 "$STAGED_ENV"

  if [ -f "$ENV_FILE" ] && cmp -s "$STAGED_ENV" "$ENV_FILE"; then
    record_step "env unchanged"
  else
    record_step "env staged"
  fi
  TOKEN="$token"
}

prepare_deploy_stage() {
  STAGE_DIR="$(mktemp -d "$APP_DIR/.deploy-stage.XXXXXX")"
  STAGED_DIST="$STAGE_DIR/dist"
  STAGED_BIN="$STAGE_DIR/daily-summary"
  STAGED_ENV="$STAGE_DIR/server.env"
  mkdir -p "$STAGE_DIR"
  chmod 700 "$STAGE_DIR"
  if [ -x "$SERVER_BIN" ]; then
    cp "$SERVER_BIN" "$STAGE_DIR/previous-server"
  fi
}

cleanup_stale_deploy_stages() {
  find "$APP_DIR" -maxdepth 1 -type d -uid "$(id -u)" \
    -name '.deploy-stage.*' -mmin +1440 -exec rm -rf -- {} + 2>/dev/null || true
}

secure_runtime_data_permissions() {
  local data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
  local data_dir="$data_home/.daily-summary"
  mkdir -p "$data_dir" "$data_dir/backups" "$data_dir/status"
  chmod 700 "$data_dir" "$data_dir/backups" "$data_dir/status" \
    || fail "Could not secure runtime data directories"
  [ ! -f "$data_dir/data.db" ] || chmod 600 "$data_dir/data.db" \
    || fail "Could not secure the SQLite database"
  find "$data_dir/backups" "$data_dir/status" -maxdepth 1 -type f \
    -exec chmod 600 {} + || fail "Could not secure backup or status files"
}

acquire_deploy_lock() {
  local lock_root="$APP_DIR/server/target"
  mkdir -p "$lock_root"
  if has_cmd flock; then
    exec 9>"$lock_root/deploy.lock"
    flock -n 9 || fail "Another deployment is already running for $APP_DIR"
    cleanup_stale_deploy_stages
    record_step "deployment lock acquired"
    return
  fi

  LOCK_DIR="$lock_root/deploy.lock.d"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    fail "Another deployment may be running. If not, remove stale lock: $LOCK_DIR"
  fi
  LOCK_DIR_HELD=1
  cleanup_stale_deploy_stages
  record_step "deployment lock acquired"
}

require_systemd() {
  has_cmd systemctl || fail "Safe automatic activation requires systemd. Stop any manual server and deploy artifacts manually on this host."
}

recover_interrupted_restore() {
  [ -x "$OPS_SCRIPT" ] || fail "Operations script is missing or not executable: $OPS_SCRIPT"
  "$OPS_SCRIPT" recover-restore --startup
  record_step "restore journal checked"
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

  info "Building frontend for $API_URL into staging"
  VITE_API_BASE_URL="$API_URL" npm run build -- --outDir "$STAGED_DIST"
  [ -f "$STAGED_DIST/index.html" ] || fail "Staged frontend was not built: $STAGED_DIST/index.html"
  record_step "frontend staged"

  info "Building Rust server"
  cd "$APP_DIR/server"
  BUILD_ID="$(date +%s)"
  DAILY_SUMMARY_BUILD_ID="$BUILD_ID" cargo build --release --target-dir "$DEPLOY_TARGET_DIR"
  local built_server="$DEPLOY_TARGET_DIR/release/daily-summary"
  [ -x "$built_server" ] || fail "Server binary was not built: $built_server"
  cp "$built_server" "$STAGED_BIN"
  chmod 755 "$STAGED_BIN"
  local embedded_build_id
  embedded_build_id="$("$STAGED_BIN" --build-id)"
  [ "$embedded_build_id" = "$BUILD_ID" ] || fail "Staged server build identity does not match this deployment"
  record_step "server staged"
}

cleanup_stage() {
  local status=$?
  if [ "$DEPLOY_COMMITTED" != "1" ]; then
    if [ "$MAINTENANCE_SWAPPED" = "1" ]; then
      rollback_maintenance_units || true
    fi
    if [ "$ACTIVATED" = "1" ]; then
      rollback_activation || true
    fi
  fi
  if [ -n "$STAGE_DIR" ] && [ -d "$STAGE_DIR" ]; then
    rm -rf "$STAGE_DIR"
  fi
  if [ "$LOCK_DIR_HELD" = "1" ] && [ -n "$LOCK_DIR" ]; then
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
  trap - EXIT
  exit "$status"
}

activate_build() {
  [ -f "$STAGED_DIST/index.html" ] || fail "Staged frontend is missing"
  [ -x "$STAGED_BIN" ] || fail "Staged server binary is missing"
  [ -f "$STAGED_ENV" ] || fail "Staged server environment is missing"

  if $SUDO systemctl is-active --quiet "$SERVICE_NAME"; then
    SERVICE_WAS_ACTIVE=1
    info "Stopping $SERVICE_NAME for coordinated frontend/server activation"
    $SUDO systemctl stop "$SERVICE_NAME"
  fi

  ACTIVATED=1
  if [ -d "$APP_DIR/dist" ]; then
    mv "$APP_DIR/dist" "$STAGE_DIR/previous-dist"
    DIST_SWAPPED=1
  fi
  mv "$STAGED_DIST" "$APP_DIR/dist"
  DIST_SWAPPED=1

  mkdir -p "$APP_DIR/server" "$(dirname "$SERVER_BIN")"
  if [ -f "$ENV_FILE" ]; then
    mv "$ENV_FILE" "$STAGE_DIR/previous-env"
    ENV_SWAPPED=1
  fi
  mv "$STAGED_ENV" "$ENV_FILE"
  ENV_SWAPPED=1
  chmod 600 "$ENV_FILE"

  install -m 0755 "$STAGED_BIN" "$SERVER_BIN.next"
  mv -f "$SERVER_BIN.next" "$SERVER_BIN"
  BIN_SWAPPED=1
  record_step "frontend, server and env activated together"
}

rollback_activation() {
  [ "$ACTIVATED" = "1" ] || return 0
  info "Rolling back frontend, server and environment"
  if has_cmd systemctl; then
    $SUDO systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
  fi
  if [ "$DIST_SWAPPED" = "1" ]; then
    rm -rf "$APP_DIR/dist"
    if [ -d "$STAGE_DIR/previous-dist" ]; then
      mv "$STAGE_DIR/previous-dist" "$APP_DIR/dist"
    fi
  fi
  if [ "$BIN_SWAPPED" = "1" ] && [ -f "$STAGE_DIR/previous-server" ]; then
    install -m 0755 "$STAGE_DIR/previous-server" "$SERVER_BIN"
  elif [ "$BIN_SWAPPED" = "1" ]; then
    rm -f "$SERVER_BIN"
  fi
  if [ "$ENV_SWAPPED" = "1" ]; then
    rm -f "$ENV_FILE"
    if [ -f "$STAGE_DIR/previous-env" ]; then
      mv "$STAGE_DIR/previous-env" "$ENV_FILE"
    fi
  fi
  if [ "$UNIT_SWAPPED" = "1" ]; then
    if [ "$UNIT_HAD_PREVIOUS" = "1" ] && [ -f "$STAGE_DIR/previous-service" ]; then
      $SUDO install -m 0644 "$STAGE_DIR/previous-service" "$(systemd_unit_path)" || true
    else
      $SUDO rm -f "$(systemd_unit_path)" || true
    fi
    $SUDO systemctl daemon-reload || true
    if [ "$UNIT_WAS_ENABLED" = "1" ]; then
      $SUDO systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
    else
      $SUDO systemctl disable "$SERVICE_NAME" >/dev/null 2>&1 || true
    fi
  fi
  if [ "$SERVICE_WAS_ACTIVE" = "1" ] && has_cmd systemctl; then
    $SUDO systemctl start "$SERVICE_NAME" || true
  fi
  if [ "$CADDY_SWAPPED" = "1" ]; then
    if [ "$CADDY_HAD_PREVIOUS" = "1" ] && [ -f "$STAGE_DIR/previous-caddy" ]; then
      $SUDO install -m 0644 "$STAGE_DIR/previous-caddy" /etc/caddy/Caddyfile || true
    else
      $SUDO rm -f /etc/caddy/Caddyfile || true
    fi
    if [ "$CADDY_WAS_ENABLED" = "1" ]; then
      $SUDO systemctl enable caddy >/dev/null 2>&1 || true
    else
      $SUDO systemctl disable caddy >/dev/null 2>&1 || true
    fi
    $SUDO systemctl reload caddy >/dev/null 2>&1 || $SUDO systemctl restart caddy >/dev/null 2>&1 || true
  fi
  ACTIVATED=0
  DIST_SWAPPED=0
  BIN_SWAPPED=0
  ENV_SWAPPED=0
  UNIT_SWAPPED=0
  UNIT_WAS_ENABLED=0
  CADDY_SWAPPED=0
  CADDY_WAS_ENABLED=0
  record_step "artifacts rolled back"
}

wait_for_health() {
  local attempt response reported_build
  for ((attempt = 1; attempt <= 20; attempt++)); do
    response=""
    if $SUDO systemctl is-active --quiet "$SERVICE_NAME"; then
      if has_cmd curl; then
        response="$(curl -fsS --max-time 2 http://127.0.0.1:8080/health 2>/dev/null || true)"
      elif has_cmd wget; then
        response="$(wget -qO- --timeout=2 http://127.0.0.1:8080/health 2>/dev/null || true)"
      fi
      reported_build="$(printf '%s\n' "$response" | sed -n 's/.*"build"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
      if [ -n "$BUILD_ID" ] && [ "$reported_build" = "$BUILD_ID" ]; then
        return 0
      fi
    fi
    sleep 1
  done
  return 1
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
ExecStartPre=$OPS_SCRIPT recover-restore --startup
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

render_backup_service_file() {
  cat <<EOF
[Unit]
Description=daily-summary verified local and encrypted offsite backup
After=network-online.target $SERVICE_NAME.service
Wants=network-online.target

[Service]
Type=oneshot
User=$(id -un)
WorkingDirectory=$APP_DIR
Environment=HOME=$HOME
Environment=DAILY_SUMMARY_LOCK_WAIT_SECONDS=600
ExecStart=$OPS_SCRIPT offsite-backup
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
EOF
}

render_backup_timer_file() {
  cat <<EOF
[Unit]
Description=Run daily-summary backup every day

[Timer]
OnActiveSec=5min
OnCalendar=*-*-* 03:15:00
RandomizedDelaySec=30min
Persistent=true
Unit=$SERVICE_NAME-backup.service

[Install]
WantedBy=timers.target
EOF
}

render_verify_service_file() {
  cat <<EOF
[Unit]
Description=Verify daily-summary offsite backup by restoring it
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$(id -un)
WorkingDirectory=$APP_DIR
Environment=HOME=$HOME
Environment=DAILY_SUMMARY_LOCK_WAIT_SECONDS=1800
ExecStart=$OPS_SCRIPT verify-offsite
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
EOF
}

render_verify_timer_file() {
  cat <<EOF
[Unit]
Description=Run weekly daily-summary offsite restore drill

[Timer]
OnActiveSec=30min
OnCalendar=Sun *-*-* 04:15:00
RandomizedDelaySec=30min
Persistent=true
Unit=$SERVICE_NAME-verify-backup.service

[Install]
WantedBy=timers.target
EOF
}

render_monitor_service_file() {
  cat <<EOF
[Unit]
Description=Monitor daily-summary health, backups, disk, SQLite and AI failures
After=$SERVICE_NAME.service

[Service]
Type=oneshot
User=$(id -un)
WorkingDirectory=$APP_DIR
Environment=HOME=$HOME
ExecStart=$OPS_SCRIPT monitor
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
EOF
}

render_monitor_timer_file() {
  cat <<EOF
[Unit]
Description=Run daily-summary monitoring every five minutes

[Timer]
OnActiveSec=15min
OnUnitActiveSec=5min
Unit=$SERVICE_NAME-monitor.service

[Install]
WantedBy=timers.target
EOF
}

systemd_unit_path() {
  echo "/etc/systemd/system/$SERVICE_NAME.service"
}

maintenance_unit_names() {
  printf '%s\n' \
    "$SERVICE_NAME-backup.service" \
    "$SERVICE_NAME-backup.timer" \
    "$SERVICE_NAME-verify-backup.service" \
    "$SERVICE_NAME-verify-backup.timer" \
    "$SERVICE_NAME-monitor.service" \
    "$SERVICE_NAME-monitor.timer"
}

rollback_maintenance_units() {
  [ "$MAINTENANCE_SWAPPED" = "1" ] || [ -d "$MAINTENANCE_JOURNAL" ] || return 0
  [ -f "$MAINTENANCE_JOURNAL/unit-names" ] || return 1
  local name path failed=0
  while IFS= read -r name; do
    path="/etc/systemd/system/$name"
    if [ -f "$MAINTENANCE_JOURNAL/units/$name" ]; then
      $SUDO install -m 0644 "$MAINTENANCE_JOURNAL/units/$name" "$path" || failed=1
    else
      $SUDO rm -f "$path" || failed=1
    fi
  done <"$MAINTENANCE_JOURNAL/unit-names"
  $SUDO systemctl daemon-reload || failed=1
  while IFS= read -r name; do
    if [ -f "$MAINTENANCE_JOURNAL/enabled/$name" ]; then
      $SUDO systemctl enable "$name" >/dev/null 2>&1 || failed=1
    else
      if [ -f "$MAINTENANCE_JOURNAL/units/$name" ]; then
        $SUDO systemctl disable "$name" >/dev/null 2>&1 || failed=1
      else
        $SUDO systemctl disable "$name" >/dev/null 2>&1 || true
      fi
    fi
  done <"$MAINTENANCE_JOURNAL/unit-names"
  while IFS= read -r name; do
    if [ -f "$MAINTENANCE_JOURNAL/active/$name" ]; then
      $SUDO systemctl start "$name" >/dev/null 2>&1 || failed=1
    else
      if [ -f "$MAINTENANCE_JOURNAL/units/$name" ]; then
        $SUDO systemctl stop "$name" >/dev/null 2>&1 || failed=1
      else
        $SUDO systemctl stop "$name" >/dev/null 2>&1 || true
      fi
    fi
  done <"$MAINTENANCE_JOURNAL/unit-names"
  [ "$failed" = "0" ] || return 1
  rm -rf "$MAINTENANCE_JOURNAL" || return 1
  sync -f "$(dirname "$MAINTENANCE_JOURNAL")" 2>/dev/null || true
  MAINTENANCE_SWAPPED=0
}

recover_maintenance_units() {
  [ -d "$MAINTENANCE_JOURNAL" ] || return 0
  if grep -qx committed "$MAINTENANCE_JOURNAL/phase" 2>/dev/null; then
    rm -rf "$MAINTENANCE_JOURNAL" || fail "Could not finalize committed maintenance-unit journal"
    record_step "maintenance unit journal finalized"
    return 0
  fi
  info "Recovering interrupted maintenance-unit activation"
  MAINTENANCE_SWAPPED=1
  rollback_maintenance_units || fail "Maintenance units could not be recovered; journal retained at $MAINTENANCE_JOURNAL"
  record_step "maintenance units recovered"
}

commit_maintenance_units() {
  [ "$MAINTENANCE_SWAPPED" = "1" ] || return 0
  printf 'committed\n' >"$MAINTENANCE_JOURNAL/phase" || return 1
  sync -f "$MAINTENANCE_JOURNAL" 2>/dev/null || true
}

finalize_maintenance_units() {
  [ "$MAINTENANCE_SWAPPED" = "1" ] || return 0
  rm -rf "$MAINTENANCE_JOURNAL" || return 1
  sync -f "$(dirname "$MAINTENANCE_JOURNAL")" 2>/dev/null || true
  MAINTENANCE_SWAPPED=0
}

configure_maintenance_units() {
  [ -x "$OPS_SCRIPT" ] || return 1
  validate_backup_secrets || return 1
  if backup_configured && ! has_cmd restic; then
    echo "ERROR: Offsite backup is configured but restic is missing. Re-run with --bootstrap or --force-deps." >&2
    return 1
  fi

  local staged_dir="$STAGE_DIR/maintenance-units"
  local journal_next="$STAGE_DIR/maintenance-rollback-journal"
  mkdir -p "$staged_dir" || return 1
  render_backup_service_file >"$staged_dir/$SERVICE_NAME-backup.service" || return 1
  render_backup_timer_file >"$staged_dir/$SERVICE_NAME-backup.timer" || return 1
  render_verify_service_file >"$staged_dir/$SERVICE_NAME-verify-backup.service" || return 1
  render_verify_timer_file >"$staged_dir/$SERVICE_NAME-verify-backup.timer" || return 1
  render_monitor_service_file >"$staged_dir/$SERVICE_NAME-monitor.service" || return 1
  render_monitor_timer_file >"$staged_dir/$SERVICE_NAME-monitor.timer" || return 1
  chmod 0644 "$staged_dir"/* || return 1
  if has_cmd systemd-analyze; then
    SYSTEMD_UNIT_PATH="$staged_dir:/etc/systemd/system:/usr/lib/systemd/system:/lib/systemd/system" \
      systemd-analyze verify "$staged_dir"/* >/dev/null || return 1
  fi

  rm -rf "$journal_next" || return 1
  mkdir -p "$journal_next/units" "$journal_next/enabled" "$journal_next/active" || return 1
  maintenance_unit_names >"$journal_next/unit-names" || return 1
  local name path
  while IFS= read -r name; do
    path="/etc/systemd/system/$name"
    if $SUDO test -f "$path"; then
      $SUDO cat "$path" >"$journal_next/units/$name" || return 1
    fi
    if $SUDO systemctl is-enabled --quiet "$name"; then
      touch "$journal_next/enabled/$name" || return 1
    fi
    if $SUDO systemctl is-active --quiet "$name"; then
      touch "$journal_next/active/$name" || return 1
    fi
  done < <(maintenance_unit_names)

  printf 'prepared\n' >"$journal_next/phase" || return 1
  chmod -R go-rwx "$journal_next" || return 1
  mv "$journal_next" "$MAINTENANCE_JOURNAL" || return 1
  sync -f "$(dirname "$MAINTENANCE_JOURNAL")" 2>/dev/null || true
  MAINTENANCE_SWAPPED=1
  while IFS= read -r name; do
    $SUDO install -m 0644 "$staged_dir/$name" "/etc/systemd/system/$name" \
      || { rollback_maintenance_units; return 1; }
  done < <(maintenance_unit_names)
  $SUDO systemctl daemon-reload || { rollback_maintenance_units; return 1; }
  $SUDO systemctl enable --now "$SERVICE_NAME-backup.timer" "$SERVICE_NAME-monitor.timer" \
    || { rollback_maintenance_units; return 1; }
  if backup_configured; then
    $SUDO systemctl enable --now "$SERVICE_NAME-verify-backup.timer" \
      || { rollback_maintenance_units; return 1; }
    record_step "offsite backup verification timer enabled"
  else
    $SUDO systemctl disable --now "$SERVICE_NAME-verify-backup.timer" >/dev/null 2>&1 \
      || { rollback_maintenance_units; return 1; }
    record_step "offsite backup awaiting configuration"
  fi
  record_step "backup and monitoring timers enabled"
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
  if service_file_needs_write; then
    info "Writing systemd service: $SERVICE_NAME"
    if $SUDO test -f "$(systemd_unit_path)"; then
      $SUDO cat "$(systemd_unit_path)" >"$STAGE_DIR/previous-service" || return 1
      UNIT_HAD_PREVIOUS=1
    fi
    if $SUDO systemctl is-enabled --quiet "$SERVICE_NAME"; then
      UNIT_WAS_ENABLED=1
    fi
    UNIT_SWAPPED=1
    render_service_file | $SUDO tee "$(systemd_unit_path)" >/dev/null || return 1
    $SUDO systemctl daemon-reload || return 1
    $SUDO systemctl enable "$SERVICE_NAME" || return 1
    record_step "systemd written"
  else
    record_step "systemd unchanged"
  fi

  info "Restarting service: $SERVICE_NAME"
  $SUDO systemctl restart "$SERVICE_NAME" || return 1
  record_step "service restarted"
}

configure_caddy_if_needed() {
  [ "$MODE" = "domain" ] || return 0
  if ! has_cmd caddy; then
    fail "Caddy is not installed. Re-run with --bootstrap or --force-deps to install it."
  fi

  local desired current
  desired="$(mktemp)"
  current="$(mktemp)"
  cat >"$desired" <<EOF
$HOST {
  reverse_proxy $BIND_ADDR
}
EOF
  caddy validate --config "$desired" --adapter caddyfile >/dev/null || fail "Generated Caddy configuration is invalid"
  if $SUDO test -f /etc/caddy/Caddyfile; then
    $SUDO cat /etc/caddy/Caddyfile >"$current"
  fi

  if [ "$BOOTSTRAP" = "1" ] || ! cmp -s "$desired" "$current"; then
    info "Configuring Caddy reverse proxy"
    if $SUDO systemctl is-enabled --quiet caddy; then
      CADDY_WAS_ENABLED=1
    fi
    if $SUDO test -f /etc/caddy/Caddyfile; then
      $SUDO cat /etc/caddy/Caddyfile >"$STAGE_DIR/previous-caddy"
      CADDY_HAD_PREVIOUS=1
    fi
    CADDY_SWAPPED=1
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
  [ "$MODE" = "ip" ] || return 0
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
  systemctl list-timers '$SERVICE_NAME-*'
  $OPS_SCRIPT backup-bundle
  $OPS_SCRIPT maintain-backups
  $OPS_SCRIPT monitor
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

trap cleanup_stage EXIT

acquire_deploy_lock
secure_runtime_data_permissions
require_systemd
recover_maintenance_units
recover_interrupted_restore
install_system_deps
install_rust
prepare_deploy_stage
write_env_file
build_app
create_pre_upgrade_backup
activate_build
if ! ensure_systemd_service; then
  rollback_activation
  fail "Service activation failed; previous artifacts were restored"
fi
info "Waiting for the new service health check"
if ! wait_for_health; then
  rollback_activation
  fail "New service did not become healthy; previous artifacts were restored"
fi
record_step "health check passed"
configure_caddy_if_needed
if ! configure_maintenance_units; then
  rollback_activation
  fail "Maintenance unit activation failed; previous application and units were restored"
fi
configure_firewall_if_needed
if ! commit_maintenance_units; then
  rollback_maintenance_units || true
  rollback_activation
  fail "Maintenance-unit transaction could not be committed; previous application and units were restored"
fi
DEPLOY_COMMITTED=1
ACTIVATED=0
if ! finalize_maintenance_units; then
  record_step "committed maintenance journal will be finalized on the next setup"
fi
print_result
