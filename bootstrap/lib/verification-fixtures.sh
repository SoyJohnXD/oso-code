# What every post-install verifier and bar does with a temporary fixture,
# written once so the Codex side and the OpenCode side cannot drift into two
# readings of the same `rm -rf` guard or two spellings of a folded report line.
# The guard stays exact: a caller names the mktemp prefixes it owns, and a root
# outside them is refused rather than removed.
#
# Sourced, not executed: functions only, no side effects at source time.

fold_lines() {
  tr '\n' ' ' | sed 's/[[:space:]][[:space:]]*/ /g; s/[[:space:]]*$//'
}

remove_temporary_fixture() {
  local fixture_root=$1 fixture_parent=$2 prefix
  shift 2
  [ "$#" -gt 0 ] || return 1
  [ -n "$fixture_root" ] && [ "$fixture_root" != / ] || return 1
  [ "$(dirname "$fixture_root")" = "$fixture_parent" ] || return 1
  for prefix in "$@"; do
    case "$(basename "$fixture_root")" in
      "$prefix".*)
        if [ -n "${OSO_KEEP_FIXTURE:-}" ]; then
          printf 'fixture kept for inspection: %s\n' "$fixture_root"
        else
          rm -rf "$fixture_root"
        fi
        return ;;
    esac
  done
  return 1
}
