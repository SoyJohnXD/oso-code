# Shared parsing and telemetry for oso-code hooks. Pure bash — no runtime deps.

# Extracts a string field from the hook's stdin JSON, handling escaped quotes.
# Field names used here (session_id, command, file_path) are unique in hook input.
json_field() {
  local json="$1" field="$2"
  local pattern="\"${field}\"[[:space:]]*:[[:space:]]*\"(([^\"\\\\]|\\\\.)*)\""
  if [[ "$json" =~ $pattern ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  fi
}

# Session ids become file names — strip anything that could traverse paths.
sanitize_session() {
  printf '%s' "$1" | tr -cd 'a-zA-Z0-9-'
}

# One JSONL line per gate event so the team can audit whether gates ever fire.
log_event() {
  local event="$1" session="$2"
  local dir="${HOME}/.local/state/oso-code"
  mkdir -p "$dir"
  printf '{"ts":"%s","event":"%s","session":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$event" "$session" >> "$dir/events.jsonl"
}
