#!/usr/bin/env bash
# Backup, restore and monitoring operations for daily-summary.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$SCRIPT_DIR}"
SERVICE_NAME="${SERVICE_NAME:-daily-summary}"
SERVER_BIN="${SERVER_BIN:-$APP_DIR/server/target/release/daily-summary}"
ENV_FILE="${ENV_FILE:-$APP_DIR/server/.env}"
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-$APP_DIR/server/.env.backup}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
DATA_DIR="$DATA_HOME/.daily-summary"
DB_PATH="$DATA_DIR/data.db"
BACKUP_DIR="$DATA_DIR/backups"
STATUS_DIR="$DATA_DIR/status"
LAST_SNAPSHOT=""
VERIFIED_DIR=""
LOCK_MODE="fail"
LOCK_ACQUIRED=0
TEMP_PATHS=()

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

if [ -f "$BACKUP_ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$BACKUP_ENV_FILE"
  set +a
fi

info() {
  echo "==> $*"
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

cleanup() {
  local status=$?
  local path
  for path in "${TEMP_PATHS[@]}"; do
    [ -n "$path" ] && rm -rf "$path"
  done
  trap - EXIT
  exit "$status"
}

trap cleanup EXIT

usage() {
  cat <<EOF
Usage:
  ./ops.sh local-backup
  ./ops.sh backup-bundle [output.tar.gz]
  ./ops.sh verify-bundle <bundle.tar.gz>
  ./ops.sh restore <bundle.tar.gz>
  ./ops.sh init-offsite
  ./ops.sh offsite-backup
  ./ops.sh verify-offsite
  ./ops.sh restore-offsite
  ./ops.sh monitor

Offsite backups use Restic configuration from:
  $BACKUP_ENV_FILE
EOF
}

acquire_lock() {
  [ "$LOCK_ACQUIRED" = "1" ] && return
  has_cmd flock || fail "flock is required (install util-linux)"
  mkdir -p "$APP_DIR/server/target"
  exec 9>"$APP_DIR/server/target/deploy.lock"
  if ! flock -n 9; then
    if [ "$LOCK_MODE" = "skip" ]; then
      info "Deployment or maintenance is already running; skipping this monitor cycle"
      exit 0
    fi
    fail "Deployment or maintenance is already running"
  fi
  LOCK_ACQUIRED=1
}

require_server_bin() {
  [ -x "$SERVER_BIN" ] || fail "Server binary not found. Run ./setup.sh first: $SERVER_BIN"
}

env_value() {
  local file="$1"
  local key="$2"
  [ -f "$file" ] || return 0
  grep -E "^${key}=" "$file" | tail -n 1 | cut -d= -f2- || true
}

prune_local_backups() {
  local keep="${DAILY_SUMMARY_LOCAL_BACKUP_KEEP:-14}"
  [[ "$keep" =~ ^[0-9]+$ ]] || fail "DAILY_SUMMARY_LOCAL_BACKUP_KEEP must be an integer"
  local -a backups=()
  mapfile -t backups < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'daily-summary-auto-*.db' -print | sort)
  if [ "${#backups[@]}" -gt "$keep" ]; then
    local remove_count=$((${#backups[@]} - keep))
    local index
    for ((index = 0; index < remove_count; index++)); do
      rm -f "${backups[$index]}"
    done
  fi
}

create_snapshot() {
  require_server_bin
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$DATA_DIR" "$BACKUP_DIR" 2>/dev/null || true
  local timestamp destination temporary latest_next
  timestamp="$(date +%Y%m%d-%H%M%S)"
  destination="$BACKUP_DIR/daily-summary-auto-$timestamp-$$.db"
  temporary="$BACKUP_DIR/.snapshot-$timestamp-$$.db"
  latest_next="$BACKUP_DIR/.daily-summary-latest-$$.db"
  TEMP_PATHS+=("$temporary" "$latest_next")
  "$SERVER_BIN" --snapshot "$temporary" >/dev/null
  "$SERVER_BIN" --verify-db "$temporary" >/dev/null
  chmod 600 "$temporary"
  mv "$temporary" "$destination"
  cp "$destination" "$latest_next"
  chmod 600 "$latest_next"
  mv -f "$latest_next" "$BACKUP_DIR/daily-summary-latest.db"
  LAST_SNAPSHOT="$destination"
  prune_local_backups
  info "Created verified SQLite snapshot: $destination"
}

package_bundle() {
  local database="$1"
  local output="$2"
  [ ! -e "$output" ] || fail "Bundle already exists: $output"
  mkdir -p "$(dirname "$output")"
  local stage archive_next
  stage="$(mktemp -d)"
  archive_next="$output.next.$$"
  TEMP_PATHS+=("$stage" "$archive_next")
  install -m 0600 "$database" "$stage/database.db"
  if [ -f "$ENV_FILE" ]; then
    install -m 0600 "$ENV_FILE" "$stage/server.env"
  fi
  cat >"$stage/manifest" <<EOF
format=daily-summary-backup-bundle
version=1
created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
build_id=$($SERVER_BIN --build-id)
EOF
  (
    cd "$stage"
    sha256sum database.db >SHA256SUMS
    if [ -f server.env ]; then
      sha256sum server.env >>SHA256SUMS
      tar -czf "$archive_next" manifest SHA256SUMS database.db server.env
    else
      tar -czf "$archive_next" manifest SHA256SUMS database.db
    fi
  )
  chmod 600 "$archive_next"
  mv "$archive_next" "$output"
  info "Created migration bundle: $output"
}

create_bundle() {
  local output="$1"
  local snapshot_dir snapshot
  snapshot_dir="$(mktemp -d)"
  TEMP_PATHS+=("$snapshot_dir")
  snapshot="$snapshot_dir/database.db"
  require_server_bin
  "$SERVER_BIN" --snapshot "$snapshot" >/dev/null
  "$SERVER_BIN" --verify-db "$snapshot" >/dev/null
  package_bundle "$snapshot" "$output"
}

verify_bundle() {
  local bundle="$1"
  [ -f "$bundle" ] || fail "Bundle not found: $bundle"
  require_server_bin
  local entry stage
  while IFS= read -r entry; do
    case "$entry" in
      manifest|SHA256SUMS|database.db|server.env) ;;
      *) fail "Bundle contains an unexpected path: $entry" ;;
    esac
  done < <(tar -tzf "$bundle")
  stage="$(mktemp -d)"
  TEMP_PATHS+=("$stage")
  tar -xzf "$bundle" -C "$stage" --no-same-owner --no-same-permissions
  [ -f "$stage/manifest" ] && [ ! -L "$stage/manifest" ] || fail "Bundle manifest is missing or unsafe"
  [ -f "$stage/SHA256SUMS" ] && [ ! -L "$stage/SHA256SUMS" ] || fail "Bundle checksums are missing or unsafe"
  [ -f "$stage/database.db" ] && [ ! -L "$stage/database.db" ] || fail "Bundle database is missing or unsafe"
  if [ -e "$stage/server.env" ] && { [ ! -f "$stage/server.env" ] || [ -L "$stage/server.env" ]; }; then
    fail "Bundle environment file is unsafe"
  fi
  grep -qx 'format=daily-summary-backup-bundle' "$stage/manifest" || fail "Invalid bundle format"
  grep -qx 'version=1' "$stage/manifest" || fail "Unsupported bundle version"
  local expected_count=1
  [ -f "$stage/server.env" ] && expected_count=2
  [ "$(wc -l <"$stage/SHA256SUMS")" -eq "$expected_count" ] || fail "Bundle checksum list has unexpected entries"
  grep -Fqx "$(cd "$stage" && sha256sum database.db)" "$stage/SHA256SUMS" || fail "Database checksum mismatch"
  if [ -f "$stage/server.env" ]; then
    grep -Fqx "$(cd "$stage" && sha256sum server.env)" "$stage/SHA256SUMS" || fail "Environment checksum mismatch"
  fi
  "$SERVER_BIN" --verify-db "$stage/database.db" >/dev/null
  VERIFIED_DIR="$stage"
  info "Verified bundle checksums and SQLite integrity: $bundle"
}

merge_restored_env() {
  local restored="$1"
  local current="$2"
  local output="$3"
  local bind origins
  bind="$(env_value "$current" DAILY_SUMMARY_BIND)"
  origins="$(env_value "$current" DAILY_SUMMARY_ALLOWED_ORIGINS)"
  if [ -z "$bind" ] && [ -z "$origins" ]; then
    install -m 0600 "$restored" "$output"
    return
  fi
  awk -F= -v bind="$bind" -v origins="$origins" '
    $1 == "DAILY_SUMMARY_BIND" && bind != "" { print "DAILY_SUMMARY_BIND=" bind; seen_bind=1; next }
    $1 == "DAILY_SUMMARY_ALLOWED_ORIGINS" && origins != "" { print "DAILY_SUMMARY_ALLOWED_ORIGINS=" origins; seen_origins=1; next }
    { print }
    END {
      if (bind != "" && !seen_bind) print "DAILY_SUMMARY_BIND=" bind
      if (origins != "" && !seen_origins) print "DAILY_SUMMARY_ALLOWED_ORIGINS=" origins
    }
  ' "$restored" >"$output"
  chmod 600 "$output"
}

wait_for_service() {
  local attempt response
  for ((attempt = 1; attempt <= 20; attempt++)); do
    if systemctl is-active --quiet "$SERVICE_NAME"; then
      response="$(curl -fsS --max-time 2 http://127.0.0.1:8080/health 2>/dev/null || true)"
      if echo "$response" | grep -q '"database_integrity"[[:space:]]*:[[:space:]]*"ok"'; then
        return 0
      fi
    fi
    sleep 1
  done
  return 1
}

restore_bundle() {
  local bundle="$1"
  has_cmd systemctl || fail "Restore requires systemd service coordination"
  acquire_lock
  verify_bundle "$bundle"
  mkdir -p "$DATA_DIR" "$BACKUP_DIR"
  chmod 700 "$DATA_DIR" "$BACKUP_DIR" 2>/dev/null || true
  local was_active=0 had_db=0 had_env=0 timestamp previous_db previous_env next_db next_env
  timestamp="$(date +%Y%m%d-%H%M%S)"
  previous_db="$BACKUP_DIR/pre-restore-$timestamp-$$.db"
  previous_env="$VERIFIED_DIR/previous.env"
  next_db="$DATA_DIR/.data.db.restore-$$"
  next_env="$APP_DIR/server/.env.restore-$$"
  TEMP_PATHS+=("$next_db" "$next_env")
  if [ -f "$DB_PATH" ]; then
    had_db=1
  fi
  if [ -f "$ENV_FILE" ]; then
    cp "$ENV_FILE" "$previous_env"
    chmod 600 "$previous_env"
    had_env=1
  fi
  install -m 0600 "$VERIFIED_DIR/database.db" "$next_db"
  if [ -f "$VERIFIED_DIR/server.env" ]; then
    merge_restored_env "$VERIFIED_DIR/server.env" "$previous_env" "$next_env"
  fi
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    was_active=1
    $SUDO systemctl stop "$SERVICE_NAME"
  fi
  if [ "$had_db" = "1" ]; then
    if ! cp "$DB_PATH" "$previous_db"; then
      [ "$was_active" = "1" ] && $SUDO systemctl start "$SERVICE_NAME" >/dev/null 2>&1 || true
      fail "Could not preserve the current database before restore"
    fi
    chmod 600 "$previous_db"
  fi
  if ! mv -f "$next_db" "$DB_PATH"; then
    [ "$was_active" = "1" ] && $SUDO systemctl start "$SERVICE_NAME" >/dev/null 2>&1 || true
    fail "Could not activate the restored database"
  fi
  if [ -f "$VERIFIED_DIR/server.env" ] && ! mv -f "$next_env" "$ENV_FILE"; then
    if [ "$had_db" = "1" ]; then
      install -m 0600 "$previous_db" "$DB_PATH"
    else
      rm -f "$DB_PATH"
    fi
    [ "$was_active" = "1" ] && $SUDO systemctl start "$SERVICE_NAME" >/dev/null 2>&1 || true
    fail "Could not activate the restored environment; previous database was restored"
  fi

  local restore_ok=1
  if [ "$was_active" = "1" ]; then
    $SUDO systemctl start "$SERVICE_NAME" || restore_ok=0
    if [ "$restore_ok" = "1" ] && ! wait_for_service; then
      restore_ok=0
    fi
  fi
  if [ "$restore_ok" = "0" ]; then
    $SUDO systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
    if [ "$had_db" = "1" ]; then
      install -m 0600 "$previous_db" "$DB_PATH"
    else
      rm -f "$DB_PATH"
    fi
    if [ "$had_env" = "1" ]; then
      install -m 0600 "$previous_env" "$ENV_FILE"
    else
      rm -f "$ENV_FILE"
    fi
    [ "$was_active" = "1" ] && $SUDO systemctl start "$SERVICE_NAME" >/dev/null 2>&1 || true
    fail "Restored service failed health checks; previous database and environment were restored"
  fi
  if [ "$had_db" = "1" ]; then
    info "Restore completed. Previous database backup: $previous_db"
  else
    info "Restore completed. No previous database existed"
  fi
  if [ "$was_active" = "0" ]; then
    info "Service was inactive and remains inactive"
  fi
}

restic_configured() {
  [ -n "${RESTIC_REPOSITORY:-}" ] && { [ -n "${RESTIC_PASSWORD:-}" ] || [ -n "${RESTIC_PASSWORD_FILE:-}" ]; }
}

require_restic_config() {
  restic_configured || fail "Configure RESTIC_REPOSITORY and RESTIC_PASSWORD_FILE (or RESTIC_PASSWORD) in $BACKUP_ENV_FILE"
  has_cmd restic || fail "restic is not installed; re-run ./setup.sh --bootstrap --cur"
}

init_offsite() {
  require_restic_config
  if restic snapshots >/dev/null 2>&1; then
    info "Restic repository is already initialized"
  else
    restic init
    info "Initialized encrypted Restic repository"
  fi
}

offsite_backup() {
  acquire_lock
  create_snapshot
  if ! restic_configured; then
    info "Offsite backup is not configured; local verified snapshot completed"
    return
  fi
  require_restic_config
  restic snapshots >/dev/null 2>&1 || fail "Restic repository is unavailable or not initialized; run ./ops.sh init-offsite"
  local stage bundle
  stage="$(mktemp -d)"
  TEMP_PATHS+=("$stage")
  bundle="$stage/daily-summary-bundle-$(date +%Y%m%d-%H%M%S).tar.gz"
  package_bundle "$LAST_SNAPSHOT" "$bundle"
  restic backup "$bundle" --tag daily-summary
  restic forget --tag daily-summary \
    --keep-daily "${DAILY_SUMMARY_RESTIC_KEEP_DAILY:-7}" \
    --keep-weekly "${DAILY_SUMMARY_RESTIC_KEEP_WEEKLY:-4}" \
    --keep-monthly "${DAILY_SUMMARY_RESTIC_KEEP_MONTHLY:-12}" --prune
  mkdir -p "$STATUS_DIR"
  date +%s >"$STATUS_DIR/offsite-last-success"
  chmod 600 "$STATUS_DIR/offsite-last-success"
  info "Encrypted offsite backup completed"
}

verify_offsite() {
  acquire_lock
  require_restic_config
  restic check
  local target bundle
  target="$(mktemp -d)"
  TEMP_PATHS+=("$target")
  restic restore latest --tag daily-summary --target "$target"
  bundle="$(find "$target" -type f -name 'daily-summary-bundle-*.tar.gz' -print -quit)"
  [ -n "$bundle" ] || fail "Restic restore did not contain a daily-summary bundle"
  verify_bundle "$bundle"
  mkdir -p "$STATUS_DIR"
  date +%s >"$STATUS_DIR/offsite-verify-last-success"
  chmod 600 "$STATUS_DIR/offsite-verify-last-success"
  info "Offsite restore drill completed successfully"
}

restore_offsite() {
  acquire_lock
  require_restic_config
  local target bundle
  target="$(mktemp -d)"
  TEMP_PATHS+=("$target")
  restic restore latest --tag daily-summary --target "$target"
  bundle="$(find "$target" -type f -name 'daily-summary-bundle-*.tar.gz' -print -quit)"
  [ -n "$bundle" ] || fail "Restic restore did not contain a daily-summary bundle"
  restore_bundle "$bundle"
}

json_number() {
  local json="$1"
  local key="$2"
  printf '%s\n' "$json" | sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p"
}

send_alert() {
  local message="$1"
  echo "ALERT: $message" >&2
  if [ -n "${DAILY_SUMMARY_ALERT_WEBHOOK_URL:-}" ] && has_cmd curl; then
    local escaped
    escaped="${message//\\/\\\\}"
    escaped="${escaped//\"/\\\"}"
    curl -fsS --max-time 10 -H 'Content-Type: application/json' \
      -d "{\"text\":\"$escaped\"}" "$DAILY_SUMMARY_ALERT_WEBHOOK_URL" >/dev/null 2>&1 || true
  fi
}

monitor() {
  LOCK_MODE="skip"
  acquire_lock
  local -a failures=()
  local response integrity backup_unix ai_failures available_kb now max_age max_ai min_disk
  now="$(date +%s)"
  max_age="${DAILY_SUMMARY_MONITOR_MAX_BACKUP_AGE_HOURS:-48}"
  max_ai="${DAILY_SUMMARY_MONITOR_MAX_AI_FAILURES:-3}"
  min_disk="${DAILY_SUMMARY_MONITOR_MIN_DISK_MB:-512}"
  [[ "$max_age" =~ ^[0-9]+$ ]] || fail "DAILY_SUMMARY_MONITOR_MAX_BACKUP_AGE_HOURS must be an integer"
  [[ "$max_ai" =~ ^[0-9]+$ ]] || fail "DAILY_SUMMARY_MONITOR_MAX_AI_FAILURES must be an integer"
  [[ "$min_disk" =~ ^[0-9]+$ ]] || fail "DAILY_SUMMARY_MONITOR_MIN_DISK_MB must be an integer"
  if ! systemctl is-active --quiet "$SERVICE_NAME"; then
    failures+=("service is not active")
  fi
  response="$(curl -fsS --max-time 5 http://127.0.0.1:8080/health 2>/dev/null || true)"
  if [ -z "$response" ]; then
    failures+=("health endpoint is unreachable")
  else
    integrity="$(printf '%s\n' "$response" | sed -n 's/.*"database_integrity"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
    [ "$integrity" = "ok" ] || failures+=("SQLite quick-check is ${integrity:-unknown}")
    backup_unix="$(json_number "$response" last_backup_unix)"
    if [ -z "$backup_unix" ] || ((now - backup_unix > max_age * 3600)); then
      failures+=("latest local backup is missing or older than ${max_age}h")
    fi
    ai_failures="$(json_number "$response" ai_consecutive_failures)"
    if [ -n "$ai_failures" ] && ((ai_failures >= max_ai)); then
      failures+=("AI has ${ai_failures} consecutive failures")
    fi
  fi
  available_kb="$(df -Pk "$DATA_DIR" | awk 'NR == 2 {print $4}')"
  if [ -z "$available_kb" ] || ((available_kb < min_disk * 1024)); then
    failures+=("free disk space is below ${min_disk}MB")
  fi
  if restic_configured; then
    local offsite_unix=""
    [ -f "$STATUS_DIR/offsite-last-success" ] && offsite_unix="$(cat "$STATUS_DIR/offsite-last-success")"
    if ! [[ "$offsite_unix" =~ ^[0-9]+$ ]] || ((now - offsite_unix > max_age * 3600)); then
      failures+=("latest offsite backup is missing or older than ${max_age}h")
    fi
  fi
  if [ "${#failures[@]}" -gt 0 ]; then
    local message
    message="daily-summary monitor failed: $(IFS='; '; echo "${failures[*]}")"
    send_alert "$message"
    return 1
  fi
  info "Service, backup freshness, disk space, SQLite and AI checks passed"
}

command="${1:-help}"
case "$command" in
  local-backup)
    acquire_lock
    create_snapshot
    ;;
  backup-bundle)
    acquire_lock
    output="${2:-$PWD/daily-summary-migration-$(date +%Y%m%d-%H%M%S).tar.gz}"
    create_bundle "$output"
    ;;
  verify-bundle)
    [ "$#" -eq 2 ] || fail "verify-bundle requires a bundle path"
    acquire_lock
    verify_bundle "$2"
    ;;
  restore)
    [ "$#" -eq 2 ] || fail "restore requires a bundle path"
    restore_bundle "$2"
    ;;
  init-offsite)
    acquire_lock
    init_offsite
    ;;
  offsite-backup)
    offsite_backup
    ;;
  verify-offsite)
    verify_offsite
    ;;
  restore-offsite)
    restore_offsite
    ;;
  monitor)
    monitor
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    usage >&2
    fail "Unknown command: $command"
    ;;
esac
