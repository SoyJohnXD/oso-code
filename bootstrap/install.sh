#!/usr/bin/env bash
set -euo pipefail

BOOTSTRAP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_MAJOR_FLOOR=22
NODE_FIX="install Node.js $NODE_MAJOR_FLOOR or newer from https://nodejs.org, then re-run"

node_major_version() {
  local reported=absent
  if command -v node >/dev/null 2>&1; then reported="$(node --version 2>/dev/null || printf absent)"; fi
  case "$reported" in
    v[0-9]*) printf '%s' "${reported#v}" | cut -d. -f1 ;;
    *) printf 0 ;;
  esac
}

provision_node() {
  local -a install_command
  if   command -v brew    >/dev/null 2>&1; then install_command=(brew install node)
  elif command -v pacman  >/dev/null 2>&1; then install_command=(sudo pacman -S --noconfirm nodejs npm)
  elif command -v apt-get >/dev/null 2>&1; then install_command=(sudo apt-get install -y nodejs npm)
  elif command -v dnf     >/dev/null 2>&1; then install_command=(sudo dnf install -y nodejs npm)
  elif command -v winget  >/dev/null 2>&1; then install_command=(winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements --silent --scope user)
  else return 0
  fi
  printf '[oso-code] the installer itself runs on Node.js %s or newer — installing it with: %s\n' "$NODE_MAJOR_FLOOR" "${install_command[*]}"
  "${install_command[@]}"
}

if [ "$(node_major_version)" -lt "$NODE_MAJOR_FLOOR" ]; then
  provision_node || true
fi
if [ "$(node_major_version)" -lt "$NODE_MAJOR_FLOOR" ]; then
  printf '[oso-code] ERROR: Node.js %s or newer is required and this run could not provide it — %s\n' \
    "$NODE_MAJOR_FLOOR" "$NODE_FIX" >&2
  exit 1
fi

cd "$BOOTSTRAP_DIR"
exec node ./oso.js install --host claude "$@"
