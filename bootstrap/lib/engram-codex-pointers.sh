#!/usr/bin/env bash
# Normalize Engram's two Codex root pointers without owning any other TOML.

normalize_engram_codex_pointers() {
  [ "$#" -eq 10 ] || return 64
  local source=$1 destination=$2 start_marker=$3 end_marker=$4
  local model_key=$5 compact_key=$6 model_value=$7 compact_value=$8
  local parser=$9 require_region=${10}

  awk -v action=engram-pointers \
    -v start_marker="$start_marker" \
    -v end_marker="$end_marker" \
    -v model_key="$model_key" \
    -v compact_key="$compact_key" \
    -v model_value="$model_value" \
    -v compact_value="$compact_value" \
    -v require_region="$require_region" \
    -f "$parser" "$source" > "$destination"
}
