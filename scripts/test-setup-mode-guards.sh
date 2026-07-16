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

MODE=ip
configure_caddy_if_needed

MODE=domain
configure_firewall_if_needed

echo "setup mode guards: ok"
