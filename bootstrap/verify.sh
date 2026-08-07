#!/usr/bin/env bash
# Post-install E2E verification. Every check is measurable pass/fail;
# exits non-zero if any check fails. Run after bootstrap/install.sh.
# OSO_VERIFY_SKIP_SLOW=1 drops the two checks that re-run the repo suite or fetch
# from npm — CI sets it, because it runs the suite as its own step and no CI run
# should depend on the network.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
CLAUDE_DIR="${HOME}/.claude"

# Context budget for the global CLAUDE.md: 8000 bytes ≈ 2k tokens.
# Keep this identical to CLAUDE_MD_BUDGET_BYTES in bootstrap/install.sh — the
# two scripts run standalone via curl and cannot source a shared file.
CLAUDE_MD_BUDGET_BYTES=8000

pass=0
fail=0

check() {
  local name="$1" expected="$2" actual="$3" fix="${4:-}"
  if [ "$expected" = "$actual" ]; then
    echo "ok:   $name ($actual)"; pass=$((pass + 1))
  else
    echo "FAIL: $name — expected $expected, got $actual${fix:+ — fix: $fix}"; fail=$((fail + 1))
  fi
}

# The report must always reach its summary: under `set -euo pipefail` a command
# that dies takes the tally AND every verdict already printed with it, leaving an
# operator unable to tell a broken install from a broken verifier. So every check
# reads its inputs in a form that cannot abort — `|| true`, or the `if value="$(…)"`
# rc-capture where the failure needs its own branch — and keeps the failing
# command's own stderr inside the value it reports, so a vanished input goes red
# with its reason instead of green on nothing scanned. A value that can arrive with
# a newline in it is folded first, because `check` prints it inline and a reason
# orphaned on the next line reads as a verdict contradicting itself. Numeric checks
# are the one exception: text in the value is a shell error, so they branch on the
# read. A remediation belongs on that same line for the same reason: it travels as
# `check`'s optional fourth argument, printed only on the verdict it explains.

# The ACTIVE installed version dir (cache copy, not the repo) — a new session runs
# the installPath recorded in installed_plugins.json, so resolve THAT, never
# whatever readdir yields first across the cached versions (0.5.0…0.10.0). Checks
# that must exercise the exact files a session runs scope their targets under here.
installed_plugins="$CLAUDE_DIR/plugins/installed_plugins.json"
plugin_cache="$CLAUDE_DIR/plugins/cache/oso-code/oso-code"
install_root=""
if [ -f "$installed_plugins" ]; then
  if command -v jq >/dev/null 2>&1; then
    install_root="$(jq -r '.plugins["oso-code@oso-code"][0].installPath // empty' "$installed_plugins" 2>/dev/null || true)"
  else
    echo "note: jq unavailable — deriving install path from the version-sorted cache"
  fi
fi
# Fallback when the record or its installPath field is absent: highest version dir.
if [ -z "$install_root" ] || [ ! -d "$install_root" ]; then
  install_root="$(find "$plugin_cache" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -1 || true)"
fi

# 1. Plugin installed and enabled
plugin_listed="$(claude plugin list 2>/dev/null | grep -c 'oso-code' || true)"
check "oso-code plugin installed" "1" "$([ "$plugin_listed" -ge 1 ] && echo 1 || echo 0)"

# 2. MCP servers wired and connected (engram + context7 ride plugins and render
#    as `plugin:<plugin>:<server>`; fallow is a user-scope entry). Assert each
#    server's line reports Connected, not merely that the name is present.
mcps="$(claude mcp list 2>/dev/null || true)"
mcp_connected() {
  if printf '%s\n' "$mcps" | grep -E "$1" | grep -q 'Connected'; then echo 1; else echo 0; fi
}
#    Both remediations name the artifact the check is actually missing, because
#    neither server fails for the reason its name suggests: engram needs a BINARY
#    that no plugin install puts on the machine (install.sh downloads the pinned
#    release, and check 13 below answers whether the client can see it and whether
#    it runs), and context7 needs the plugin registered plus a Node.js for npx to
#    start it with. Which of those two a red line here means is not something this
#    check can tell — it sees a server that did not connect — so the remediation
#    names both rather than asserting the one it cannot know.
check "engram MCP connected"   "1" "$(mcp_connected 'engram')" \
  "bash bootstrap/install.sh installs the engram plugin AND the pinned engram binary its .mcp.json spawns by name; where that binary is installed but the client still cannot start it, either the directory holding it is not on the PATH Claude Code reads or the copy there does not run at all — that run's wiring summary says which and names the command for it (check 13 below discriminates the two on Windows), and Claude Code has to be restarted after"
check "context7 MCP connected" "1" "$(mcp_connected 'context7')" \
  "claude plugin install oso-code@oso-code registers it (it ships in the plugin's .mcp.json, so there is no mcp add to run), and it starts through npx — so install Node.js if npx is missing, then restart Claude Code"
# fallow was the one OPTIONAL MCP, reported on a `note:` this never counted,
# because it built from Rust that no OS here requires and no entry point
# provisions — so a hard check would have made the one-step Windows path red by
# construction. install.sh now installs it from its npm package, at a pin, on
# every supported host, so that bound is gone and this counts like its two
# neighbours (D2). What it counts is the wired command RESOLVING AND ANSWERING:
# `claude mcp list` spawns each server and reports whether it handshook, which
# asks nothing of the network and so stays outside OSO_VERIFY_SKIP_SLOW.
# The remediation is two commands because the client refuses to overwrite an entry
# `claude mcp add` did not write: where this goes red over a stale command rather
# than a missing entry, re-running the installer takes that same refusal and leaves
# the entry exactly where it is — which would make this check unclearable.
check "fallow MCP connected" "1" "$(mcp_connected 'fallow')" \
  "bash bootstrap/install.sh installs the pinned fallow package from npm and wires a missing entry; an existing one it never touches, so repoint that with claude mcp remove fallow -s user && claude mcp add --scope user fallow -- the command that run names"

# 3. Legacy gentle-ai artifacts fully removed. Read whole, so a manifest the loop
#    cannot open reports its own reason instead of "0 still present".
if legacy_manifest="$(cat "$SCRIPT_DIR/gentle-manifest.txt" 2>&1)"; then
  legacy_left=0
  while IFS= read -r rel; do
    # The manifest is data, so check 11 below never scanned it for CR bytes and
    # .gitattributes renormalizes no clone that already exists: on a CRLF
    # checkout every path carries a trailing CR, `[ -e ]` matches nothing, and
    # this check reports the cleanup done (0) while every legacy artifact is
    # still live — the worst shape a verifier has, green over nothing scanned.
    # Same strip as install.sh's two manifest readers; the two scripts run
    # standalone via curl and cannot source a shared file.
    rel="${rel%$'\r'}"
    case "$rel" in ''|'#'*) continue ;; esac
    if [ -e "$CLAUDE_DIR/$rel" ] || [ -L "$CLAUDE_DIR/$rel" ]; then
      legacy_left=$((legacy_left + 1))
      echo "      still present: $rel"
    fi
  done <<< "$legacy_manifest"
  check "legacy artifacts removed" "0" "$legacy_left"
else
  legacy_manifest="${legacy_manifest//$'\n'/ }"
  check "legacy artifacts removed" "0" "${legacy_manifest:-empty}"
fi

# 4. No gentle hook references left in settings.json. grep -c answers "0" and exits
#    1 on a clean file but exits 2 with an EMPTY stdout on a missing one, so its
#    stderr is the only thing that can tell those apart in the value.
gentle_hooks="$(grep -cE 'check-plan-contract|clean-code-gate|skill-registry-refresh|gentle-ai' "$CLAUDE_DIR/settings.json" 2>&1 || true)"
gentle_hooks="${gentle_hooks//$'\n'/ }"
check "settings.json free of gentle hooks" "0" "${gentle_hooks:-empty}"

# 5. Global CLAUDE.md within the context budget (< 8000 bytes ≈ 2k tokens).
#    A size cannot take the guard above: `|| true` leaves the value empty and folded
#    stderr puts a sentence where `-lt` expects an integer — `integer expression
#    expected` instead of an abort. Branching on the read keeps the compare numeric,
#    names the file when it is unreadable, and leaves bash's own reason on stderr.
claude_md="$CLAUDE_DIR/CLAUDE.md"
if md_size="$(wc -c < "$claude_md")"; then
  check "CLAUDE.md under budget" "1" "$([ "$md_size" -lt "$CLAUDE_MD_BUDGET_BYTES" ] && echo 1 || echo 0)"
  echo "      CLAUDE.md size: ${md_size} bytes"
else
  check "CLAUDE.md under budget" "1" "unreadable $claude_md"
fi

# 6. Installed hook binaries are executable and functional from the INSTALL path
#    (not the repo) — exercises the exact files new sessions will run.
if [ -n "$install_root" ]; then
  hook="$(find "$install_root" -name 'block-commit-until-green.sh' 2>/dev/null | head -1 || true)"
  if [ -n "$hook" ] && [ -x "$hook" ]; then
    # Fixture and run in one guarded chain: whichever step breaks, its reason is
    # what the check reports. The hook is also free not to drain stdin — the
    # SIGPIPE that costs the pipeline 141 under pipefail lands on `|| true` here.
    # The state file is named after the repository the call is made in, and the
    # temp dir the payload names is in none — so the name is the digest of that
    # directory, which is what the hook resolves it to and is spelled here rather
    # than read out of the plugin, the way this script spells every other
    # constant it checks.
    out="$(
      {
        hook_home="$(mktemp -d)" \
          && state_key="$(printf '%s' "$hook_home" |
            { sha256sum 2>/dev/null || shasum -a 256 2>/dev/null; })" \
          && state_key="${state_key%% *}" \
          && mkdir -p "$hook_home/.local/state/oso-code" \
          && printf 'mode=plan\nverify_green=false\n' > "$hook_home/.local/state/oso-code/$state_key.state" \
          && printf '{"session_id":"e2e","cwd":"%s","tool_input":{"command":"git commit -m x"}}' "$hook_home" \
            | HOME="$hook_home" OSO_AGENT=1 "$hook"
      } 2>&1 || true
    )"
    out="${out//$'\n'/ }"
    case "$out" in
      *'"permissionDecision":"deny"'*) check "installed hook denies red commit (e2e)" "1" "1" ;;
      *) check "installed hook denies red commit (e2e)" "deny" "${out:-empty}" ;;
    esac
  else
    check "installed hook executable" "1" "0"
  fi
else
  check "plugin install path found" "1" "0"
fi

# 7. oso-state reachable end-to-end through OSO_STATE_BIN from the INSTALL path —
#    the exact "${OSO_STATE_BIN:-oso-state}" form the skills use, not a PATH or
#    absolute-path shortcut. A silent no-op here means skills can't touch state.
if [ -n "$install_root" ]; then
  state_bin="$(find "$install_root" -path '*/bin/oso-state' 2>/dev/null | head -1 || true)"
  if [ -n "$state_bin" ] && [ -x "$state_bin" ]; then
    # One chain, so the round-trip's own failure IS the value, and three ways to
    # lose that failure go with it: `export` masks the status of a substitution in
    # its value (`export X="$(false)"` succeeds), so the temp HOME is made on its
    # own line; a command substitution does not inherit errexit, so a `set` sent to
    # `>/dev/null 2>&1` failed invisibly and left the check red with an empty value;
    # and the subshell's status was `clear`'s, so a failing clear aborted the report.
    # Hence stdout only is dropped from the calls with nothing to say — their stderr
    # is the reason a red check needs.
    probe="$(
      {
        probe_home="$(mktemp -d)" \
          && export HOME="$probe_home" OSO_STATE_BIN="$state_bin" \
          && "${OSO_STATE_BIN:-oso-state}" --session verify-probe set mode=probe >/dev/null \
          && "${OSO_STATE_BIN:-oso-state}" --session verify-probe get mode \
          && "${OSO_STATE_BIN:-oso-state}" --session verify-probe clear >/dev/null
      } 2>&1 || true
    )"
    probe="${probe//$'\n'/ }"
    check "OSO_STATE_BIN round-trips oso-state (e2e)" "probe" "${probe:-empty}"
  else
    check "installed oso-state executable" "1" "0"
  fi
else
  check "plugin install path found (oso-state)" "1" "0"
fi

# 8. Repo test suite still green
if [ "${OSO_VERIFY_SKIP_SLOW:-}" = 1 ]; then
  echo "skip: hook regression suite — OSO_VERIFY_SKIP_SLOW (CI runs the suite as its own step)"
elif "$REPO_ROOT/tests/hooks-test.sh" >/dev/null 2>&1; then
  check "hook regression suite" "pass" "pass"
else
  check "hook regression suite" "pass" "fail"
fi

# 9. impeccable, on both surfaces the design bar uses: the plugin (skill + design
#    docs) and the CLI reachable through npx. The CLI check runs the very command
#    the design bar resolves its pin with (the recipe in
#    plugin/skills/_shared/front-surface.md), so it answers whether npx can fetch
#    and run impeccable at all — not whether a pin recorded in an earlier session
#    still resolves. Only the plugin half is skippable: npx resolves impeccable
#    from the public registry, so the CLI check stays green whether or not the
#    plugin was ever installed.
#    An operator who ran --no-impeccable on purpose has no green path while this
#    check is hard, and no way to tell that choice from a broken install, so
#    install.sh records the opt-out as data and this reads it. Keep the path
#    identical to IMPECCABLE_OPT_OUT_MARKER in bootstrap/install.sh — the two
#    scripts run standalone via curl and cannot source a shared file.
IMPECCABLE_OPT_OUT_MARKER="${HOME}/.local/state/oso-code/impeccable-opt-out"
if [ -f "$IMPECCABLE_OPT_OUT_MARKER" ]; then
  echo "note: impeccable plugin skipped — install.sh ran with --no-impeccable, so the design bar has no plugin half here; re-run install.sh without the flag to wire it"
else
  impeccable_listed="$(claude plugin list 2>/dev/null | grep -c 'impeccable' || true)"
  check "impeccable plugin installed" "1" "$([ "$impeccable_listed" -ge 1 ] && echo 1 || echo 0)"
fi

# npx fetches from the registry before it can run anything, so a slow or
# unreachable one hangs this probe forever and every check below it never runs.
# `timeout` is GNU coreutils and macOS ships none, so the bound is in-shell:
# background the probe, poll it, and kill it once the bound expires. Job control
# gives the job its own process group, which is what lets the kill reach the node
# children npx spawns instead of orphaning them. The value is the same 20 seconds
# the pin recipe in plugin/skills/_shared/front-surface.md bounds its own resolve
# with, and a bound that fires says so in the value, because "npm never answered"
# and "npx cannot run impeccable" are different problems with different fixes.
NPX_PROBE_BOUND_SECONDS=20

impeccable_cli_runnable() {
  set -m
  npx impeccable --version </dev/null >/dev/null 2>&1 &
  local probe=$! waited=0
  set +m
  while kill -0 "$probe" 2>/dev/null; do
    if [ "$waited" -ge "$NPX_PROBE_BOUND_SECONDS" ]; then
      kill -TERM "-$probe" 2>/dev/null || kill -TERM "$probe" 2>/dev/null || true
      wait "$probe" 2>/dev/null || true
      echo "no answer within ${NPX_PROBE_BOUND_SECONDS}s"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  if wait "$probe"; then echo 1; else echo 0; fi
}

if [ "${OSO_VERIFY_SKIP_SLOW:-}" = 1 ]; then
  echo "skip: impeccable CLI runnable via npx — OSO_VERIFY_SKIP_SLOW (the probe would fetch the package from npm)"
else
  check "impeccable CLI runnable via npx" "1" "$(impeccable_cli_runnable)"
fi

# One spelling for a directory Windows writes four ways, so a comparison can be
# about the directory instead of about who built the string. install.sh wires
# core.hooksPath from a path `cd`+`pwd` spells /c/Users/…, but MSYS argv conversion
# rewrites a POSIX-form argument before a native git.exe ever sees it — so
# C:/Users/… is what lands in .git/config, and the two are never byte-equal. Read
# byte for byte, check 10 below tells a Windows operator whose commit gate IS
# wired that it is not, which is the one thing a verifier may never get wrong in
# that direction. A backslash spelling, a lowercase drive letter and a trailing
# slash are the other ways the same directory comes back.
# It builds a comparison key, not a canonical path: /u/jane comes back as U:/jane,
# and a backslash inside a POSIX filename comes back as a separator, so what it
# returns can be a spelling no filesystem holds. What makes that safe is that every
# comparison folds BOTH sides through it — a fold that fires where no Windows path
# exists fires on both sides and cannot change a verdict. Valid inside one
# comparison only: never stored, never printed back to an operator.
# Keep this identical to normalized_path in bootstrap/install.sh — the two scripts
# run standalone via curl and cannot source a shared file.
normalized_path() {
  local path="${1//\\//}"
  case "$path" in
    /[A-Za-z]/*|/[A-Za-z])
      path="${path#/}"              # /c/Users/x -> c/Users/x
      path="${path%%/*}:${path#?}"  # c/Users/x  -> c:/Users/x
      ;;
  esac
  # bash 3.2 has no ${var^^}, so the drive letter costs a fork — and only where it
  # is the lowercase spelling that needs one.
  case "$path" in
    [a-z]:*) path="$(printf '%s' "${path%%:*}" | tr 'a-z' 'A-Z'):${path#*:}" ;;
  esac
  # A trailing separator names the same directory. `/` is a root, not a trailing
  # separator, so it keeps its own name.
  case "$path" in ?*/) path="${path%/}" ;; esac
  printf '%s' "$path"
}

# 10. The commit gate's primary layer, where this repo has it: the git hook only
#     exists while core.hooksPath still points at it, and it only runs while it is
#     executable. A repo whose hooks belong to another tool never had this layer
#     wired (see wire_git_commit_hook in install.sh), so that is a note, not a fail.
#     The note names the stored spelling rather than the normalized one, because
#     that is the value an operator would go and edit.
git_hook="$REPO_ROOT/plugin/git-hooks/pre-commit"
wired_hooks_path="$(git -C "$REPO_ROOT" config --get core.hooksPath 2>/dev/null || true)"
if [ "$(normalized_path "$wired_hooks_path")" = "$(normalized_path "$(dirname "$git_hook")")" ]; then
  check "git commit hook executable at the wired core.hooksPath" "1" \
    "$([ -x "$git_hook" ] && echo 1 || echo 0)"
else
  echo "note: core.hooksPath is ${wired_hooks_path:-unset} in $REPO_ROOT — the git commit layer is not wired here, so only the PreToolUse gate applies"
fi

# 11. CR bytes in a shipped executable: this checks the copy that actually runs,
#     which .gitattributes can only promise. A lone CR makes bash read `then\r` as a
#     command and takes a hook down mid-verdict. Bytes only — the repo's prose is
#     full of em-dashes, and non-ASCII is no hazard.
#     The Windows entrypoints are in scope because that is where this class has
#     actually shipped from here, twice (bb4356f, 88f0c1e) — both times in
#     install.ps1 or install.bat, which nothing was scanning.
#     grep exits 1 on a clean tree, so guard the substitution like the rest of this
#     block; keep grep's stderr in the value so a scan path that vanished fails loudly
#     instead of reporting green on nothing scanned.
cr_shipped="$(cd "$REPO_ROOT" && LC_ALL=C grep -rlF -e $'\r' plugin/hooks plugin/bin plugin/git-hooks bootstrap/*.sh bootstrap/install.ps1 bootstrap/install.bat 2>&1 | tr '\n' ' ' || true)"
check "shipped executables carry no CR bytes" "none" "${cr_shipped:-none}"

# 12. The home dir this install wrote to, against the one the client reads. Git
#     Bash takes $HOME from an inherited $HOME first, then HOMEDRIVE+HOMEPATH, and
#     only then %USERPROFILE%; claude.exe is a Node process, so os.homedir() —
#     %USERPROFILE%, always — is the only tree it ever opens. A roaming or
#     HOMESHARE corporate profile, or a machine carrying an MSYS2 $HOME of its
#     own, splits the two: install.sh then wrote CLAUDE.md, settings.json and
#     every backup where the client never looks, and EVERY check above read that
#     same wrong tree and stayed green — an install that did nothing, confirmed.
#     bootstrap/install.ps1 exports a matching HOME before it delegates, so what
#     this covers is the `bash bootstrap/install.sh` path README documents, which
#     never passes through PowerShell.
#     Normalized on both sides for the reason check 10 is: /c/Users/x and
#     C:\Users\x are one tree and never byte-equal. Only the verdict comes from the
#     fold, though — what the line names is what the environment holds, again like
#     check 10: a folded value is a comparison key and not a path, so a POSIX $HOME
#     of /u/jane would be reported back as U:/jane, a home dir nobody can go and act
#     on. One tree therefore reaches `check` as one spelling, and only a real
#     disagreement reaches it as two.
#     Where the environment carries no %USERPROFILE% there is no Windows-native
#     client to disagree with $HOME, so this is a note rather than a check that
#     could only ever pass vacuously — Linux, macOS, and the CI fixture with them.
if [ -n "${USERPROFILE:-}" ]; then
  client_home="$USERPROFILE"
  git_bash_home="$HOME"
  if [ "$(normalized_path "$client_home")" = "$(normalized_path "$git_bash_home")" ]; then
    client_home="$git_bash_home"
  fi
  check "home dir the Windows client reads" "$client_home" "$git_bash_home" \
    "re-run from PowerShell (bootstrap/install.ps1 sets HOME to %USERPROFILE% for you), or export HOME=\"\$USERPROFILE\" in Git Bash and re-run bootstrap/install.sh"
else
  echo "note: home dir the Windows client reads — %USERPROFILE% is unset, so no Windows-native client reads a home dir here and \$HOME ($HOME) is the only tree in play"
fi

# Whether this shell is Git Bash on Windows, which decides three things a POSIX
# host answers differently: which asset engram publishes, the .exe suffix a native
# client needs to spawn a bare name, and whose PATH that name is resolved against.
# Keep this identical to running_on_windows in bootstrap/install.sh — the two
# scripts run standalone via curl and cannot source a shared file.
running_on_windows() {
  case "$(uname -s 2>/dev/null || true)" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
  esac
  return 1
}

# Keep this identical to engram_binary_name in bootstrap/install.sh — the two
# scripts run standalone via curl and cannot source a shared file.
engram_binary_name() {
  if running_on_windows; then printf 'engram.exe'; else printf 'engram'; fi
}

# The PATH a newly launched Claude Code resolves a bare command name against, one
# entry per line. Off Windows that is this shell's own — the client starts from a
# shell like this one. On Windows it is emphatically not: Git Bash builds its PATH
# from the persisted one plus MSYS directories no native process can use, while
# claude.exe reads the persisted machine and user scopes, which is exactly the pair
# bootstrap/install.ps1's Update-EnvPath re-reads. PowerShell ships with every
# supported Windows and is already this repo's Windows entry point, so it is what
# reads them back; a run where it cannot answer yields nothing, which every caller
# reads as "not found" rather than as agreement.
# Keep this identical to client_path_entries in bootstrap/install.sh — the two
# scripts run standalone via curl and cannot source a shared file.
client_path_entries() {
  if ! running_on_windows; then
    printf '%s\n' "${PATH//:/$'\n'}"
    return 0
  fi
  powershell -NoProfile -NonInteractive -Command \
    '@("Machine","User") | ForEach-Object { [Environment]::GetEnvironmentVariable("Path", $_) } | Where-Object { $_ } | ForEach-Object { $_ -split ";" }' \
    2>/dev/null || true
}

# The engram a newly launched Claude Code would spawn, empty when it would find
# none. Never `command -v`: on Windows this shell's PATH carries /usr/bin,
# /mingw64/bin and $HOME/bin, which a native claude.exe cannot use, so an engram
# sitting in one of them would report a working install to an operator whose client
# can never start it.
# Keep this identical to engram_client_binary in bootstrap/install.sh — the two
# scripts run standalone via curl and cannot source a shared file.
engram_client_binary() {
  local entry candidate name
  name="$(engram_binary_name)"
  while IFS= read -r entry; do
    # A registry PATH entry arrives in whatever spelling was written into it:
    # backslashes, sometimes a trailing separator, and — since PowerShell ends its
    # lines the Windows way — a carriage return this shell would otherwise make
    # part of the directory name. Forward slashes are what `[ -x ]` reads most
    # reliably under Git Bash, and a trailing separator would make the join a `//`.
    entry="${entry%$'\r'}"
    entry="${entry//\\//}"
    entry="${entry%/}"
    [ -n "$entry" ] || continue
    candidate="$entry/$name"
    if [ -f "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done <<< "$(client_path_entries)"
  return 0
}

# The bar every engram gets held to here, whichever run put it on the machine: a
# checksum proves which bytes arrived and a file test proves they are there, but
# asking the binary to answer is what proves this machine will let it run.
# Upstream's prebuilt releases are unsigned and it documents Defender and other
# scanners flagging them as a heuristic false positive — a quarantined copy
# surfaces here, as a binary that is gone or will not start, instead of as a
# confusing failure somewhere downstream.
# Keep this identical to engram_binary_runs in bootstrap/install.sh — the two
# scripts run standalone via curl and cannot source a shared file.
engram_binary_runs() {
  "$1" version >/dev/null 2>&1
}

# 13. The binary check 2's engram line depends on: resolvable against the PATH the
#     CLIENT resolves it with, and able to answer when it is run. The engram
#     plugin's .mcp.json launches `{"command": "engram"}`, so what starts that
#     server is a PATH lookup inside
#     claude.exe — and check 2 runs `claude mcp list` from THIS shell, whose PATH
#     under Git Bash carries /usr/bin, /mingw64/bin and $HOME/bin, none of which a
#     native Windows process can use. An engram reachable only from here would make
#     check 2 green for a client that will never start it, and one installed while
#     this shell holds a stale PATH would make it red for a client that will.
#     Resolving is half the answer: a file test says a binary is there, and check 2
#     goes red over a quarantined one that cannot start — so a green here on a
#     binary nobody ran would corroborate a PATH diagnosis for a machine whose PATH
#     is fine, which is the one thing a check beside a red one must not do.
#     Off Windows there is one PATH: the client starts from a shell like this one,
#     so check 2 already exercises the same lookup by spawning the server, and this
#     is a note rather than a check that could only pass vacuously — the shape
#     check 12 takes where %USERPROFILE% is unset.
if running_on_windows; then
  engram_binary="$(engram_client_binary)"
  if [ -z "$engram_binary" ]; then
    engram_binary_state="no $(engram_binary_name) on the persisted machine or user PATH"
  elif engram_binary_runs "$engram_binary"; then
    engram_binary_state=1
  else
    engram_binary_state="$engram_binary does not run"
  fi
  check "engram binary the client resolves and runs" "1" "$engram_binary_state" \
    "bash bootstrap/install.sh downloads the pinned engram release into ~/.local/bin and reports it only once it answers; where one is already installed elsewhere, the verdict above says which half is missing — a directory not on the persisted PATH, which that run's wiring summary names the command to add (a new terminal plus a Claude Code restart is what picks it up), or a copy that does not run, which an antivirus may have quarantined and which that run tells you how to replace"
  [ -z "$engram_binary" ] || echo "      engram binary: $engram_binary"
else
  echo "note: engram binary the client resolves and runs — this is not Git Bash on Windows, so the client resolves a bare \`engram\` against this same PATH and starting the server exercises both, which check 2 already does"
fi

echo "----"
echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
