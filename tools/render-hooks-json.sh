#!/usr/bin/env bash
# Renders both hosts' hooks.json from hook-gates.txt and verifies the published
# Codex hook artifact hashes. Bash 3.2; no jq and no associative arrays.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TABLE="$SCRIPT_DIR/hook-gates.txt"
MODE=check
RENDER_HOST=""
CLASSIFY_HOST=""
CLASSIFY_GATE=""
CLASSIFY_TOOL=""
HASH_FILE=""

usage() {
  printf 'usage: %s [--check|--write|--check-hashes] [--table PATH] [--root PATH]\n' "$0" >&2
  printf '       %s --host HOST [--table PATH]\n' "$0" >&2
  printf '       %s --classify HOST GATE TOOL [--table PATH]\n' "$0" >&2
  exit 2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --check|--write|--check-hashes) MODE="${1#--}"; shift ;;
    --host) [ "$#" -ge 2 ] || usage; MODE=render; RENDER_HOST="$2"; shift 2 ;;
    --classify)
      [ "$#" -ge 4 ] || usage
      MODE=classify; CLASSIFY_HOST="$2"; CLASSIFY_GATE="$3"; CLASSIFY_TOOL="$4"; shift 4 ;;
    --table) [ "$#" -ge 2 ] || usage; TABLE="$2"; shift 2 ;;
    --root|--repo-root) [ "$#" -ge 2 ] || usage; REPO_ROOT="$2"; shift 2 ;;
    --hash-file) [ "$#" -ge 2 ] || usage; HASH_FILE="$2"; shift 2 ;;
    *) usage ;;
  esac
done

[ -r "$TABLE" ] || { printf 'deny: hook table is unreadable: %s\n' "$TABLE" >&2; exit 1; }

# One parser owns validation, rendering and classification so a malformed table
# cannot be accepted by one mode and interpreted differently by another.
table_awk='
function die(message) { failed = 1; print "deny: " message > "/dev/stderr"; exit 1 }
function escape_json(value) {
  gsub(/\\/, "\\\\", value); gsub(/"/, "\\\"", value); return value
}
function validate_cell(value, context) {
  if (value == "") die(context " has no mapping for " hosts[host_count])
  if (value != "none" && value !~ /^[A-Za-z0-9_.:-]+$/) die(context " has invalid mapping `" value "`")
}
function expected_script(id) {
  if (id == "commit") return "block-commit-until-green.sh"
  if (id == "edits") return "block-edits-without-slice.sh"
  if (id == "unknown") return "block-unknown-tool.sh"
  if (id == "handoff") return "publish-subagent-handoff.sh"
  if (id == "planstop") return "capture-plan-approval.sh"
  if (id == "planprompt") return "approve-plan-token.sh"
  if (id == "statebin") return "persist-state-bin.sh"
  if (id == "stale") return "warn-stale-state.sh"
  if (id == "teardown") return "cleanup-state.sh"
  return ""
}
function expected_event(id) {
  if (id == "commit" || id == "edits" || id == "unknown") return "PreToolUse"
  if (id == "handoff") return "SubagentStop"
  if (id == "planstop") return "Stop"
  if (id == "planprompt") return "UserPromptSubmit"
  if (id == "statebin" || id == "stale") return "SessionStart"
  if (id == "teardown") return "SessionEnd"
  return ""
}
function file_exists(path, probe) { probe = (getline ignored < path); close(path); return probe >= 0 }
# D18 (ADR-0111): a PreToolUse gate can deny an operator call, so its script
# must declare its own way out -- a "# Recovery:" header line naming the next
# step, or explicitly saying there is none. Other events block through a
# different channel (stop_block, control_block) this rule does not reach.
function has_recovery_route(path,    line, found) {
  found = 0
  while ((getline line < path) > 0) if (line ~ /^# Recovery:/) { found = 1; break }
  close(path)
  return found
}
function parse(    line, fields, count, kind, i, id, expected) {
  while ((getline line < table) > 0) {
    sub(/^[[:space:]]+/, "", line)
    if (line == "" || line ~ /^#/) continue
    count = split(line, fields, /[[:space:]]+/); kind = fields[1]
    if (kind == "host") {
      if (gate_count || tool_count) die("host rows must precede gate and tool rows")
      if (count != 4) die("malformed host row: " line)
      if (fields[2] != "claude" && fields[2] != "codex") die("unknown host `" fields[2] "`")
      if (fields[3] ~ /^\// || fields[3] ~ /(^|\/)\.\.($|\/)/ || fields[3] !~ /^[A-Za-z0-9_.\/-]+$/) die("unsafe host manifest `" fields[3] "`")
      for (i = 1; i <= host_count; i++) if (hosts[i] == fields[2]) die("duplicate host `" fields[2] "`")
      host_count++; hosts[host_count] = fields[2]; manifests[host_count] = fields[3]; roots[host_count] = fields[4]
    } else if (kind == "gate") {
      if (!host_count) die("gate row appears before any host")
      expected = 4 + host_count
      if (count != expected) {
        if (count < expected) die("gate `" fields[2] "` has no mapping for " hosts[count - 4 + 1])
        die("gate `" fields[2] "` has too many host mappings")
      }
      id = fields[2]; if (gate_seen[id]) die("duplicate gate `" id "`")
      if (expected_script(id) == "") die("unknown gate `" id "`")
      if (fields[4] != expected_script(id)) die("unknown script `" fields[4] "` for gate `" id "`")
      if (fields[3] != expected_event(id)) die("unknown event `" fields[3] "` for gate `" id "`")
      if (fields[4] !~ /^[A-Za-z0-9_.-]+$/ || !file_exists(repo "/plugin/hooks/" fields[4])) die("missing or unsafe gate script `" fields[4] "`")
      if (fields[3] == "PreToolUse" && !has_recovery_route(repo "/plugin/hooks/" fields[4])) die("gate `" id "` script `" fields[4] "` declares no recovery route (see tools/hook-gates.txt header)")
      gate_seen[id] = 1; gate_count++; gate_id[gate_count] = id; gate_event[gate_count] = fields[3]; gate_script[gate_count] = fields[4]
      for (i = 1; i <= host_count; i++) {
        if (fields[4 + i] != "wired" && fields[4 + i] != "none") die("gate `" id "` has invalid mapping for " hosts[i])
        gate_cell[gate_count, i] = fields[4 + i]
      }
    } else if (kind == "tool") {
      if (!host_count) die("tool row appears before any host")
      expected = 2 + host_count
      if (count != expected) {
        if (count < expected) die("tool for gate `" fields[2] "` has no mapping for " hosts[count - 2 + 1])
        die("tool `" fields[3] "` has too many host mappings")
      }
      id = fields[2]; if (!gate_seen[id]) die("tool `" fields[3] "` names unknown gate `" id "`")
      tool_count++; tool_gate[tool_count] = id
      for (i = 1; i <= host_count; i++) { validate_cell(fields[2 + i], "tool `" fields[3] "`"); tool_cell[tool_count, i] = fields[2 + i] }
    } else die("unknown record kind `" kind "`")
  }
  close(table)
  if (host_count != 2 || hosts[1] != "claude" || hosts[2] != "codex") die("hosts must be exactly and in order: claude, codex")
  if (manifests[1] != "plugin/hooks/hooks.json" || roots[1] != "\"${CLAUDE_PLUGIN_ROOT}\"/hooks") die("claude host manifest or command root is not the supported value")
  if (manifests[2] != "codex/hooks/hooks.json" || roots[2] != "\"__OSO_HOOKS_DIR__\"") die("codex host manifest or command root is not the supported value")
  if (gate_count != 9) die("table must declare exactly the nine known gates")
  for (g = 1; g <= gate_count; g++) for (h = 1; h <= host_count; h++) {
    mappings = 0
    for (t = 1; t <= tool_count; t++) if (tool_gate[t] == gate_id[g] && tool_cell[t, h] != "none") mappings++
    if (gate_cell[g, h] == "none" && mappings) die("disabled gate `" gate_id[g] "` has tool mappings for " hosts[h])
    if (gate_cell[g, h] == "wired" && (gate_event[g] == "PreToolUse" || gate_event[g] == "SubagentStop") && !mappings) die("wired " gate_event[g] " gate `" gate_id[g] "` has no matcher for " hosts[h])
    if ((gate_event[g] == "Stop" || gate_event[g] == "UserPromptSubmit") && mappings) die("matcherless " gate_event[g] " gate `" gate_id[g] "` has matcher mappings for " hosts[h])
  }
  # Every tool routed to a specific Codex gate must also pass the final catch-all.
  # Otherwise the specific gate can allow it and the catch-all immediately denies
  # it, making the two generated groups contradict their single source table.
  for (g = 1; g <= gate_count; g++) if (gate_id[g] == "unknown") unknown_gate_index = g
  for (h = 1; h <= host_count; h++) if (gate_cell[unknown_gate_index, h] == "wired") {
    for (t = 1; t <= tool_count; t++) if (tool_gate[t] != "unknown" && tool_cell[t, h] != "none") {
      specific_gate_index = 0
      for (g = 1; g <= gate_count; g++) if (gate_id[g] == tool_gate[t]) specific_gate_index = g
      if (specific_gate_index && gate_event[specific_gate_index] == "PreToolUse" && gate_cell[specific_gate_index, h] == "wired") {
        allowed = 0
        for (u = 1; u <= tool_count; u++) if (tool_gate[u] == "unknown" && tool_cell[u, h] == tool_cell[t, h]) allowed = 1
        if (!allowed) die("tool `" tool_cell[t, h] "` wired by gate `" tool_gate[t] "` is absent from unknown allowlist for " hosts[h])
      }
    }
  }
}
function host_index(name,    i) { for (i = 1; i <= host_count; i++) if (hosts[i] == name) return i; return 0 }
function render(name,    h, g, t, first_group, first_tool, matcher, command, seen) {
  h = host_index(name); if (!h) die("unknown host `" name "`")
  print "{"; print "  \"hooks\": {"; first_group = 1
  # Event order follows first occurrence in the gate table.
  for (g = 1; g <= gate_count; g++) {
    if (gate_cell[g, h] != "wired" || event_done[gate_event[g]]) continue
    if (!first_group) print ","; first_group = 0; event_done[gate_event[g]] = 1
    print "    \"" escape_json(gate_event[g]) "\": ["; event_first = 1
    for (gg = 1; gg <= gate_count; gg++) {
      if (gate_event[gg] != gate_event[g] || gate_cell[gg, h] != "wired") continue
      matcher = ""
      for (t = 1; t <= tool_count; t++) if (tool_gate[t] == gate_id[gg] && tool_cell[t, h] != "none" && !seen[gg, tool_cell[t, h]]++) {
        if (matcher != "") matcher = matcher "|"; matcher = matcher tool_cell[t, h]
      }
      allowlist = matcher
      if (gate_id[gg] == "unknown") matcher = ".*"
      if (gate_id[gg] == "handoff") matcher = "^(" matcher ")$"
      if (!event_first) print ","; event_first = 0
      print "      {"
      if (matcher != "") print "        \"matcher\": \"" escape_json(matcher) "\","
      command = roots[h] "/" gate_script[gg]
      # shell_environment_policy applies to model tool commands, not user-hook
      # handlers in Codex 0.146. Publish the fixed state identity on the hook
      # command itself so lifecycle and gating scripts see the same marker.
      if (name == "codex") command = "OSO_AGENT=1 " command
      if (gate_id[gg] == "unknown") command = command " --allow \"" allowlist "\""
      print "        \"hooks\": ["
      print "          {"
      print "            \"type\": \"command\","
      print "            \"command\": \"" escape_json(command) "\""
      print "          }"
      print "        ]"
      printf "      }"
    }
    print ""; printf "    ]"
  }
  print ""; print "  }"; print "}"
}
function coverage(name,    h, g, path, seen_path, state_needed) {
  h = host_index(name); if (!h) die("unknown host `" name "`")
  print manifests[h]
  if (name == "codex") print "plugin/git-hooks/pre-commit"
  for (g = 1; g <= gate_count; g++) if (gate_cell[g, h] == "wired") {
    path = "plugin/hooks/" gate_script[g]
    if (!seen_path[path]++) print path
  }
  for (g = 1; g <= gate_count; g++) if ((gate_id[g] == "handoff" || gate_id[g] == "planstop" || gate_id[g] == "planprompt") && gate_cell[g, h] == "wired") state_needed = 1
  if (state_needed) print "plugin/bin/oso-state"
  print "plugin/hooks/lib.sh"
  print "plugin/hooks/lexer.sh"
}
BEGIN { parse(); if (action == "render") render(target); if (action == "coverage") coverage(target) }
END { if (!failed && action == "classify") {
  h = host_index(target); if (!h || !gate_seen[class_gate]) { print "deny"; exit }
  for (g = 1; g <= gate_count; g++) if (gate_id[g] == class_gate) class_gate_index = g
  if (!class_gate_index || gate_cell[class_gate_index, h] != "wired") { print "deny"; exit }
  for (t = 1; t <= tool_count; t++) if (tool_gate[t] == class_gate && tool_cell[t, h] != "none" && tool_cell[t, h] == class_tool) { print "wired"; found = 1; break }
  if (!found) print "deny"
} }'

render_host() {
  awk -v table="$TABLE" -v repo="$REPO_ROOT" -v action=render -v target="$1" "$table_awk" </dev/null
}

table_hosts() {
  sed -n 's/^[[:space:]]*host[[:space:]][[:space:]]*\([^[:space:]]*\).*/\1/p' "$TABLE"
}

manifest_for_host() {
  sed -n "s/^[[:space:]]*host[[:space:]][[:space:]]*$1[[:space:]][[:space:]]*\\([^[:space:]]*\\).*/\\1/p" "$TABLE"
}

check_or_write_manifests() {
  local host manifest target rendered count=0
  while IFS= read -r host; do
    [ -n "$host" ] || continue
    manifest="$(manifest_for_host "$host")"
    [ -n "$manifest" ] || { printf 'deny: host %s has no manifest\n' "$host" >&2; exit 1; }
    target="$REPO_ROOT/$manifest"
    rendered="$(mktemp)"
    render_host "$host" > "$rendered"
    if [ "$MODE" = write ]; then
      mkdir -p "$(dirname "$target")"
      cp "$rendered" "$target"
    elif ! cmp -s "$rendered" "$target"; then
      printf 'deny: rendered hooks diverge for %s at %s\n' "$host" "$manifest" >&2
      diff -u "$target" "$rendered" >&2 || true
      rm -f "$rendered"
      exit 1
    fi
    rm -f "$rendered"
    count=$((count + 1))
  done <<< "$(table_hosts)"
  [ "$count" -gt 0 ] || { printf 'deny: no hook manifests were checked\n' >&2; exit 1; }
  printf 'hooks: %s manifest(s) %s\n' "$count" "$MODE"
}

sha256_of() {
  local digest
  digest="$({ sha256sum "$1" 2>/dev/null || shasum -a 256 "$1" 2>/dev/null; })" || return 1
  printf '%s' "${digest%% *}"
}

check_hashes() {
  local published="${HASH_FILE:-$REPO_ROOT/bootstrap/hook-hashes.txt}"
  local expected separator path actual count=0 seen=" " listed_paths=""
  local required_paths
  required_paths="$(awk -v table="$TABLE" -v repo="$REPO_ROOT" -v action=coverage -v target=codex "$table_awk" </dev/null)"
  [ -r "$published" ] || { printf 'deny: published hook hashes are unreadable: %s\n' "$published" >&2; return 1; }
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    expected="${line%%[[:space:]]*}"
    separator="${line#"$expected"}"
    case "$separator" in
      '  '[![:space:]]*) path="${separator#  }" ;;
      *) printf 'deny: published hash row must use exactly two spaces after the digest\n' >&2; return 1 ;;
    esac
    case "$expected" in *[!0-9a-f]*|'') printf 'deny: invalid published hash for %s\n' "${path:-<missing>}" >&2; return 1 ;; esac
    [ "${#expected}" -eq 64 ] || { printf 'deny: invalid published hash length for %s\n' "${path:-<missing>}" >&2; return 1; }
    case "$path" in ''|/*|../*|*/../*|*'/..') printf 'deny: unsafe published hook path: %s\n' "${path:-<missing>}" >&2; return 1 ;; esac
    case "$seen" in *" $path "*) printf 'deny: duplicate published hook hash: %s\n' "$path" >&2; return 1 ;; esac
    seen="$seen$path "
    [ -f "$REPO_ROOT/$path" ] || { printf 'deny: published hook file is missing: %s\n' "$path" >&2; return 1; }
    actual="$(sha256_of "$REPO_ROOT/$path")" || { printf 'deny: cannot hash hook file: %s\n' "$path" >&2; return 1; }
    [ "$actual" = "$expected" ] || { printf 'deny: published hook hash mismatch: %s\n' "$path" >&2; return 1; }
    if [ -n "$listed_paths" ]; then listed_paths="$listed_paths
"; fi
    listed_paths="$listed_paths$path"
    count=$((count + 1))
  done < "$published"
  [ "$count" -gt 0 ] || { printf 'deny: published hook hash list is empty\n' >&2; return 1; }
  [ "$listed_paths" = "$required_paths" ] || {
    printf 'deny: published hook hash coverage or order differs from the rendered Codex hook artifacts\n' >&2
    return 1
  }
  printf 'hooks: %s published hash(es) match\n' "$count"
}

case "$MODE" in
  check|write) check_or_write_manifests ;;
  render) render_host "$RENDER_HOST" ;;
  classify)
    awk -v table="$TABLE" -v repo="$REPO_ROOT" -v action=classify -v target="$CLASSIFY_HOST" \
      -v class_gate="$CLASSIFY_GATE" -v class_tool="$CLASSIFY_TOOL" "$table_awk" </dev/null
    ;;
  check-hashes) check_hashes ;;
esac
