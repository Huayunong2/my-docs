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
RESTORE_JOURNAL="$DATA_DIR/.restore-rollback"
LAST_SNAPSHOT=""
VERIFIED_DIR=""
LOCK_MODE="fail"
LOCK_ACQUIRED=0
RESTORE_IN_PROGRESS=0
RESTORE_WAS_ACTIVE=0
TEMP_PATHS=()
COMMAND="${1:-help}"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

if [ -f "$BACKUP_ENV_FILE" ] && [ "$COMMAND" != "recover-restore" ]; then
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
  if [ "$RESTORE_IN_PROGRESS" = "1" ]; then
    set +e
    $SUDO systemctl stop "$SERVICE_NAME" >/dev/null 2>&1
    if rollback_pending_restore && [ "$RESTORE_WAS_ACTIVE" = "1" ]; then
      $SUDO systemctl start "$SERVICE_NAME" >/dev/null 2>&1
    fi
  fi
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
  ./ops.sh maintain-backups
  ./ops.sh verify-bundle <bundle.tar.gz>
  ./ops.sh restore <bundle.tar.gz>
  ./ops.sh init-offsite
  ./ops.sh offsite-backup
  ./ops.sh verify-offsite
  ./ops.sh restore-offsite
  ./ops.sh recover-restore
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
  local wait_seconds="${DAILY_SUMMARY_LOCK_WAIT_SECONDS:-0}"
  [[ "$wait_seconds" =~ ^[0-9]+$ ]] || fail "DAILY_SUMMARY_LOCK_WAIT_SECONDS must be an integer"
  local lock_result=0
  if [ "$wait_seconds" -gt 0 ]; then
    flock -w "$wait_seconds" 9 || lock_result=$?
  else
    flock -n 9 || lock_result=$?
  fi
  if [ "$lock_result" -ne 0 ]; then
    if [ "$LOCK_MODE" = "skip" ]; then
      info "Deployment or maintenance is already running; skipping this monitor cycle"
      exit 0
    fi
    fail "Deployment or maintenance is already running"
  fi
  LOCK_ACQUIRED=1
  cleanup_stale_external_temp_files
}

require_server_bin() {
  [ -x "$SERVER_BIN" ] || fail "Server binary not found. Run ./setup.sh first: $SERVER_BIN"
}

disk_usage_percent() {
  local path="${1:-$DATA_DIR}"
  df -Pk "$path" 2>/dev/null \
    | awk 'NR == 2 { value=$5; gsub(/%/, "", value); print value }'
}

ensure_backup_capacity() {
  local path="${1:-$DATA_DIR}"
  local usage
  usage="$(disk_usage_percent "$path" || true)"
  [[ "$usage" =~ ^[0-9]+$ ]] || fail "Could not determine disk usage before creating a backup"
  if [ "$usage" -ge 90 ]; then
    fail "Disk usage is ${usage}%; refusing to create a new backup at or above 90%"
  fi
}

prepare_backup_storage() {
  require_server_bin
  "$SERVER_BIN" --maintain-backups >/dev/null
  ensure_backup_capacity "$DATA_DIR"
}

cleanup_stale_external_temp_files() {
  local temp_root="${TMPDIR:-/tmp}"
  [ -d "$temp_root" ] || return 0
  find "$temp_root" -maxdepth 1 -mindepth 1 -uid "$(id -u)" \
    \( -name 'daily-summary-ops.*' -o -name '.daily-summary-ops.*' \) \
    -mmin +1440 -exec rm -rf -- {} + 2>/dev/null || true
  if [ -d "$APP_DIR/server" ]; then
    find "$APP_DIR/server" -maxdepth 1 -type f -uid "$(id -u)" \
      -name '.env.restore-*' -mmin +1440 -delete 2>/dev/null || true
  fi
  find "$APP_DIR" -maxdepth 1 -type d -uid "$(id -u)" \
    -name '.deploy-stage.*' -mmin +1440 -exec rm -rf -- {} + 2>/dev/null || true
}

cleanup_stale_bundle_temp_files() {
  local output_dir="$1"
  find "$output_dir" -maxdepth 1 -type f -uid "$(id -u)" \
    -name '.daily-summary-ops.bundle.*.next' -mmin +1440 -delete 2>/dev/null || true
}

create_snapshot() {
  prepare_backup_storage
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
  "$SERVER_BIN" --maintain-backups >/dev/null
  info "Created verified SQLite snapshot: $destination"
}

package_bundle() {
  local database="$1"
  local output="$2"
  local output_dir output_name
  output_dir="$(dirname "$output")"
  output_name="$(basename "$output")"
  mkdir -p "$output_dir"
  output_dir="$(cd "$output_dir" && pwd -P)"
  output="$output_dir/$output_name"
  cleanup_stale_bundle_temp_files "$output_dir"
  ensure_backup_capacity "${TMPDIR:-/tmp}"
  ensure_backup_capacity "$output_dir"
  [ ! -e "$output" ] || fail "Bundle already exists: $output"
  local stage archive_next
  stage="$(mktemp -d "${TMPDIR:-/tmp}/daily-summary-ops.XXXXXX")"
  archive_next="$output_dir/.daily-summary-ops.bundle.$$.next"
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
  prepare_backup_storage
  local output_dir
  output_dir="$(dirname "$output")"
  mkdir -p "$output_dir"
  output_dir="$(cd "$output_dir" && pwd -P)"
  ensure_backup_capacity "${TMPDIR:-/tmp}"
  ensure_backup_capacity "$output_dir"
  local snapshot_dir snapshot
  snapshot_dir="$(mktemp -d "${TMPDIR:-/tmp}/daily-summary-ops.XXXXXX")"
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
  local max_compressed_mb="${DAILY_SUMMARY_BUNDLE_MAX_COMPRESSED_MB:-2048}"
  local max_extracted_mb="${DAILY_SUMMARY_BUNDLE_MAX_EXTRACTED_MB:-4096}"
  local min_free_mb="${DAILY_SUMMARY_BUNDLE_MIN_FREE_AFTER_EXTRACT_MB:-256}"
  [[ "$max_compressed_mb" =~ ^[0-9]+$ ]] || fail "DAILY_SUMMARY_BUNDLE_MAX_COMPRESSED_MB must be an integer"
  [[ "$max_extracted_mb" =~ ^[0-9]+$ ]] || fail "DAILY_SUMMARY_BUNDLE_MAX_EXTRACTED_MB must be an integer"
  [[ "$min_free_mb" =~ ^[0-9]+$ ]] || fail "DAILY_SUMMARY_BUNDLE_MIN_FREE_AFTER_EXTRACT_MB must be an integer"
  local compressed_bytes
  compressed_bytes="$(stat -c '%s' "$bundle")"
  ((compressed_bytes <= max_compressed_mb * 1024 * 1024)) \
    || fail "Bundle exceeds the ${max_compressed_mb}MB compressed-size limit"

  local entry stage entry_count=0 extracted_bytes=0
  local -A seen_entries=()
  while IFS= read -r entry; do
    entry_count=$((entry_count + 1))
    [ "$entry_count" -le 4 ] || fail "Bundle contains too many entries"
    case "$entry" in
      manifest|SHA256SUMS|database.db|server.env) ;;
      *) fail "Bundle contains an unexpected path: $entry" ;;
    esac
    [ -z "${seen_entries[$entry]:-}" ] || fail "Bundle contains a duplicate entry: $entry"
    seen_entries[$entry]=1
  done < <(tar -tzf "$bundle")
  [ "$entry_count" -ge 3 ] || fail "Bundle is incomplete"
  local entry_type entry_size
  while read -r entry_type entry_size; do
    [ "$entry_type" = "-" ] || fail "Bundle contains a non-regular entry"
    [[ "$entry_size" =~ ^[0-9]+$ ]] || fail "Bundle contains an invalid entry size"
    extracted_bytes=$((extracted_bytes + entry_size))
  done < <(tar --numeric-owner -tvzf "$bundle" | awk '{print substr($1, 1, 1), $3}')
  ((extracted_bytes <= max_extracted_mb * 1024 * 1024)) \
    || fail "Bundle exceeds the ${max_extracted_mb}MB extracted-size limit"
  local temp_root="${TMPDIR:-/tmp}" temp_available_kb
  temp_available_kb="$(df -Pk "$temp_root" 2>/dev/null | awk 'NR == 2 {print $4}' || true)"
  [[ "$temp_available_kb" =~ ^[0-9]+$ ]] || fail "Could not determine free space for bundle extraction: $temp_root"
  ((extracted_bytes + min_free_mb * 1024 * 1024 <= temp_available_kb * 1024)) \
    || fail "Bundle extraction would leave less than ${min_free_mb}MB free in $temp_root"
  stage="$(mktemp -d "${TMPDIR:-/tmp}/daily-summary-ops.XXXXXX")"
  TEMP_PATHS+=("$stage")
  tar -xzf "$bundle" -C "$stage" --no-same-owner --no-same-permissions
  [ -f "$stage/manifest" ] && [ ! -L "$stage/manifest" ] || fail "Bundle manifest is missing or unsafe"
  [ -f "$stage/SHA256SUMS" ] && [ ! -L "$stage/SHA256SUMS" ] || fail "Bundle checksums are missing or unsafe"
  [ -f "$stage/database.db" ] && [ ! -L "$stage/database.db" ] || fail "Bundle database is missing or unsafe"
  if [ -e "$stage/server.env" ] && { [ ! -f "$stage/server.env" ] || [ -L "$stage/server.env" ]; }; then
    fail "Bundle environment file is unsafe"
  fi
  if [ -f "$stage/server.env" ] && [ ! -s "$stage/server.env" ]; then
    fail "Bundle environment file is empty"
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
  if [ ! -f "$current" ]; then
    install -m 0600 "$restored" "$output"
    return
  fi
  awk -F= '
    NR == FNR {
      if ($1 == "DAILY_SUMMARY_TOKEN" || $1 ~ /^DAILY_SUMMARY_AI_/) {
        restored[$1] = substr($0, index($0, "=") + 1)
      }
      next
    }
    {
      key = $1
      if (key in restored) {
        print key "=" restored[key]
      } else {
        print
      }
      seen[key] = 1
    }
    END {
      for (key in restored) {
        if (!seen[key]) print key "=" restored[key]
      }
    }
  ' "$restored" "$current" >"$output"
  chmod 600 "$output"
}

wait_for_service() {
  local attempt response url
  url="$(health_url)"
  for ((attempt = 1; attempt <= 20; attempt++)); do
    if systemctl is-active --quiet "$SERVICE_NAME"; then
      response="$(curl -fsS --max-time 2 "$url" 2>/dev/null || true)"
      if echo "$response" | grep -q '"version"'; then
        return 0
      fi
    fi
    sleep 1
  done
  return 1
}

health_url() {
  local bind=""
  if [ -f "$ENV_FILE" ]; then
    bind="$(grep -E '^DAILY_SUMMARY_BIND=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
  fi
  bind="${bind:-0.0.0.0:8080}"
  case "$bind" in
    0.0.0.0:*) bind="127.0.0.1:${bind#*:}" ;;
    \[::\]:*) bind="127.0.0.1:${bind##*:}" ;;
  esac
  printf 'http://%s/health\n' "$bind"
}

detailed_health_url() {
  local public_url
  public_url="$(health_url)"
  printf '%s/api/health\n' "${public_url%/health}"
}

server_token() {
  [ -f "$ENV_FILE" ] || return 0
  grep -E '^DAILY_SUMMARY_TOKEN=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true
}

current_boot_id() {
  if [ -r /proc/sys/kernel/random/boot_id ]; then
    tr -d '\n' </proc/sys/kernel/random/boot_id
  else
    printf 'unknown'
  fi
}

restore_owner_is_active() {
  local owner_pid owner_boot owner_start current_start
  [ -f "$RESTORE_JOURNAL/owner.pid" ] || return 1
  [ -f "$RESTORE_JOURNAL/owner.boot-id" ] || return 1
  owner_pid="$(cat "$RESTORE_JOURNAL/owner.pid")"
  owner_boot="$(cat "$RESTORE_JOURNAL/owner.boot-id")"
  [[ "$owner_pid" =~ ^[0-9]+$ ]] || return 1
  [ "$owner_boot" = "$(current_boot_id)" ] || return 1
  kill -0 "$owner_pid" 2>/dev/null || return 1
  if [ -f "$RESTORE_JOURNAL/owner.start-time" ] && [ -r "/proc/$owner_pid/stat" ]; then
    owner_start="$(cat "$RESTORE_JOURNAL/owner.start-time")"
    current_start="$(awk '{print $22}' "/proc/$owner_pid/stat" 2>/dev/null || true)"
    [ -n "$owner_start" ] && [ "$owner_start" = "$current_start" ] || return 1
  fi
}

rollback_pending_restore() {
  [ -d "$RESTORE_JOURNAL" ] || return 0
  if grep -qx committed "$RESTORE_JOURNAL/phase" 2>/dev/null; then
    return 1
  fi
  if [ -f "$RESTORE_JOURNAL/had-db" ]; then
    [ -f "$RESTORE_JOURNAL/database.db" ] || return 1
    install -m 0600 "$RESTORE_JOURNAL/database.db" "$DB_PATH" || return 1
  else
    rm -f "$DB_PATH" || return 1
  fi
  if [ -f "$RESTORE_JOURNAL/had-env" ]; then
    [ -f "$RESTORE_JOURNAL/server.env" ] || return 1
    install -m 0600 "$RESTORE_JOURNAL/server.env" "$ENV_FILE" || return 1
  else
    rm -f "$ENV_FILE" || return 1
  fi
  rm -rf "$RESTORE_JOURNAL" || return 1
  sync -f "$DATA_DIR" 2>/dev/null || true
  sync -f "$APP_DIR/server" 2>/dev/null || true
}

finalize_committed_restore() {
  [ -d "$RESTORE_JOURNAL" ] || return 0
  grep -qx committed "$RESTORE_JOURNAL/phase" 2>/dev/null || return 1
  rm -rf "$RESTORE_JOURNAL" || return 1
  sync -f "$DATA_DIR" 2>/dev/null || true
}

recover_pending_restore() {
  [ -d "$RESTORE_JOURNAL" ] || return 0
  if grep -qx committed "$RESTORE_JOURNAL/phase" 2>/dev/null; then
    info "Finalizing a committed restore transaction"
    if ! finalize_committed_restore; then
      info "Warning: committed restore journal could not be removed; restored data will not be rolled back: $RESTORE_JOURNAL"
    fi
    return 0
  fi
  if restore_owner_is_active; then
    info "A restore transaction owned by PID $(cat "$RESTORE_JOURNAL/owner.pid") is still active"
    return 0
  fi
  local restart_service=0
  if has_cmd systemctl && systemctl is-active --quiet "$SERVICE_NAME"; then
    restart_service=1
    $SUDO systemctl stop "$SERVICE_NAME"
  fi
  info "Recovering an interrupted restore transaction"
  rollback_pending_restore || fail "Interrupted restore could not be rolled back; journal retained at $RESTORE_JOURNAL"
  if [ "$restart_service" = "1" ]; then
    $SUDO systemctl start "$SERVICE_NAME"
  fi
  info "Interrupted restore was rolled back"
}

write_database_status() {
  local status="$1"
  local next
  mkdir -p "$STATUS_DIR"
  next="$STATUS_DIR/.database-integrity.$$"
  TEMP_PATHS+=("$next")
  printf '%s %s\n' "$(date +%s)" "$status" >"$next"
  chmod 600 "$next"
  mv -f "$next" "$STATUS_DIR/database-integrity"
}

check_database_integrity() {
  local stage snapshot
  stage="$(mktemp -d "$DATA_DIR/.integrity-check.XXXXXX")"
  snapshot="$stage/database.db"
  TEMP_PATHS+=("$stage")
  "$SERVER_BIN" --snapshot "$snapshot" >/dev/null 2>&1 \
    && "$SERVER_BIN" --verify-db "$snapshot" >/dev/null 2>&1
}

preflight_restored_server() {
  if [ ! -f "$ENV_FILE" ]; then
    DAILY_SUMMARY_BIND=127.0.0.1:0 DAILY_SUMMARY_ALLOW_NO_TOKEN=1 \
      "$SERVER_BIN" --check-startup >/dev/null 2>&1
    return
  fi
  has_cmd systemd-run || fail "systemd-run is required for environment-equivalent restore validation"
  $SUDO systemd-run --quiet --wait --collect --pipe \
    --unit="$SERVICE_NAME-restore-preflight-$$" \
    --uid="$(id -u)" \
    --working-directory="$APP_DIR/server" \
    --property="EnvironmentFile=$ENV_FILE" \
    "$SERVER_BIN" --check-startup >/dev/null 2>&1
}

restore_bundle() {
  local bundle="$1"
  has_cmd systemctl || fail "Restore requires systemd service coordination"
  acquire_lock
  require_server_bin
  "$SERVER_BIN" --maintain-backups >/dev/null
  ensure_backup_capacity
  recover_pending_restore
  verify_bundle "$bundle"
  mkdir -p "$DATA_DIR" "$BACKUP_DIR"
  chmod 700 "$DATA_DIR" "$BACKUP_DIR" 2>/dev/null || true
  local was_active=0 had_db=0 had_env=0 timestamp previous_db next_db next_env journal_next
  timestamp="$(date +%Y%m%d-%H%M%S)"
  previous_db="$BACKUP_DIR/pre-restore-$timestamp-$$.db"
  next_db="$DATA_DIR/.data.db.restore-$$"
  next_env="$APP_DIR/server/.env.restore-$$"
  journal_next="$DATA_DIR/.restore-rollback.next.$$"
  TEMP_PATHS+=("$next_db" "$next_env" "$journal_next")
  if [ -f "$DB_PATH" ]; then
    had_db=1
  fi
  if [ -f "$ENV_FILE" ]; then
    had_env=1
  fi
  install -m 0600 "$VERIFIED_DIR/database.db" "$next_db"
  if [ -f "$VERIFIED_DIR/server.env" ]; then
    merge_restored_env "$VERIFIED_DIR/server.env" "$ENV_FILE" "$next_env"
  fi
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    was_active=1
    $SUDO systemctl stop "$SERVICE_NAME"
  fi
  RESTORE_IN_PROGRESS=1
  RESTORE_WAS_ACTIVE="$was_active"
  mkdir -m 0700 "$journal_next"
  if [ "$had_db" = "1" ]; then
    if ! install -m 0600 "$DB_PATH" "$journal_next/database.db"; then
      fail "Could not preserve the current database before restore"
    fi
    touch "$journal_next/had-db"
    install -m 0600 "$DB_PATH" "$previous_db"
    "$SERVER_BIN" --maintain-backups >/dev/null
  fi
  if [ "$had_env" = "1" ]; then
    install -m 0600 "$ENV_FILE" "$journal_next/server.env"
    touch "$journal_next/had-env"
  fi
  printf '%s\n' "$$" >"$journal_next/owner.pid"
  current_boot_id >"$journal_next/owner.boot-id"
  awk '{print $22}' "/proc/$$/stat" >"$journal_next/owner.start-time" 2>/dev/null || true
  printf 'prepared\n' >"$journal_next/phase"
  chmod 600 "$journal_next"/*
  mv "$journal_next" "$RESTORE_JOURNAL"
  sync -f "$DATA_DIR" 2>/dev/null || true
  if ! mv -f "$next_db" "$DB_PATH"; then
    fail "Could not activate the restored database"
  fi
  if [ -f "$VERIFIED_DIR/server.env" ] && ! mv -f "$next_env" "$ENV_FILE"; then
    fail "Could not activate the restored environment"
  fi

  if ! preflight_restored_server; then
    rollback_pending_restore || fail "Restore failed and automatic rollback failed; journal retained at $RESTORE_JOURNAL"
    RESTORE_IN_PROGRESS=0
    [ "$was_active" = "1" ] && $SUDO systemctl start "$SERVICE_NAME" >/dev/null 2>&1 || true
    fail "Restored server failed isolated startup validation; previous database and environment were restored"
  fi
  write_database_status ok
  sync -f "$DB_PATH" 2>/dev/null || true
  sync -f "$APP_DIR/server" 2>/dev/null || true
  printf 'committed\n' >"$RESTORE_JOURNAL/phase"
  sync -f "$RESTORE_JOURNAL" 2>/dev/null || true
  RESTORE_IN_PROGRESS=0
  if ! finalize_committed_restore; then
    info "Warning: restore is committed but its journal could not be removed; startup will continue"
  fi
  if [ "$was_active" = "1" ]; then
    if ! $SUDO systemctl start "$SERVICE_NAME" || ! wait_for_service; then
      $SUDO systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
      fail "Restore was committed, but the service failed its health check; restored data and $previous_db were retained"
    fi
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
  stage="$(mktemp -d "${TMPDIR:-/tmp}/daily-summary-ops.XXXXXX")"
  TEMP_PATHS+=("$stage")
  bundle="$stage/daily-summary-bundle-$(date +%Y%m%d-%H%M%S).tar.gz"
  package_bundle "$LAST_SNAPSHOT" "$bundle"
  restic backup "$bundle" --tag daily-summary
  restic forget --tag daily-summary \
    --group-by host,tags \
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
  prepare_backup_storage
  require_restic_config
  restic check
  local target bundle
  target="$(mktemp -d "${TMPDIR:-/tmp}/daily-summary-ops.XXXXXX")"
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
  prepare_backup_storage
  require_restic_config
  local target bundle
  target="$(mktemp -d "${TMPDIR:-/tmp}/daily-summary-ops.XXXXXX")"
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
  local response integrity backup_unix ai_failures available_kb disk_percent now max_age max_verify_age max_ai min_disk db_check_interval
  now="$(date +%s)"
  max_age="${DAILY_SUMMARY_MONITOR_MAX_BACKUP_AGE_HOURS:-48}"
  max_verify_age="${DAILY_SUMMARY_MONITOR_MAX_VERIFY_AGE_HOURS:-192}"
  max_ai="${DAILY_SUMMARY_MONITOR_MAX_AI_FAILURES:-3}"
  min_disk="${DAILY_SUMMARY_MONITOR_MIN_DISK_MB:-512}"
  db_check_interval="${DAILY_SUMMARY_MONITOR_DB_CHECK_INTERVAL_HOURS:-24}"
  [[ "$max_age" =~ ^[0-9]+$ ]] || fail "DAILY_SUMMARY_MONITOR_MAX_BACKUP_AGE_HOURS must be an integer"
  [[ "$max_verify_age" =~ ^[0-9]+$ ]] || fail "DAILY_SUMMARY_MONITOR_MAX_VERIFY_AGE_HOURS must be an integer"
  [[ "$max_ai" =~ ^[0-9]+$ ]] || fail "DAILY_SUMMARY_MONITOR_MAX_AI_FAILURES must be an integer"
  [[ "$min_disk" =~ ^[0-9]+$ ]] || fail "DAILY_SUMMARY_MONITOR_MIN_DISK_MB must be an integer"
  [[ "$db_check_interval" =~ ^[0-9]+$ ]] || fail "DAILY_SUMMARY_MONITOR_DB_CHECK_INTERVAL_HOURS must be an integer"
  if ! systemctl is-active --quiet "$SERVICE_NAME"; then
    failures+=("service is not active")
  fi
  local token
  token="$(server_token)"
  if [ -z "$token" ]; then
    failures+=("server token is unavailable for detailed health monitoring")
    response=""
  else
    response="$(curl -fsS --max-time 5 -H "Authorization: Bearer $token" "$(detailed_health_url)" 2>/dev/null || true)"
  fi
  if [ -z "$response" ]; then
    failures+=("health endpoint is unreachable")
  else
    backup_unix="$(json_number "$response" last_backup_unix)"
    if [ -z "$backup_unix" ] || ((now - backup_unix > max_age * 3600)); then
      failures+=("latest local backup is missing or older than ${max_age}h")
    fi
    ai_failures="$(json_number "$response" ai_consecutive_failures)"
    if [ -n "$ai_failures" ] && ((ai_failures >= max_ai)); then
      failures+=("AI has ${ai_failures} consecutive failures")
    fi
  fi
  local integrity_unix=""
  if [ -f "$STATUS_DIR/database-integrity" ]; then
    read -r integrity_unix integrity <"$STATUS_DIR/database-integrity" || true
  fi
  if ! [[ "$integrity_unix" =~ ^[0-9]+$ ]] || ((now - integrity_unix >= db_check_interval * 3600)); then
    if check_database_integrity; then
      write_database_status ok
      integrity="ok"
    else
      write_database_status error
      integrity="error"
    fi
  fi
  [ "$integrity" = "ok" ] || failures+=("SQLite integrity check is ${integrity:-unknown}")
  disk_percent="$(disk_usage_percent "$DATA_DIR" || true)"
  if ! [[ "$disk_percent" =~ ^[0-9]+$ ]]; then
    failures+=("disk usage could not be determined")
  elif ((disk_percent >= 80)); then
    failures+=("disk usage is ${disk_percent}% (warning threshold 80%)")
  fi
  available_kb="$(df -Pk "$DATA_DIR" 2>/dev/null | awk 'NR == 2 {print $4}' || true)"
  if [ -z "$available_kb" ] || ((available_kb < min_disk * 1024)); then
    failures+=("free disk space is below ${min_disk}MB")
  fi
  if restic_configured; then
    local offsite_unix="" verify_unix=""
    [ -f "$STATUS_DIR/offsite-last-success" ] && offsite_unix="$(cat "$STATUS_DIR/offsite-last-success")"
    if ! [[ "$offsite_unix" =~ ^[0-9]+$ ]] || ((now - offsite_unix > max_age * 3600)); then
      failures+=("latest offsite backup is missing or older than ${max_age}h")
    fi
    [ -f "$STATUS_DIR/offsite-verify-last-success" ] && verify_unix="$(cat "$STATUS_DIR/offsite-verify-last-success")"
    if ! [[ "$verify_unix" =~ ^[0-9]+$ ]]; then
      if ! [[ "$offsite_unix" =~ ^[0-9]+$ ]] || ((now - offsite_unix > 3600)); then
        failures+=("offsite restore drill has not completed")
      fi
    elif ((now - verify_unix > max_verify_age * 3600)); then
      failures+=("latest offsite restore drill is missing or older than ${max_verify_age}h")
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

case "$COMMAND" in
  local-backup)
    acquire_lock
    create_snapshot
    ;;
  backup-bundle)
    acquire_lock
    output="${2:-$PWD/daily-summary-migration-$(date +%Y%m%d-%H%M%S).tar.gz}"
    create_bundle "$output"
    ;;
  maintain-backups)
    acquire_lock
    require_server_bin
    "$SERVER_BIN" --maintain-backups
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
  recover-restore)
    if [ "${2:-}" != "--startup" ]; then
      acquire_lock
    fi
    recover_pending_restore
    ;;
  monitor)
    monitor
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    usage >&2
    fail "Unknown command: $COMMAND"
    ;;
esac
