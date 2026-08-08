#!/usr/bin/env bash
# SessionStart: when the oso-code this session loaded is behind the newest
# release published for it, say so in one line — the installed version, the
# published one, and the commands that close the gap. Every other answer is
# silence: an install whose marketplace is not this plugin's own repository, a
# version neither side can read, a network that answers nothing inside the bound
# below, and a compaction inside a session that already had a start.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

RELEASE_VERSION_PATTERN='^[0-9]+\.[0-9]+\.[0-9]+$'

# What both halves of the comparison have to be before either is worth reading:
# a `major.minor.patch` release. A published tag shaped any other way and a
# manifest whose version is missing or reads `unknown` are the same answer here.
is_release_version() {
  [[ "$1" =~ $RELEASE_VERSION_PATTERN ]]
}

# A release version as a fixed-width key, because the string comparison that
# orders two keys orders them by number and the versions themselves do not:
# 0.9.0 stands above 0.17.0 byte for byte. Each component is read base 10, or a
# patch written 08 would be an invalid octal literal rather than the number 8.
release_sort_key() {
  local version="$1" minor
  minor="${version#*.}"
  printf '%05d%05d%05d' \
    "$((10#${version%%.*}))" "$((10#${minor%%.*}))" "$((10#${version##*.}))"
}

# The highest release version on stdin, one per line. GitHub advertises tags in
# name order, which puts v0.5.0 after v0.19.0, so the fold below is what decides
# which one is newest rather than the order they arrive in.
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

# curl carries its own connect and transfer bounds, which is why the download in
# bootstrap/install.sh reaches for them rather than GNU timeout(1) — macOS ships
# none of it — and why the tag list is read as the ref advertisement over HTTP
# instead of through `git ls-remote`, whose bound would have to come from
# somewhere else. This repository's advertisement answered in under a third of a
# second from a developer machine, so four seconds is the wall a stalled
# connection hits, not a budget a working one spends.
FETCH_CONNECT_SECONDS=2
FETCH_TOTAL_SECONDS=4

# The newest release published under a GitHub repository, from the same ref
# advertisement `git ls-remote` reads: one `<sha> refs/tags/<name>` per line,
# with an annotated tag's peeled object on a `^{}` line the anchor below skips.
# Nothing is printed when the fetch answers nothing, and no reason is printed
# either — the operator gets one line about a version they can act on or
# nothing at all, never a report about this check's own reach.
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
# One published answer per day. The fetch above is the only part of this check
# that leaves the machine, and a session start is not the place to spend network
# time, so the ordinary start reads a file and stops. A fetch that answered
# nothing caches an empty answer on the same clock, which is what holds an
# offline machine to one bounded attempt a day instead of one per session.
PUBLISHED_RELEASE_MAX_AGE_SECONDS=86400

# The cached answer while it is inside that window. An age nobody can read and a
# window already spent are both misses, and a miss is never a guess: the caller
# refreshes and reads again.
cached_published_release() {
  local age
  age="$(seconds_since_modified "$PUBLISHED_RELEASE_CACHE")" || return 1
  [ "$age" -lt "$PUBLISHED_RELEASE_MAX_AGE_SECONDS" ] || return 1
  cat "$PUBLISHED_RELEASE_CACHE" 2>/dev/null || true
}

# The rename is atomic, so a session starting while this one fetches reads the
# previous answer or the new one and never a half-written version string.
refresh_published_release_cache() {
  local repository_slug="$1" pending
  mkdir -p "$OSO_STATE_DIR" 2>/dev/null || return 1
  pending="$(mktemp "${PUBLISHED_RELEASE_CACHE}.XXXXXX" 2>/dev/null)" || return 1
  published_release_version "$repository_slug" > "$pending" 2>/dev/null || true
  mv -f "$pending" "$PUBLISHED_RELEASE_CACHE" 2>/dev/null || rm -f "$pending"
}

KNOWN_MARKETPLACES="${HOME}/.claude/plugins/known_marketplaces.json"

# Whether this machine registers a marketplace served from the repository whose
# tags are about to be read. A local clone registered as a `directory` source —
# the shape a machine developing this plugin has — names no repository here and
# loads whatever its working tree holds, so it has no published version to be
# behind and hears nothing. Whitespace goes first because a repository name
# carries none, which leaves one spelling to match however the client indents.
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

# The `owner/name` the marketplace registry spells a GitHub source with, taken
# from the manifest of the plugin this hook is installed beside. Any other host
# answers nothing, because the ref advertisement above is a GitHub URL.
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

# Refreshing the marketplace is what lets the second command reach a new version
# at all: the client installs from its own clone of the marketplace, and `plugin
# update` on its own reinstalls whatever that clone already holds. Both spellings
# are the ones bootstrap/install.sh runs and README documents.
UPDATE_COMMANDS='claude plugin marketplace update oso-code && claude plugin update oso-code@oso-code'

payload="$(cat)"
# A compaction restarts this event inside a session that already had a start, and
# repeating the line there buys the operator nothing. Any other source — a start,
# a resume, a clear, one this hook has never met — is a session that has not been
# through this yet.
[ "$(json_field "$payload" source)" != compact ] || exit 0

# The version of the code this session actually loaded, read from the manifest
# beside it rather than from the client's own install record: that record can
# hold several entries for one plugin, and which of them this session is running
# is a question the directory this hook sits in has already answered.
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
