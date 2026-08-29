# The release-published hashes of the gate files the OpenCode host runs, read
# the one way for both the installer that verifies what it just wrote and the
# verifier that re-reads an installed tree. bootstrap/hook-hashes.txt is shared
# with Codex, whose own trust set is the `codex/` lines this one skips.
#
# Sourced, not executed: functions only.

OPENCODE_TRUST_FILE_COUNT=19

opencode_sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{ print $1 }'
  else
    printf ''
  fi
}

opencode_trust_file_under() {
  local root_kind=$1 root=$2 relative=$3
  if [ "$root_kind" = source ]; then
    printf '%s' "$root/$relative"
    return 0
  fi
  case "$relative" in
    opencode/hooks/routes.ts) printf '%s' "$root/hooks/routes.ts" ;;
    plugin/dist/*) printf '%s' "$root/dist/${relative#plugin/dist/}" ;;
    plugin/hooks/*) printf '%s' "$root/hooks/${relative#plugin/hooks/}" ;;
    plugin/git-hooks/*) printf '%s' "$root/git-hooks/${relative#plugin/git-hooks/}" ;;
    plugin/bin/*) printf '%s' "$root/bin/${relative#plugin/bin/}" ;;
  esac
}

opencode_trust_divergence() {
  local hashes=$1 root_kind=$2 root=$3 expected relative target actual
  OPENCODE_TRUST_FILES_READ=0
  if [ ! -f "$hashes" ]; then
    printf '%s missing-manifest\n' "$hashes"
    return 0
  fi
  while IFS='  ' read -r expected relative; do
    case "$expected" in ''|'#'*) continue ;; esac
    relative="${relative# }"
    case "$relative" in codex/*) continue ;; esac
    OPENCODE_TRUST_FILES_READ=$((OPENCODE_TRUST_FILES_READ + 1))
    case "$expected" in
      *[!0-9a-f]*|'') printf '%s malformed-published-hash\n' "$relative"; continue ;;
    esac
    if [ "${#expected}" -ne 64 ]; then
      printf '%s malformed-published-hash\n' "$relative"
      continue
    fi
    target="$(opencode_trust_file_under "$root_kind" "$root" "$relative")"
    if [ -z "$target" ]; then
      printf '%s outside-the-trust-set\n' "$relative"
      continue
    fi
    if [ ! -f "$target" ]; then
      printf '%s missing\n' "$relative"
      continue
    fi
    actual="$(opencode_sha256_file "$target")"
    if [ -z "$actual" ]; then
      printf '%s no-sha256-command\n' "$relative"
      continue
    fi
    [ "$actual" = "$expected" ] || printf '%s %s\n' "$relative" "$actual"
  done < "$hashes"
}
