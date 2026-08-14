#!/usr/bin/env bash
# Materialize an installed Impeccable skill for Codex.
#
# Usage: mount-impeccable.sh <source-skill-directory>
#
# The caller resolves Impeccable's Codex-specific `.agents` skill directory,
# usually from its marketplace checkout. This script deliberately does not
# preserve that source path: Codex reads the stable, user-wide copy below.

set -eu

usage() {
  echo "usage: mount-impeccable.sh <source-skill-directory>" >&2
}

if [ "$#" -ne 1 ]; then
  usage
  exit 2
fi

if [ -z "${HOME:-}" ]; then
  echo "mount-impeccable: HOME is not set" >&2
  exit 1
fi

source_dir=$1
if [ ! -d "$source_dir" ]; then
  echo "mount-impeccable: source is not a directory: $source_dir" >&2
  exit 1
fi
if [ ! -f "$source_dir/SKILL.md" ] || [ -L "$source_dir/SKILL.md" ]; then
  echo "mount-impeccable: source has no regular SKILL.md: $source_dir" >&2
  exit 1
fi
if [ ! -d "$source_dir/reference" ]; then
  echo "mount-impeccable: source has no reference directory: $source_dir" >&2
  exit 1
fi

if ! awk '
  NR == 1 { if ($0 != "---") exit 1; next }
  $0 == "---" { closed = 1; exit }
  END { if (!closed) exit 1 }
' "$source_dir/SKILL.md"; then
  echo "mount-impeccable: SKILL.md has no valid frontmatter block" >&2
  exit 1
fi
skill_name=$(awk '
  NR == 1 { next }
  $0 == "---" { exit }
  /^name: / { sub(/^name: /, ""); print }
' "$source_dir/SKILL.md")
skill_version=$(awk '
  NR == 1 { next }
  $0 == "---" { exit }
  /^version: / { sub(/^version: /, ""); print }
' "$source_dir/SKILL.md")
if [ "$skill_name" != impeccable ]; then
  echo "mount-impeccable: SKILL.md frontmatter must contain exactly name: impeccable" >&2
  exit 1
fi
if ! printf '%s\n' "$skill_version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "mount-impeccable: SKILL.md frontmatter has no valid version" >&2
  exit 1
fi

for command_name in init document audit; do
  command_reference=$source_dir/reference/$command_name.md
  if [ ! -f "$command_reference" ] || [ -L "$command_reference" ]; then
    echo "mount-impeccable: source has no regular reference/$command_name.md" >&2
    exit 1
  fi
done

# Impeccable publishes provider-specific compilations. A Claude compilation is
# structurally similar enough to copy successfully but teaches unusable paths
# and slash commands to Codex, so validate two stable provider markers first.
if ! grep -F '.agents/skills/impeccable' "$source_dir/SKILL.md" >/dev/null \
  || ! grep -F '$impeccable' "$source_dir/SKILL.md" >/dev/null; then
  echo "mount-impeccable: source is not the Codex .agents build" >&2
  exit 1
fi

source_dir=$(cd "$source_dir" && pwd -P)
skills_dir=$HOME/.agents/skills
target_dir=$skills_dir/impeccable

if [ -d "$target_dir" ] && [ "$(cd "$target_dir" && pwd -P)" = "$source_dir" ]; then
  echo "mount-impeccable: source and destination are the same directory" >&2
  exit 1
fi

mkdir -p "$skills_dir"
lock_registry=$skills_dir/.impeccable.mount.lock
lock_token=$$-${RANDOM:-0}-${RANDOM:-0}
owner_identity_leaf=identity
owner_dir=$lock_registry/owner.$lock_token
owner_identity_file=$owner_dir/$owner_identity_leaf
owner_identity=pid=$$\;token=$lock_token
owner_published=false
stage_dir=
backup_dir=
mounted=false
lock_read_pid=
lock_read_token=

read_owner_record() {
  inspected_owner=$1
  inspected_identity=$inspected_owner/$owner_identity_leaf
  lock_read_pid=
  lock_read_token=

  { [ -d "$inspected_owner" ] && [ ! -L "$inspected_owner" ] \
    && [ -f "$inspected_identity" ] && [ ! -L "$inspected_identity" ]; } || return 1
  owner_value=$(cat "$inspected_identity" 2>/dev/null) || return 1
  case "$owner_value" in
    pid=*';token='*) ;;
    *) return 1 ;;
  esac
  lock_read_pid=${owner_value#pid=}
  lock_read_pid=${lock_read_pid%%;token=*}
  lock_read_token=${owner_value#*;token=}
  case "$lock_read_pid" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$lock_read_pid" -gt 0 ] 2>/dev/null || return 1
  case "$lock_read_token" in
    ''|*[!a-zA-Z0-9._-]*) return 1 ;;
  esac
  [ "${inspected_owner##*/}" = "owner.$lock_read_token" ] || return 1
}

owner_is_live() {
  owner_pid=$1
  kill -0 "$owner_pid" 2>/dev/null || ps -p "$owner_pid" >/dev/null 2>&1
}

release_owned_lock() {
  [ "$owner_published" = true ] || return 0
  if [ "$(cat "$owner_identity_file" 2>/dev/null)" = "$owner_identity" ]; then
    rm -rf "$owner_dir"
  fi
  owner_published=false
}

acquire_lock() {
  if [ -e "$lock_registry" ] || [ -L "$lock_registry" ]; then
    if [ ! -d "$lock_registry" ] || [ -L "$lock_registry" ]; then
      echo "mount-impeccable: lock registry is not a regular directory" >&2
      return 1
    fi
  else
    mkdir -p "$lock_registry"
  fi

  # A directory claims the unique owner path in one filesystem operation, and
  # the identity lands inside it. A preempted publisher can only fail later; it
  # can never overwrite a newer owner because mkdir does not replace one.
  if ! mkdir "$owner_dir" 2>/dev/null; then
    echo "mount-impeccable: could not publish a unique mount owner" >&2
    return 1
  fi
  owner_published=true
  if ! printf '%s\n' "$owner_identity" > "$owner_identity_file"; then
    rm -rf "$owner_dir"
    owner_published=false
    echo "mount-impeccable: could not record the published mount owner" >&2
    return 1
  fi

  # Snapshot every immediate child after publication. nullglob distinguishes
  # an absent match from a captured entry that later disappears; dotglob keeps
  # a hidden or legacy entry from bypassing the owner grammar.
  shopt -s nullglob dotglob
  registry_entries=("$lock_registry"/*)
  shopt -u nullglob dotglob
  for contender in "${registry_entries[@]}"; do
    if ! { [ -e "$contender" ] || [ -L "$contender" ]; }; then
      echo "mount-impeccable: a published mount owner disappeared during the scan" >&2
      return 1
    fi
    case "${contender##*/}" in
      owner.*) ;;
      *)
        echo "mount-impeccable: lock registry contains unexpected data" >&2
        return 1
        ;;
    esac
    if ! read_owner_record "$contender"; then
      echo "mount-impeccable: lock registry contains an invalid owner" >&2
      return 1
    fi
    [ "$contender" = "$owner_dir" ] && continue
    if owner_is_live "$lock_read_pid"; then
      echo "mount-impeccable: another mount is already in progress (pid $lock_read_pid)" >&2
      return 1
    fi
    # A valid dead contender is logically stale. Its unique path is never
    # reused and need not be compare/deleted, so stale recovery has no ABA edge.
  done
}

cleanup() {
  if [ -n "${stage_dir:-}" ] && [ -d "$stage_dir" ]; then
    rm -rf "$stage_dir"
  fi

  if [ "$mounted" != true ] && [ -n "${backup_dir:-}" ] \
    && { [ -e "$backup_dir" ] || [ -L "$backup_dir" ]; } \
    && ! { [ -e "$target_dir" ] || [ -L "$target_dir" ]; }; then
    mv "$backup_dir" "$target_dir"
  fi

  # Publication spans the complete critical section above: staging, replacement
  # and backup cleanup. A publisher arriving at any point before EXIT therefore
  # scans this process as live and withdraws; only here may our unique owner go.
  release_owned_lock
}
on_signal() {
  exit 1
}
trap cleanup EXIT
trap on_signal HUP INT TERM

acquire_lock || exit 1

stage_dir=$(mktemp -d "$skills_dir/.impeccable.mount.XXXXXX")

# A link anywhere below the provider build could preserve a cache pointer or
# escape the trusted source tree. The published Codex build contains regular
# files, so reject links instead of following them.
if [ -n "$(find "$source_dir" -type l -print -quit)" ]; then
  echo "mount-impeccable: source contains a symbolic link" >&2
  exit 1
fi
cp -R "$source_dir/." "$stage_dir/"

if [ ! -f "$stage_dir/SKILL.md" ] || [ ! -d "$stage_dir/reference" ]; then
  echo "mount-impeccable: staged copy is incomplete" >&2
  exit 1
fi
if [ -n "$(find "$stage_dir" -type l -print -quit)" ]; then
  echo "mount-impeccable: staged copy still contains a symbolic link" >&2
  exit 1
fi

if [ -e "$target_dir" ] || [ -L "$target_dir" ]; then
  backup_dir=$(mktemp -d "$skills_dir/.impeccable.backup.XXXXXX")
  rmdir "$backup_dir"
  mv "$target_dir" "$backup_dir"
fi

if ! mv "$stage_dir" "$target_dir"; then
  echo "mount-impeccable: could not install the staged copy" >&2
  exit 1
fi
stage_dir=
mounted=true

if [ -n "$backup_dir" ]; then
  rm -rf "$backup_dir"
  backup_dir=
fi

echo "mounted impeccable at $target_dir"
