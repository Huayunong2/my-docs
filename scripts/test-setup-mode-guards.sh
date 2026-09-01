#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP_SCRIPT="$ROOT_DIR/setup.sh"

extract_function() {
  local name="$1"
  awk -v signature="${name}()" '
    printing && $0 ~ /^[a-z_]+\(\) \{$/ { exit }
    $0 == signature " {" { printing = 1 }
    printing { print }
  ' "$SETUP_SCRIPT"
}

eval "$(extract_function configure_caddy_if_needed)"
eval "$(extract_function configure_firewall_if_needed)"
eval "$(extract_function mask_token)"
eval "$(extract_function token_display_text)"

MODE=ip
configure_caddy_if_needed

MODE=domain
configure_firewall_if_needed

short_token="$(mask_token "short")"
long_token="$(mask_token "test-token-1234567890")"
[ "$short_token" = "********" ]
[ "$long_token" = "test...7890" ]

ENV_FILE="/srv/daily-summary/server/.env"
TOKEN="test-token-1234567890"
result="$(token_display_text "$TOKEN")"
[[ "$result" == *"Access token: stored in /srv/daily-summary/server/.env (permissions 0600)"* ]]
[[ "$result" == *"Token hint:  test...7890"* ]]
[[ "$result" != *"$TOKEN"* ]]

grep -Fq 'DAILY_SUMMARY_LOCAL_AI_ACCESS=0' "$SETUP_SCRIPT"
grep -Fq 'DAILY_SUMMARY_LOCAL_AI_TOKEN=' "$SETUP_SCRIPT"

echo "setup mode guards: ok"
