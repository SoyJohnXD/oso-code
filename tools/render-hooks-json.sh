#!/usr/bin/env bash
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
  if (id == "autocontinue") return "auto-continue.sh"
  if (id == "planprompt") return "approve-plan-token.sh"
  if (id == "statebin") return "persist-state-bin.sh"
  if (id == "stale") return "warn-stale-state.sh"
  if (id == "version") return "warn-stale-version.sh"
  if (id == "teardown") return "cleanup-state.sh"
  if (id == "proddeploy") return "block-prod-deploy.sh"
  if (id == "reanchor") return "reanchor-after-compact.sh"
  return ""
}
function expected_event(id) {
  if (id == "commit" || id == "edits" || id == "unknown" || id == "proddeploy") return "PreToolUse"
  if (id == "handoff") return "SubagentStop"
  if (id == "planstop" || id == "autocontinue") return "Stop"
  if (id == "planprompt") return "UserPromptSubmit"
  if (id == "statebin" || id == "stale" || id == "version" || id == "reanchor") return "SessionStart"
  if (id == "teardown") return "SessionEnd"
  return ""
}
function expected_opencode_mechanism(id) {
  if (id == "commit" || id == "edits" || id == "unknown" || id == "proddeploy") return "tool.execute.before"
  if (id == "stale") return "experimental.chat.system.transform"
  if (id == "reanchor") return "event"
  if (id == "teardown") return "dispose"
  if (id == "statebin" || id == "handoff" || id == "autocontinue") return "native"
  return ""
}
function valid_mechanism(host_name, value, id) {
  if (value == "none") return 1
  if (host_name == "opencode") return value == expected_opencode_mechanism(id)
  return value == "subprocess"
}
function file_exists(path, probe) { probe = (getline ignored < path); close(path); return probe >= 0 }
function parse(    line, fields, count, kind, i, id, expected, tool_class, tool_mandated, mechanism) {
  while ((getline line < table) > 0) {
    sub(/^[[:space:]]+/, "", line)
    if (line == "" || line ~ /^#/) continue
    count = split(line, fields, /[[:space:]]+/); kind = fields[1]
    if (kind == "host") {
      if (gate_count || tool_count) die("host rows must precede gate and tool rows")
      if (count != 4) die("malformed host row: " line)
      if (fields[2] != "claude" && fields[2] != "codex" && fields[2] != "opencode") die("unknown host `" fields[2] "`")
      if (fields[3] ~ /^\// || fields[3] ~ /(^|\/)\.\.($|\/)/ || fields[3] !~ /^[A-Za-z0-9_.\/-]+$/) die("unsafe host manifest `" fields[3] "`")
      for (i = 1; i <= host_count; i++) if (hosts[i] == fields[2]) die("duplicate host `" fields[2] "`")
      host_count++; hosts[host_count] = fields[2]; manifests[host_count] = fields[3]; roots[host_count] = fields[4]
    } else if (kind == "gate") {
      if (!host_count) die("gate row appears before any host")
      expected = 4 + 2 * host_count
      if (count != expected) {
        if (count < 4 + host_count) die("gate `" fields[2] "` has no mapping for " hosts[count - 4 + 1])
        if (count < expected) die("gate `" fields[2] "` has no mechanism for " hosts[count - 3 - host_count])
        die("gate `" fields[2] "` has too many host mappings")
      }
      id = fields[2]; if (gate_seen[id]) die("duplicate gate `" id "`")
      if (expected_script(id) == "") die("unknown gate `" id "`")
      if (fields[4] != expected_script(id)) die("unknown script `" fields[4] "` for gate `" id "`")
      if (fields[3] != expected_event(id)) die("unknown event `" fields[3] "` for gate `" id "`")
      if (fields[4] !~ /^[A-Za-z0-9_.-]+$/ || !file_exists(repo "/plugin/hooks/" fields[4])) die("missing or unsafe gate script `" fields[4] "`")
      gate_seen[id] = 1; gate_count++; gate_id[gate_count] = id; gate_event[gate_count] = fields[3]; gate_script[gate_count] = fields[4]
      for (i = 1; i <= host_count; i++) {
        if (fields[4 + i] != "wired" && fields[4 + i] != "none") die("gate `" id "` has invalid mapping for " hosts[i])
        gate_cell[gate_count, i] = fields[4 + i]
        mechanism = fields[4 + host_count + i]
        if (!valid_mechanism(hosts[i], mechanism, id)) die("gate `" id "` declares mechanism `" mechanism "` for " hosts[i] ", which is not the one measured for that host")
        gate_mechanism[gate_count, i] = mechanism
      }
    } else if (kind == "recovery") {
      if (count < 3) die("recovery row for gate `" fields[2] "` names no route")
      if (recovery_route[fields[2]]) die("duplicate recovery route for gate `" fields[2] "`")
      recovery_count++; recovery_id[recovery_count] = fields[2]; recovery_route[fields[2]] = 1
    } else if (kind == "tool") {
      if (!host_count) die("tool row appears before any host")
      expected = 2 + host_count + 2
      if (count != expected) {
        if (count < 2 + host_count) die("tool for gate `" fields[2] "` has no mapping for " hosts[count - 2 + 1])
        if (count < expected) die("tool `" fields[3] "` has no capability class or mandated cell")
        die("tool `" fields[3] "` has too many host mappings or capability cells")
      }
      id = fields[2]; if (!gate_seen[id]) die("tool `" fields[3] "` names unknown gate `" id "`")
      tool_count++; tool_gate[tool_count] = id
      for (i = 1; i <= host_count; i++) { validate_cell(fields[2 + i], "tool `" fields[3] "`"); tool_cell[tool_count, i] = fields[2 + i] }
      tool_class = fields[2 + host_count + 1]
      if (tool_class != "read" && tool_class != "write" && tool_class != "role")
        die("tool `" fields[3] "` has invalid capability class `" tool_class "`")
      tool_mandated = fields[2 + host_count + 2]
      if (tool_mandated != "yes" && tool_mandated != "no")
        die("tool `" fields[3] "` has invalid mandated cell `" tool_mandated "`")
    } else die("unknown record kind `" kind "`")
  }
  close(table)
  if (host_count != 3 || hosts[1] != "claude" || hosts[2] != "codex" || hosts[3] != "opencode") die("hosts must be exactly and in order: claude, codex, opencode")
  if (manifests[1] != "plugin/hooks/hooks.json" || roots[1] != "\"${CLAUDE_PLUGIN_ROOT}\"/hooks") die("claude host manifest or command root is not the supported value")
  if (manifests[2] != "codex/hooks/hooks.json" || roots[2] != "\"__OSO_HOOKS_DIR__\"") die("codex host manifest or command root is not the supported value")
  if (manifests[3] != "opencode/hooks/routes.ts" || roots[3] != "<module-relative>") die("opencode host manifest or command root is not the supported value")
  if (gate_count != 13) die("table must declare exactly the thirteen known gates")
  for (g = 1; g <= gate_count; g++)
    if (gate_event[g] == "PreToolUse" && !recovery_route[gate_id[g]])
      die("gate `" gate_id[g] "` script `" gate_script[g] "` declares no recovery route (see tools/hook-gates.txt header)")
  for (r = 1; r <= recovery_count; r++) {
    if (!gate_seen[recovery_id[r]]) die("recovery route names unknown gate `" recovery_id[r] "`")
    if (expected_event(recovery_id[r]) != "PreToolUse") die("recovery route for gate `" recovery_id[r] "`, which denies through no PreToolUse channel")
  }
  for (g = 1; g <= gate_count; g++) for (h = 1; h <= host_count; h++) {
    mappings = 0
    for (t = 1; t <= tool_count; t++) if (tool_gate[t] == gate_id[g] && tool_cell[t, h] != "none") mappings++
    if (gate_cell[g, h] == "none" && mappings) die("disabled gate `" gate_id[g] "` has tool mappings for " hosts[h])
    if (gate_cell[g, h] == "wired" && (gate_event[g] == "PreToolUse" || gate_event[g] == "SubagentStop") && !mappings) die("wired " gate_event[g] " gate `" gate_id[g] "` has no matcher for " hosts[h])
    if ((gate_event[g] == "Stop" || gate_event[g] == "UserPromptSubmit") && mappings) die("matcherless " gate_event[g] " gate `" gate_id[g] "` has matcher mappings for " hosts[h])
  }
  for (g = 1; g <= gate_count; g++) for (h = 1; h <= host_count; h++) {
    if (gate_cell[g, h] == "wired" && (gate_mechanism[g, h] == "none" || gate_mechanism[g, h] == "native"))
      die("wired gate `" gate_id[g] "` names no hook mechanism for " hosts[h])
    if (gate_cell[g, h] == "none" && gate_mechanism[g, h] != "none" && gate_mechanism[g, h] != "native")
      die("unwired gate `" gate_id[g] "` names hook mechanism `" gate_mechanism[g, h] "` for " hosts[h])
  }
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
  if (name == "opencode") return render_routes(name)
  print "{"; print "  \"hooks\": {"; first_group = 1
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
      if (gate_id[gg] == "proddeploy" && name == "opencode") matcher = matcher "|.*deploy.*"
      if (gate_id[gg] == "proddeploy" && name != "opencode") matcher = matcher "|mcp__.*deploy.*"
      if (!event_first) print ","; event_first = 0
      print "      {"
      if (matcher != "") print "        \"matcher\": \"" escape_json(matcher) "\","
      command = roots[h] "/" gate_script[gg]
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
function render_routes(name,    h, g, t, i, n, wired_gates, matcher, hook, sep, seen, allow_seen, hook_count, hooks_seen, route_hooks) {
  h = host_index(name); if (!h) die("unknown host `" name "`")
  n = 0
  for (g = 1; g <= gate_count; g++) if (gate_cell[g, h] == "wired") wired_gates[++n] = g
  hook_count = 0
  for (i = 1; i <= n; i++) {
    hook = gate_mechanism[wired_gates[i], h]
    if (!hooks_seen[hook]++) route_hooks[++hook_count] = hook
  }
  print "// Generated by tools/render-hooks-json.sh --write from tools/hook-gates.txt."
  print "// Gate routes for the opencode host. Do not edit by hand."
  print ""
  print "export type OpenCodeHook ="
  for (i = 1; i <= hook_count; i++) printf "  | \"%s\"%s\n", route_hooks[i], (i == hook_count ? ";" : "")
  print ""
  print "export interface OpenCodeGateRoute {"
  print "  readonly hook: OpenCodeHook;"
  print "  readonly gate: string;"
  print "  readonly script: string;"
  print "  readonly matcher: string;"
  print "  readonly allow: readonly string[];"
  print "}"
  print ""
  print "export const routes: readonly OpenCodeGateRoute[] = ["
  for (i = 1; i <= n; i++) {
    g = wired_gates[i]
    hook = gate_mechanism[g, h]
    matcher = ""
    for (t = 1; t <= tool_count; t++) if (tool_gate[t] == gate_id[g] && tool_cell[t, h] != "none" && !seen[g, tool_cell[t, h]]++) {
      if (matcher != "") matcher = matcher "|"; matcher = matcher tool_cell[t, h]
    }
    if (gate_id[g] == "unknown") matcher = ".*"
    if (gate_id[g] == "proddeploy") matcher = matcher "|.*deploy.*"
    print "  {"
    print "    hook: \"" hook "\","
    print "    gate: \"" gate_id[g] "\","
    print "    script: \"" gate_script[g] "\","
    print "    matcher: \"" escape_json(matcher) "\","
    printf "    allow: ["
    if (gate_id[g] == "unknown") {
      sep = ""
      for (t = 1; t <= tool_count; t++) if (tool_gate[t] == "unknown" && tool_cell[t, h] != "none" && !allow_seen[tool_cell[t, h]]++) {
        printf "%s\"%s\"", sep, escape_json(tool_cell[t, h]); sep = ", "
      }
    }
    print "],"
    if (i < n) print "  },"
    else print "  }"
  }
  print "];"
}
function coverage(name, beyond,    h, b, g, path, seen_path, state_needed) {
  h = host_index(name); if (!h) die("unknown host `" name "`")
  print manifests[h]
  if (name == "codex") print "plugin/git-hooks/pre-commit"
  for (g = 1; g <= gate_count; g++) if (gate_cell[g, h] == "wired") {
    path = "plugin/hooks/" gate_script[g]
    if (!seen_path[path]++) print path
  }
  for (g = 1; g <= gate_count; g++) if ((gate_id[g] == "handoff" || gate_id[g] == "planstop" || gate_id[g] == "planprompt") && gate_cell[g, h] == "wired") state_needed = 1
  if (state_needed) print "plugin/bin/oso-state"
  print "plugin/hooks/lib.sh"; seen_path["plugin/hooks/lib.sh"] = 1
  print "plugin/hooks/lexer.sh"; seen_path["plugin/hooks/lexer.sh"] = 1
  if (beyond == "") return
  b = host_index(beyond); if (!b) die("unknown host `" beyond "`")
  for (g = 1; g <= gate_count; g++) if (gate_cell[g, b] == "wired") {
    path = "plugin/hooks/" gate_script[g]
    if (!seen_path[path]++) print path
  }
  print manifests[b]
}
BEGIN { parse(); if (action == "render") render(target); if (action == "coverage") coverage(target, beyond) }
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
  required_paths="$(awk -v table="$TABLE" -v repo="$REPO_ROOT" -v action=coverage \
    -v target=codex -v beyond=opencode "$table_awk" </dev/null)"
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
    printf 'deny: published hook hash coverage or order differs from the Codex and opencode hook artifacts these hosts install\n' >&2
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
