#!/usr/bin/env bash

set -euo pipefail

BACKUP_FORMAT=oso-code-opencode-purge-v1

info() { printf '[oso-code] %s\n' "$1"; }
fail() { printf '[oso-code] ERROR: %s\n' "$1" >&2; exit 1; }
usage_error() { printf '[oso-code] ERROR: %s\n' "$1" >&2; exit 2; }

initialize_paths() {
  [ -n "${HOME:-}" ] || fail "HOME is not set"
  [ -d "$HOME" ] || fail "HOME is not a directory: $HOME"
  HOME_PHYSICAL="$(cd "$HOME" && pwd -P)"
  [ "$HOME_PHYSICAL" != / ] || fail "refusing to operate with HOME=/"

  OPENCODE_CONFIG_HOME="$HOME/.config/opencode"
  OPENCODE_STATE_HOME="$HOME/.local/share/opencode"
  OPENCODE_CACHE_HOME="$HOME/.cache/opencode"
  [ -z "${XDG_CONFIG_HOME:-}" ] || [ "$XDG_CONFIG_HOME" = "$HOME/.config" ] ||
    usage_error "XDG_CONFIG_HOME is not the default ($HOME/.config); a customized opencode config home is missed by this wipe"
  [ -z "${XDG_STATE_HOME:-}" ] || [ "$XDG_STATE_HOME" = "$HOME/.local/state" ] ||
    usage_error "XDG_STATE_HOME is not the default ($HOME/.local/state); a customized opencode state home is missed by this wipe"
  [ -z "${XDG_CACHE_HOME:-}" ] || [ "$XDG_CACHE_HOME" = "$HOME/.cache" ] ||
    usage_error "XDG_CACHE_HOME is not the default ($HOME/.cache); a customized opencode cache home is missed by this wipe"
  OPENCODE_BIN="$HOME/.opencode/bin/opencode"
  GENTLE_AI_HOME="$HOME/.gentle-ai"
  GENTLE_AI_BIN="$HOME/.local/bin/gentle-ai"
  BACKUP_PARENT="$HOME/.local/state/oso-code/purge-backups"

  OPENCODE_LABELS=()
  OPENCODE_TARGETS=()
  add_target config-home "$OPENCODE_CONFIG_HOME"
  add_target state-home "$OPENCODE_STATE_HOME"
  add_target cache-home "$OPENCODE_CACHE_HOME"
  add_target bin "$OPENCODE_BIN"
  if [ "$KEEP_GENTLE_AI" = true ]; then
    info "gentle-ai homes are kept and excluded from the purge"
  else
    add_target gentle-ai-home "$GENTLE_AI_HOME"
    add_target gentle-ai-bin "$GENTLE_AI_BIN"
  fi

  validate_target "$OPENCODE_CONFIG_HOME" "config home"
  validate_target "$OPENCODE_STATE_HOME" "state home"
  validate_target "$OPENCODE_CACHE_HOME" "cache home"
  validate_target "$OPENCODE_BIN" "opencode binary"
  [ "$KEEP_GENTLE_AI" = true ] || {
    validate_target "$GENTLE_AI_HOME" "gentle-ai home"
    validate_target "$GENTLE_AI_BIN" "gentle-ai binary"
  }
  reject_backup_overlap "$OPENCODE_CONFIG_HOME"
  reject_backup_overlap "$OPENCODE_STATE_HOME"
  reject_backup_overlap "$OPENCODE_CACHE_HOME"
  reject_backup_overlap "$OPENCODE_BIN"
  [ "$KEEP_GENTLE_AI" = true ] || {
    reject_backup_overlap "$GENTLE_AI_HOME"
    reject_backup_overlap "$GENTLE_AI_BIN"
  }
}

add_target() {
  local label=$1 target=$2
  OPENCODE_LABELS+=("$label")
  OPENCODE_TARGETS+=("$target")
}

expected_target_for() {
  case "$1" in
    config-home) printf '%s' "$OPENCODE_CONFIG_HOME" ;;
    state-home) printf '%s' "$OPENCODE_STATE_HOME" ;;
    cache-home) printf '%s' "$OPENCODE_CACHE_HOME" ;;
    bin) printf '%s' "$OPENCODE_BIN" ;;
    gentle-ai-home) printf '%s' "$GENTLE_AI_HOME" ;;
    gentle-ai-bin) printf '%s' "$GENTLE_AI_BIN" ;;
    *) fail "unknown backup target label: $1" ;;
  esac
}

path_is_clean() {
  case "$1" in
    /) return 1 ;;
    */../*|*/..|*/./*|*/.|*$'\n'*|*$'\r'*|*$'\t'*) return 1 ;;
    *) return 0 ;;
  esac
}

validate_target() {
  local target=$1 label=$2 parent parent_physical
  case "$target" in
    /*) ;;
    *) fail "$label must be an absolute path: $target" ;;
  esac
  path_is_clean "$target" || fail "unsafe $label path: $target"
  case "$target" in
    "$HOME"/*) ;;
    *) fail "$label must remain below HOME: $target" ;;
  esac
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    { [ -d "$target" ] || [ -f "$target" ]; } ||
      fail "$label is not a directory or file: $target"
    parent="$(dirname "$target")"
    parent_physical="$(cd "$parent" && pwd -P)"
    case "$parent_physical" in
      "$HOME_PHYSICAL"|"$HOME_PHYSICAL"/*) ;;
      *) fail "$label resolves outside HOME: $target" ;;
    esac
  fi
}

reject_backup_overlap() {
  local target=$1
  case "$BACKUP_PARENT" in
    "$target"|"$target"/*) fail "backup root would be inside purge target: $target" ;;
  esac
  case "$target" in
    "$BACKUP_PARENT"|"$BACKUP_PARENT"/*) fail "purge target would contain existing backups: $target" ;;
  esac
}

parse_args() {
  MODE=purge
  ASSUME_YES=false
  DRY_RUN=false
  KEEP_GENTLE_AI=false
  RESTORE_BACKUP=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --yes)
        [ "$MODE" = purge ] || usage_error "--yes cannot be combined with --restore"
        [ "$DRY_RUN" = false ] || usage_error "--yes cannot be combined with --dry-run"
        ASSUME_YES=true
        shift
        ;;
      --dry-run)
        [ "$MODE" = purge ] || usage_error "--dry-run cannot be combined with --restore"
        [ "$ASSUME_YES" = false ] || usage_error "--dry-run cannot be combined with --yes"
        DRY_RUN=true
        shift
        ;;
      --keep-gentle-ai)
        [ "$MODE" = purge ] || usage_error "--keep-gentle-ai cannot be combined with --restore"
        KEEP_GENTLE_AI=true
        shift
        ;;
      --restore)
        [ "$MODE" = purge ] || usage_error "--restore may be specified only once"
        [ "$ASSUME_YES" = false ] || usage_error "--yes cannot be combined with --restore"
        [ "$DRY_RUN" = false ] || usage_error "--dry-run cannot be combined with --restore"
        [ "$#" -ge 2 ] || usage_error "--restore requires a backup directory"
        MODE=restore
        RESTORE_BACKUP=$2
        shift 2
        ;;
      *) usage_error "unknown argument: $1" ;;
    esac
  done
}

parse_project_configs() {
  local raw="${OSO_OPENCODE_PROJECT_CONFIGS:-}"
  [ -n "$raw" ] || usage_error "OSO_OPENCODE_PROJECT_CONFIGS is required: exactly three absolute project-level opencode.json paths, space-separated"
  OPENCODE_PROJECT_CONFIGS=()
  read -r -a OPENCODE_PROJECT_CONFIGS <<< "$raw"
  [ "${#OPENCODE_PROJECT_CONFIGS[@]}" -eq 3 ] ||
    usage_error "OSO_OPENCODE_PROJECT_CONFIGS must name exactly three project-level opencode.json files"
  [ "$(printf '%s\n' "${OPENCODE_PROJECT_CONFIGS[@]}" | LC_ALL=C sort -u | wc -l | tr -d ' ')" -eq 3 ] ||
    usage_error "the three project-level opencode.json paths must be distinct"
  local path target
  for path in "${OPENCODE_PROJECT_CONFIGS[@]}"; do
    case "$path" in
      /*) ;;
      *) usage_error "project-level opencode.json must be an absolute path: $path" ;;
    esac
    path_is_clean "$path" || usage_error "unsafe project-level opencode.json path: $path"
    [ -e "$path" ] || [ -L "$path" ] ||
      usage_error "project-level opencode.json does not exist: $path"
    for target in "${OPENCODE_TARGETS[@]}"; do
      case "$path" in
        "$target"|"$target"/*) usage_error "project-level opencode.json must not be inside a purge target: $path" ;;
      esac
    done
  done
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{ print $1 }'
  else
    fail "sha256sum or shasum is required to verify the backup"
  fi
}

directory_mode() {
  if stat -c '%a' "$1" >/dev/null 2>&1; then
    stat -c '%a' "$1"
  else
    stat -f '%Lp' "$1"
  fi
}

confirm_purge() {
  [ "$ASSUME_YES" = true ] && return 0
  info "this will remove the user-level OpenCode install (config, state, cache, binary) after a verified backup"
  [ "$KEEP_GENTLE_AI" = true ] || info "this will also remove the gentle-ai homes"
  info "the three project-level opencode.json files are preserved and reported"
  printf '[oso-code] proceed? [y/N] '
  read -r answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *) fail "aborted by user" ;;
  esac
}

create_backup_root() {
  umask 077
  preflight_backup_parent
  mkdir -p "$BACKUP_PARENT"
  local physical
  physical="$(cd "$BACKUP_PARENT" && pwd -P)"
  validate_physical_backup_root "$physical"
  BACKUP_DIR="$(mktemp -d "$BACKUP_PARENT/purge-$(date +%Y%m%d-%H%M%S).XXXXXX")"
  chmod 700 "$BACKUP_DIR"
  printf '%s\n' "$BACKUP_FORMAT" > "$BACKUP_DIR/format"
  local index label
  for index in "${!OPENCODE_TARGETS[@]}"; do
    label="${OPENCODE_LABELS[$index]}"
    printf '%s\n' "${OPENCODE_TARGETS[$index]}" > "$BACKUP_DIR/$label.target"
  done
  : > "$BACKUP_DIR/manifest.sha256"
}

preflight_backup_parent() {
  local ancestor=$BACKUP_PARENT suffix="" component physical candidate
  while [ ! -e "$ancestor" ] && [ ! -L "$ancestor" ]; do
    component="$(basename "$ancestor")"
    suffix="/$component$suffix"
    ancestor="$(dirname "$ancestor")"
  done
  [ -d "$ancestor" ] || fail "backup ancestor is not a directory: $ancestor"
  physical="$(cd "$ancestor" && pwd -P)"
  candidate="$physical$suffix"
  validate_physical_backup_root "$candidate"
}

validate_physical_backup_root() {
  local physical=$1 index target
  case "$physical" in
    "$HOME_PHYSICAL"/*) ;;
    *) fail "backup root resolves outside HOME: $BACKUP_PARENT" ;;
  esac
  for index in "${!OPENCODE_TARGETS[@]}"; do
    reject_physical_backup_overlap "$physical" "${OPENCODE_TARGETS[$index]}"
  done
}

reject_physical_backup_overlap() {
  local backup_physical=$1 target=$2 target_physical
  [ -d "$target" ] && [ ! -L "$target" ] || return 0
  target_physical="$(cd "$target" && pwd -P)"
  case "$backup_physical" in
    "$target_physical"|"$target_physical"/*)
      fail "backup root resolves inside purge target: $target"
      ;;
  esac
}

archive_target() {
  local label=$1 target=$2 archive
  if [ -L "$target" ]; then
    printf 'symlink\n' > "$BACKUP_DIR/$label.state"
    archive="$BACKUP_DIR/$label.tar"
    tar -cf "$archive" -C "$(dirname "$target")" "$(basename "$target")"
  elif [ ! -e "$target" ]; then
    printf 'absent\n' > "$BACKUP_DIR/$label.state"
    return 0
  elif [ -d "$target" ]; then
    if find "$target" -type s -print -quit 2>/dev/null | grep -q .; then
      fail "cannot create a complete backup while a socket exists below: $target"
    fi
    printf 'directory\n' > "$BACKUP_DIR/$label.state"
    archive="$BACKUP_DIR/$label.tar"
    tar -cf "$archive" -C "$target" .
  else
    printf 'file\n' > "$BACKUP_DIR/$label.state"
    archive="$BACKUP_DIR/$label.tar"
    tar -cf "$archive" -C "$(dirname "$target")" "$(basename "$target")"
  fi
  chmod 600 "$archive"
  tar -tf "$archive" >/dev/null || fail "could not read staged backup: $archive"
}

write_backup_manifest() {
  local name index label
  : > "$BACKUP_DIR/manifest.sha256"
  for name in format "${OPENCODE_LABELS[@]/%/.target}" "${OPENCODE_LABELS[@]/%/.state}"; do
    printf '%s  %s\n' "$(sha256_file "$BACKUP_DIR/$name")" "$name" \
      >> "$BACKUP_DIR/manifest.sha256"
  done
  for index in "${!OPENCODE_LABELS[@]}"; do
    label="${OPENCODE_LABELS[$index]}"
    [ "$(cat "$BACKUP_DIR/$label.state")" = absent ] ||
      printf '%s  %s.tar\n' "$(sha256_file "$BACKUP_DIR/$label.tar")" "$label" \
        >> "$BACKUP_DIR/manifest.sha256"
  done
}

backup_state() {
  create_backup_root
  local index label
  for index in "${!OPENCODE_LABELS[@]}"; do
    archive_target "${OPENCODE_LABELS[$index]}" "${OPENCODE_TARGETS[$index]}"
  done
  write_backup_manifest
  verify_backup "$BACKUP_DIR"
}

expected_manifest_hash() {
  local backup=$1 file_name=$2
  awk -v file="$file_name" '
    $2 == file { count++; hash = $1 }
    END { if (count == 1) print hash; else exit 1 }
  ' "$backup/manifest.sha256"
}

verify_manifest_file() {
  local backup=$1 name=$2 expected actual
  expected="$(expected_manifest_hash "$backup" "$name")" ||
    fail "backup hash entry is missing or duplicated: $name"
  case "$expected" in
    *[!0-9a-f]*|'') fail "backup hash is invalid: $name" ;;
  esac
  [ "${#expected}" -eq 64 ] || fail "backup hash is invalid: $name"
  actual="$(sha256_file "$backup/$name")"
  [ "$actual" = "$expected" ] || fail "backup hash mismatch: $name"
}

verify_backup_target() {
  local backup=$1 label=$2 expected_target=$3 state archive
  [ "$(cat "$backup/$label.target")" = "$expected_target" ] ||
    fail "backup target does not match this HOME: $label"
  state="$(cat "$backup/$label.state")"
  archive="$backup/$label.tar"
  case "$state" in
    absent)
      [ ! -e "$archive" ] || fail "absent backup target unexpectedly has an archive: $label"
      if grep -Eq "^[0-9a-f]{64}  $label\.tar$" "$backup/manifest.sha256"; then
        fail "absent backup target unexpectedly has a hash: $label"
      fi
      ;;
    directory)
      [ -f "$archive" ] && [ ! -L "$archive" ] ||
        fail "backup archive is missing or unsafe: $archive"
      verify_manifest_file "$backup" "$label.tar"
      verify_archive_paths "$archive" "$label.tar"
      ;;
    file)
      [ -f "$archive" ] && [ ! -L "$archive" ] ||
        fail "backup archive is missing or unsafe: $archive"
      verify_manifest_file "$backup" "$label.tar"
      verify_archive_paths "$archive" "$label.tar"
      ;;
    symlink)
      [ -f "$archive" ] && [ ! -L "$archive" ] ||
        fail "backup archive is missing or unsafe: $archive"
      verify_manifest_file "$backup" "$label.tar"
      verify_archive_paths "$archive" "$label.tar"
      verify_symlink_archive "$archive" "$expected_target" "$label.tar"
      ;;
    *) fail "backup state is invalid: $label" ;;
  esac
}

verify_symlink_archive() {
  local archive=$1 target=$2 name=$3 expected
  expected="$(basename "$target")"
  if ! tar -tf "$archive" | awk -v expected="$expected" '
    { count++; entry = $0 }
    END { exit count == 1 && entry == expected ? 0 : 1 }
  '; then
    fail "symlink backup must contain exactly its root link: $name"
  fi
}

verify_archive_paths() {
  local archive=$1 name=$2
  if ! tar -tf "$archive" | awk '
    /^\// { unsafe = 1 }
    /(^|\/)\.\.($|\/)/ { unsafe = 1 }
    END { exit unsafe ? 1 : 0 }
  '; then
    fail "backup archive has an unsafe or unreadable path: $name"
  fi
}

verify_manifest_coverage() {
  local backup=$1 expected actual label
  expected='format'
  local index
  for index in "${!OPENCODE_LABELS[@]}"; do
    label="${OPENCODE_LABELS[$index]}"
    expected="$expected
$label.target
$label.state"
  done
  for index in "${!OPENCODE_LABELS[@]}"; do
    label="${OPENCODE_LABELS[$index]}"
    [ "$(cat "$backup/$label.state")" = absent ] ||
      expected="$expected
$label.tar"
  done
  actual="$(awk 'NF { print $2 }' "$backup/manifest.sha256" | LC_ALL=C sort)"
  expected="$(printf '%s\n' "$expected" | awk 'NF' | LC_ALL=C sort)"
  [ "$actual" = "$expected" ] || fail "backup hash manifest has unexpected coverage"
}

verify_backup() {
  local backup=$1 mode required index label
  [ -d "$backup" ] && [ ! -L "$backup" ] || fail "backup is not a directory: $backup"
  mode="$(directory_mode "$backup")"
  [ "$mode" = 700 ] || fail "backup directory must have mode 0700 (found $mode)"
  for name in format manifest.sha256 \
    "${OPENCODE_LABELS[@]/%/.target}" "${OPENCODE_LABELS[@]/%/.state}"; do
    [ -f "$backup/$name" ] && [ ! -L "$backup/$name" ] ||
      fail "backup metadata is missing or unsafe: $name"
  done
  for name in format \
    "${OPENCODE_LABELS[@]/%/.target}" "${OPENCODE_LABELS[@]/%/.state}"; do
    verify_manifest_file "$backup" "$name"
  done
  verify_manifest_coverage "$backup"
  [ "$(cat "$backup/format")" = "$BACKUP_FORMAT" ] ||
    fail "unsupported or missing backup format"
  for index in "${!OPENCODE_LABELS[@]}"; do
    verify_backup_target "$backup" "${OPENCODE_LABELS[$index]}" "${OPENCODE_TARGETS[$index]}"
  done
}

checkpoint() {
  [ "${OSO_PURGE_FAIL_AFTER:-}" != "$1" ] || fail "injected failure after $1"
}

remove_sources() {
  local index target label
  for index in "${!OPENCODE_TARGETS[@]}"; do
    target="${OPENCODE_TARGETS[$index]}"
    label="${OPENCODE_LABELS[$index]}"
    rm -rf "$target"
    [ ! -e "$target" ] && [ ! -L "$target" ] ||
      fail "purge target was not removed: $label ($target)"
  done
}

purge() {
  confirm_purge
  local index all_absent=true
  for index in "${!OPENCODE_TARGETS[@]}"; do
    if [ -e "${OPENCODE_TARGETS[$index]}" ] || [ -L "${OPENCODE_TARGETS[$index]}" ]; then
      all_absent=false
      break
    fi
  done
  if [ "$all_absent" = true ]; then
    info "the user-level OpenCode install is already absent; nothing to purge"
    return 0
  fi
  backup_state
  info "backup: $BACKUP_DIR"
  checkpoint after-backup
  remove_sources
  info "purged the user-level OpenCode install: config, state, cache, binary"
  [ "$KEEP_GENTLE_AI" = true ] || info "the gentle-ai homes were part of the purge"
  report_project_configs
  info "no login or installation command was run"
  info "restore with: HOME=\"$HOME\" bash \"$0\" --restore \"$BACKUP_DIR\""
}

dry_run() {
  info "dry run: nothing will be backed up or removed"
  info "purge targets:"
  local index
  for index in "${!OPENCODE_TARGETS[@]}"; do
    info "  ${OPENCODE_LABELS[$index]}: ${OPENCODE_TARGETS[$index]}"
  done
  info "project-level opencode.json files to report:"
  local path
  for path in "${OPENCODE_PROJECT_CONFIGS[@]}"; do
    info "  $path"
  done
  info "backup would be created at: $BACKUP_PARENT/purge-<timestamp>"
}

report_project_configs() {
  local path missing=""
  for path in "${OPENCODE_PROJECT_CONFIGS[@]}"; do
    if [ -e "$path" ] || [ -L "$path" ]; then
      info "project-level opencode.json INTACT: $path"
    else
      info "project-level opencode.json MISSING: $path"
      missing="$missing $path"
    fi
  done
  [ -z "$missing" ] ||
    fail "project-level opencode.json vanished during the purge:$missing"
}

assert_restore_target_absent() {
  local target=$1 label=$2
  [ ! -e "$target" ] && [ ! -L "$target" ] ||
    fail "refusing to overwrite existing $label: $target"
}

extract_restore_stage() {
  local label=$1 target=$2 state stage_root stage_source
  state="$(cat "$RESTORE_BACKUP/$label.state")"
  [ "$state" != absent ] || return 0
  stage_root="$(mktemp -d "$(dirname "$target")/.oso-restore.XXXXXX")"
  case "$state" in
    directory)
      stage_source="$stage_root/tree"
      mkdir "$stage_source"
      tar -xf "$RESTORE_BACKUP/$label.tar" -C "$stage_source"
      ;;
    file)
      stage_source="$stage_root/$(basename "$target")"
      tar -xf "$RESTORE_BACKUP/$label.tar" -C "$stage_root"
      [ -f "$stage_source" ] || fail "restored staging object is not a file: $label"
      ;;
    symlink)
      stage_source="$stage_root/$(basename "$target")"
      tar -xf "$RESTORE_BACKUP/$label.tar" -C "$stage_root"
      [ -L "$stage_source" ] || fail "restored staging object is not a symlink: $label"
      ;;
  esac
  STAGE_ROOTS+=("$stage_root")
  STAGE_SOURCES+=("$stage_source:$label")
}

cleanup_restore() {
  local entry label
  for entry in "${STAGE_ROOTS[@]:-}"; do
    rm -rf "$entry"
  done
  if [ "${RESTORE_ACTIVE:-false}" = true ]; then
    for label in ${RESTORED_LABELS:-}; do
      rm -rf "$(expected_target_for "$label")"
    done
  fi
}

restore_backup() {
  case "$RESTORE_BACKUP" in /*) ;; *) fail "backup path must be absolute" ;; esac
  [ -d "$RESTORE_BACKUP" ] && [ ! -L "$RESTORE_BACKUP" ] ||
    fail "backup is not a directory: $RESTORE_BACKUP"
  OPENCODE_LABELS=()
  OPENCODE_TARGETS=()
  local label target backup_target
  for backup_target in "$RESTORE_BACKUP"/*.target; do
    [ -e "$backup_target" ] || continue
    label="$(basename "$backup_target" .target)"
    target="$(expected_target_for "$label")"
    OPENCODE_LABELS+=("$label")
    OPENCODE_TARGETS+=("$target")
  done
  [ "${#OPENCODE_LABELS[@]}" -gt 0 ] ||
    fail "backup contains no target records: $RESTORE_BACKUP"
  verify_backup "$RESTORE_BACKUP"
  local index
  for index in "${!OPENCODE_LABELS[@]}"; do
    assert_restore_target_absent "${OPENCODE_TARGETS[$index]}" "${OPENCODE_LABELS[$index]}"
    mkdir -p "$(dirname "${OPENCODE_TARGETS[$index]}")"
  done

  STAGE_ROOTS=()
  STAGE_SOURCES=()
  RESTORED_LABELS=""
  RESTORE_ACTIVE=true
  trap cleanup_restore EXIT
  local entry source
  for index in "${!OPENCODE_LABELS[@]}"; do
    extract_restore_stage "${OPENCODE_LABELS[$index]}" "${OPENCODE_TARGETS[$index]}"
  done
  for entry in "${STAGE_SOURCES[@]}"; do
    source="${entry%:*}"
    label="${entry#*:}"
    mv "$source" "$(expected_target_for "$label")"
    RESTORED_LABELS="$RESTORED_LABELS $label"
    checkpoint "after-$label-restore"
    rmdir "$(dirname "$source")"
  done
  RESTORE_ACTIVE=false
  trap - EXIT
  info "restored the user-level OpenCode install from verified backup: $RESTORE_BACKUP"
  info "no login or installation command was run"
}

main() {
  parse_args "$@"
  initialize_paths
  case "$MODE" in
    restore) restore_backup ;;
    *)
      parse_project_configs
      if [ "$DRY_RUN" = true ]; then
        dry_run
      else
        purge
      fi
      ;;
  esac
}

if [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then
  main "$@"
fi
