#!/usr/bin/env bash
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

RELEASE_VERSION_PATTERN='^[0-9]+\.[0-9]+\.[0-9]+$'

is_release_version() {
  [[ "$1" =~ $RELEASE_VERSION_PATTERN ]]
}

release_sort_key() {
  local version="$1" minor
  minor="${version#*.}"
  printf '%05d%05d%05d' \
    "$((10#${version%%.*}))" "$((10#${minor%%.*}))" "$((10#${version##*.}))"
}

highest_release_version() {
  local version key highest="" highest_key=""
  while IFS= read -r version; do
    key="$(release_sort_key "$version")"
    if [ -z "$highest_key" ] || [[ "$key" > "$highest_key" ]]; then
      highest="$version"
      highest_key="$key"
    fi
  done
  printf '%s' "$highest"
}

FETCH_CONNECT_SECONDS=2
FETCH_TOTAL_SECONDS=4

published_release_version() {
  local repository_slug="$1"
  curl -fsS --connect-timeout "$FETCH_CONNECT_SECONDS" \
    --max-time "$FETCH_TOTAL_SECONDS" \
    "https://github.com/${repository_slug}.git/info/refs?service=git-upload-pack" \
    2>/dev/null |
    sed -n 's|.*refs/tags/v\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)$|\1|p' |
    highest_release_version
}

PUBLISHED_RELEASE_CACHE="${OSO_STATE_DIR}/published-release"
PUBLISHED_RELEASE_MAX_AGE_SECONDS=86400

cached_published_release() {
  local age
  age="$(seconds_since_modified "$PUBLISHED_RELEASE_CACHE")" || return 1
  [ "$age" -lt "$PUBLISHED_RELEASE_MAX_AGE_SECONDS" ] || return 1
  cat "$PUBLISHED_RELEASE_CACHE" 2>/dev/null || true
}

refresh_published_release_cache() {
  local repository_slug="$1" pending
  mkdir -p "$OSO_STATE_DIR" 2>/dev/null || return 1
  pending="$(mktemp "${PUBLISHED_RELEASE_CACHE}.XXXXXX" 2>/dev/null)" || return 1
  published_release_version "$repository_slug" > "$pending" 2>/dev/null || true
  mv -f "$pending" "$PUBLISHED_RELEASE_CACHE" 2>/dev/null || rm -f "$pending"
}

KNOWN_MARKETPLACES="${HOME}/.claude/plugins/known_marketplaces.json"

marketplace_serves_repository() {
  local repository_slug="$1" registrations
  [ -r "$KNOWN_MARKETPLACES" ] || return 1
  registrations="$(tr -d '[:space:]' < "$KNOWN_MARKETPLACES" 2>/dev/null)" || return 1
  case "$registrations" in
    *"\"repo\":\"${repository_slug}\""*) return 0 ;;
  esac
  return 1
}

GITHUB_URL_PREFIX="https://github.com/"

repository_slug_of() {
  local repository_url="$1" repository_slug
  case "$repository_url" in
    "$GITHUB_URL_PREFIX"?*) ;;
    *) return 1 ;;
  esac
  repository_slug="${repository_url#"$GITHUB_URL_PREFIX"}"
  printf '%s' "${repository_slug%.git}"
}

PLUGIN_MANIFEST="$(dirname "$HOOK_DIR")/.claude-plugin/plugin.json"

UPDATE_COMMANDS='claude plugin marketplace update oso-code && claude plugin update oso-code@oso-code'

payload="$(cat)"
[ "$(json_field "$payload" source)" != compact ] || exit 0

manifest="$(cat "$PLUGIN_MANIFEST" 2>/dev/null || true)"
installed_version="$(json_field "$manifest" version)"
is_release_version "$installed_version" || exit 0

repository_slug="$(repository_slug_of "$(json_field "$manifest" repository)")" || exit 0
marketplace_serves_repository "$repository_slug" || exit 0

if ! published_version="$(cached_published_release)"; then
  refresh_published_release_cache "$repository_slug" || true
  published_version="$(cached_published_release || true)"
fi
is_release_version "$published_version" || exit 0
[[ "$(release_sort_key "$published_version")" > "$(release_sort_key "$installed_version")" ]] || exit 0

context="oso-code: this session runs plugin version ${installed_version} and the newest published release is ${published_version} — tell the user once, naming the update: ${UPDATE_COMMANDS}"
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$(json_escape "$context")"
exit 0
