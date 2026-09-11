
# Measuring the Codex Stop hook against the read-only sandbox

This file is a measurement record, not a design document. It settles three
questions about Codex 0.153.2 by running real `codex exec` sessions against a
disposable home, never against the operator's own `~/.codex` or
`~/.local/state/oso-code`. It writes no production code and changes no
behavior; a later slice reads its conclusions.

Every probe below built its own `ROOT` under `mktemp -d`, pointed `HOME`,
`USERPROFILE`, `CODEX_HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME` and
`XDG_CACHE_HOME` inside it, and removed `ROOT` once the run finished. The only
file read from the operator's real Codex home was `~/.codex/auth.json`, copied
in once per probe and never written back. Binary under test:
`codex-cli 0.153.2` at `/home/tribalcode/.local/share/mise/installs/codex/0.153.2/bin/codex`,
matching the `SUPPORTED_CODEX_VERSION` pin in `core/src/install/pins.ts`.

Eight probes made a real network call to the model; three more (`codex
features list`, `codex debug prompt-input`, `strings` on the binary) made
none. Total live-model wall time across the run was a few minutes.

`codex exec`'s stderr is never part of a measurement below: these
transcripts show its stdout, and stderr is reproduced only inside a probe
that measures stderr on purpose, such as the hook's own stderr text in
Question 2 or the `strings` grep in Question 3. Whatever else a given
invocation writes to stderr is omitted from its transcript for that reason,
named or not, without depending on an exact count of what it could print.

Two lines were confirmed present, in that order, on every invocation below
that reaches past config loading, by rerunning this document's commands with
hooks off and on, with and without `--sandbox read-only`, with and without
`--dangerously-bypass-hook-trust`, with and without `--json`, and with stdin
closed both via `</dev/null` and via `0<&-`, in a fresh disposable home:

```
WARNING: proceeding, even though we could not create PATH aliases: Refusing to
create helper binaries under temporary dir "/tmp" (codex_home: ...)
Reading additional input from stdin...
```

The first line is Codex declining to place PATH-alias helper binaries
directly under `/tmp`; the second prints even when stdin is explicitly
closed. Neither is related to sandboxing or hooks, and both are omitted from
the transcripts below after this notice. The one invocation below that does
not reach this point is the literal Plan-Mode framing attempt in Question 1:
it fails at config validation before Codex looks at stdin, so rerunning it
prints only the first line.

Every `codex exec` invocation below that also passed
`--dangerously-bypass-hook-trust` (Question 1's run and all three of Question
2's) printed two more stdout lines before `turn.started`:

```
{"type":"item.completed","item":{"id":"item_0","type":"error","message":"`--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation."}}
{"type":"item.completed","item":{"id":"item_1","type":"error","message":"`--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation."}}
```

These two lines are a fixed artifact of the flag, reproduced identically on
every invocation, including a repeat inside one unchanged `CODEX_HOME`. They
are not a measurement outcome, and are omitted from the transcripts below
after this notice, the same way the PATH-alias stderr line above is.

## Question 1 — is the Stop hook subprocess inside the read-only sandbox?

The question as posed names two things at once: a Plan-Mode turn and a
read-only sandbox. Ledger decision D2 already separates them — "the WRITES
are untethered from the read-only window, not the flow from the mode" — so
this probe measures the read-only sandbox window directly, and separately
checks whether `codex exec` can even produce a native Plan-Mode turn to test
the literal framing.

### Setup shared by this probe

```
ROOT=$(mktemp -d /tmp/oso-q1-probe.XXXXXX)
HOME_DIR="$ROOT/home"; CODEX_HOME="$HOME_DIR/.codex"
WORKSPACE="$ROOT/workspace"; STATE_DIR="$ROOT/state"
mkdir -p "$HOME_DIR" "$CODEX_HOME" "$WORKSPACE" "$STATE_DIR"
cp ~/.codex/auth.json "$CODEX_HOME/auth.json"
chmod 600 "$CODEX_HOME/auth.json"
RESULT_FILE="$ROOT/stop-hook-result.json"

cat > "$CODEX_HOME/hooks.json" <<EOF
{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node $ROOT/stop-hook.mjs"}]}]}}
EOF

cat > "$CODEX_HOME/config.toml" <<EOF
[features]
hooks = true

[sandbox_workspace_write]
writable_roots = ["$STATE_DIR"]
EOF

cat > "$ROOT/stop-hook.mjs" <<'HOOKEOF'
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const stateDir = process.env.OSO_PROBE_STATE_DIR;
const resultFile = process.env.OSO_PROBE_RESULT_FILE;

function readStdin() {
  return new Promise((resolve, reject) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (text += chunk));
    process.stdin.on("end", () => resolve(text));
    process.stdin.on("error", reject);
  });
}

const payloadText = await readStdin();
let outcome;
try {
  const target = path.join(stateDir, "hook-write");
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "marker.txt"), "stop-hook-wrote\n");
  outcome = { writeAttempt: "ok", errorCode: null };
} catch (error) {
  outcome = { writeAttempt: "failed", errorCode: error.code ?? String(error) };
}

const record = { hookEventName: JSON.parse(payloadText).hook_event_name, cwd: process.cwd(), ...outcome };
fs.writeFileSync(resultFile, JSON.stringify(record) + "\n");
process.stdout.write("{}");
HOOKEOF
```

`STATE_DIR` stands in for `~/.local/state/oso-code`: it sits outside the
workspace and is declared as a `sandbox_workspace_write.writable_roots`
entry, matching the "oso" permission profile shape the installer already
seeds (`docs/certify-codex-native-cycle.md`).

### The run

```
PROMPT="Run exactly this shell command and report its exit code and stderr \
verbatim: mkdir -p ${STATE_DIR}/model-write && date > \
${STATE_DIR}/model-write/marker.txt . Do not retry it if it fails. After \
reporting, respond with exactly PROBE_Q1_DONE and stop."

env -i HOME="$HOME_DIR" USERPROFILE="$HOME_DIR" CODEX_HOME="$CODEX_HOME" \
  XDG_CONFIG_HOME="$ROOT/xdg-config" XDG_STATE_HOME="$ROOT/xdg-state" \
  XDG_CACHE_HOME="$ROOT/xdg-cache" OSO_PROBE_STATE_DIR="$STATE_DIR" \
  OSO_PROBE_RESULT_FILE="$RESULT_FILE" PATH="$PATH" \
  timeout 120 codex exec --ephemeral --json --sandbox read-only \
  --dangerously-bypass-hook-trust --skip-git-repo-check -C "$WORKSPACE" "$PROMPT"
```

### Real output

```
{"type":"thread.started","thread_id":"01a08ed6-d0e2-78c3-ab05-c7b856f895fc"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"I’ll run the command once and report its exit code and stderr.\n"}}
{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"Exit code: 1\n\nStderr:\n```text\nmkdir: cannot create directory ‘.../state/model-write’: Read-only file system\n```\n\nPROBE_Q1_DONE"}}
{"type":"turn.completed","usage":{"input_tokens":30242,"cached_input_tokens":26368,"cache_write_input_tokens":0,"output_tokens":261,"reasoning_output_tokens":0}}
```

`RESULT_FILE` after the run:

```
{"hookEventName":"Stop","cwd":".../workspace","writeAttempt":"ok","errorCode":null}
```

`STATE_DIR/hook-write/marker.txt` exists and reads `stop-hook-wrote`.

### Conclusion — MEASURED

In the same run, in the same `STATE_DIR`, under the same `--sandbox
read-only`: the model's own sandboxed shell command got `EROFS`
(`mkdir: ... Read-only file system`), while the Stop hook subprocess wrote
`STATE_DIR/hook-write/marker.txt` without error. **The Stop hook subprocess
is not inside the read-only sandbox.** This corroborates and extends the
`PreToolUse` signal already on file (four `PreToolUse` events in the
operator's `events.jsonl` while the model itself got `EROFS`): the same
result now holds for the `Stop` event specifically, which that signal alone
did not establish.

This also directly reproduces the given evidence that "read-only mode
subordinates every writable-root declaration" — `STATE_DIR` was declared
writable and the model's own command still failed.

An independent verifier reproduced this probe from the commands above in its
own disposable home and reported a stronger form: with the hook's target
directory declared **outside** `sandbox_workspace_write.writable_roots`
entirely, the Stop hook still wrote to it without error. The hook's
unconstrained write is therefore not conditioned on the workspace-write
declaration at all; it is unconstrained by the sandbox regardless of what
`writable_roots` names.

### The literal "Plan-Mode turn" framing — NOT-MEASURED-BECAUSE

```
codex exec --json --skip-git-repo-check --strict-config \
  -c collaboration_mode=\"plan\" -C "$WORKSPACE" "Respond exactly OK and stop."
```

```
Error loading config.toml: unknown configuration field `collaboration_mode` in -c/--config override
```

`collaboration_mode` is not a recognized key at 0.153.2 under
`--strict-config`. A plain `codex exec` run with no override, inspected via
its own rollout file, reports:

```
{"type":"event_msg","payload":{"type":"task_started","turn_id":"...","collaboration_mode_kind":"default"}}
```

`codex exec` has no reachable path into native Plan Mode: there is no CLI
flag or config key for it, and a natural run always reports
`collaboration_mode_kind: "default"`. Plan Mode is reachable only from the
interactive TUI (`/plan` or Shift+Tab), which this repo's own
`docs/certify-codex-native-cycle.md` already excludes as a "not measured"
row, and which `core/src/prose/skills/plan/references/codex.md:15` and
`docs/decisions/0103-codex-plan-mode-is-attested-by-the-exact-turn.md:13`
describe from the transcript side rather than the exec side. The operator's
failing session (`collaboration_mode_kind: "plan"` at its own rollout lines
12, 203, 207) was necessarily a TUI session for the same reason.

This is the one place this measurement contradicts its own framing: "during
a Codex Plan-Mode turn" cannot be produced by `codex exec`, so the literal
question stays unmeasured. Per D2 the operative condition is the read-only
sandbox window, not the mode label, and that window is exactly what the
probe above measured directly. The practical question — can the hook write
where the model's own tool call cannot — is answered, in full, above.

## Question 2 — what does Codex do with a Stop hook that exits non-zero, or whose command throws?

Three separate conditions, tested separately: a deliberate exit code other
than 2, the exit code 2 this repo's own Stop-hook design already treats as
special, and an uncaught exception with no explicit exit call at all.

### 2a — deliberate `process.exit(1)`

```
process.stdin.resume();
process.stdin.on("end", () => {
  process.stderr.write("oso-probe: deliberate exit 1, no protocol claimed\n");
  process.exit(1);
});
```

Run with the same disposable-home shape as Question 1 (fresh `ROOT`, same
`hooks.json`/`config.toml` template, prompt `"Respond exactly OK and stop.
Do not call any tools."`, `--sandbox read-only`).

```
{"type":"thread.started","thread_id":"01a08ed9-c8fd-7f22-aef5-21bf02ff1e92"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"OK"}}
{"type":"turn.completed","usage":{"input_tokens":14778,"cached_input_tokens":11520,"cache_write_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0}}
```

`codex exec` itself exited 0. **MEASURED: a Stop hook exiting 1 is silently
ignored.** Nothing in the JSON stream, and nothing on `codex exec`'s own
stderr, names the hook, its exit code, or its stderr text. The turn completes
as if no Stop hook were installed at all.

### 2b — the documented `process.exit(2)` convention

```
process.stdin.resume();
process.stdin.on("end", () => {
  process.stderr.write("PROBE_Q2_CONTINUE_7f2a\n");
  process.exit(2);
});
```

This hook returns 2 on every invocation, unconditionally. Same run shape as
2a.

```
{"type":"thread.started","thread_id":"01a08eda-061a-78c2-904f-c3b269cabaca"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"OK"}}
{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"OK"}}
... 23 "OK" agent_message items in total, 1 "turn.started", 0 "turn.completed" ...
```

`codex exec` never reached `turn.completed`; the harness's own `timeout 60`
killed it (exit 124). **MEASURED: exit code 2 blocks the Stop and feeds the
hook's stderr back to the agent as new input**, re-opening the turn rather
than ending it. Because this probe's hook always answers 2, the loop never
terminates on its own — a live demonstration of why a real Stop hook must
eventually answer allow.

An independent, pre-existing measurement in this repo agrees. Its hook (
`core/test/certify/support/codex-stop-drive.ts:285`, `process.exit(2)`) only
does this on the first invocation, then returns `{}` on the second, so the
loop closes after exactly one continuation:

```
cd core
OSO_CERTIFY=1 OSO_CERTIFY_ALLOW_CODEX_STOP_PROBE=1 CODEX_HOME=/home/tribalcode/.codex \
  node --experimental-strip-types --test test/certify/codex-stop-continuation.test.ts
```

```
✔ Codex exec performs a first response, one native continuation, and a final Stop without user input (9999.69493ms)
﹣ installed Codex TUI Stop behavior remains an explicit unmeasured certification row (0.182505ms)
ℹ tests 2
ℹ pass 1
ℹ skipped 1
```

That test's own auth handling (`core/test/certify/support/codex-stop-drive.ts:117`,
`copyFileSync`) only ever reads `~/.codex/auth.json`; setting `CODEX_HOME` to
the operator's real value here served that one read, never a write.

### 2c — an uncaught exception, no explicit exit call

```
process.stdin.resume();
process.stdin.on("end", () => {
  throw new Error("PROBE_Q2_UNCAUGHT_THROW");
});
```

Run standalone first, outside Codex, to confirm Node's own behavior:

```
$ node stop-hook.mjs </dev/null
Error: PROBE_Q2_UNCAUGHT_THROW
    at ReadStream.<anonymous> (.../stop-hook.mjs:3:9)
    ...
node-standalone-exit=1
```

First attempt under `codex exec` (same shape as 2a, `timeout 90`): the whole
process produced zero stdout and hung the full 90 seconds before the
timeout killed it (`codex exec` exit 124). Immediate retry with the
identical hook script and a fresh disposable home:

```
{"type":"thread.started","thread_id":"01a08edd-6b3b-7d52-aee1-2362089fc666"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"OK"}}
{"type":"turn.completed","usage":{"input_tokens":14781,"cached_input_tokens":11520,"cache_write_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0}}
```

`codex exec` exited 0, identical in shape to 2a. The first attempt's 90-second
hang did not reproduce on an unchanged hook and a fresh session, so it reads
as a transient condition of that one call — cold start, network hiccup — not
as a distinct behavior tied to the throw. **MEASURED (on the reproducible
attempt): an uncaught exception in the Stop hook subprocess is also silently
swallowed**, indistinguishable from 2a. The one non-reproducing attempt is
recorded above rather than discarded, and is not used to draw this
conclusion.

### Synthesis

| Condition | Codex's visible reaction | Confidence |
|---|---|---|
| exit 1 | silent; turn completes normally | MEASURED |
| exit 2 | blocks; stderr becomes new input; loops if repeated | MEASURED, corroborated independently |
| uncaught throw, no exit call | silent; turn completes normally | MEASURED, one non-reproducing attempt noted |

None of the three conditions surface a warning to the operator. This is the
fact D9 motivates: today, `core/src/state/plan.ts:94`'s bare `mkdirSync`
inside `requireNonSymlinkDirectory` throws a plain Node error on an
unwritable state root, and `core/src/gates/planstop.ts:89-100`'s
`captureNativePresentation` already catches every exception `runCapturePlan`
can raise and turns it into a `blocked` verdict rather than letting it
reach the process boundary. If a future change to `runCapturePlan` ever let
an exception escape that catch, `core/src/gates/dispatch.ts:64`'s routing of
`STOP_GATES` to `loudRun` (`dispatch.ts:103,105`) would still convert it to
a clean `exit: 1`, `stdout: ""` — and per this measurement, Codex would let
that pass without a trace. The invariant D2 names — the rail never fails
silently in that window — is therefore not something Codex enforces for
this repo; it is something this repo's own gate code has to keep enforcing
itself, all the way to the process boundary.

## Question 3 — is `request_user_input_async` callable in Default mode at 0.153.2?

This question is scoped as cheap and secondary. Four cheap checks were run;
none of them settles it, and the reason is recorded rather than guessed.

### `codex features list`, full output

```
ROOT=$(mktemp -d /tmp/oso-q3-features.XXXXXX)
HOME_DIR="$ROOT/home"; CODEX_HOME="$HOME_DIR/.codex"
mkdir -p "$HOME_DIR" "$CODEX_HOME"
cp ~/.codex/auth.json "$CODEX_HOME/auth.json"
chmod 600 "$CODEX_HOME/auth.json"

env -i HOME="$HOME_DIR" USERPROFILE="$HOME_DIR" CODEX_HOME="$CODEX_HOME" \
  XDG_CONFIG_HOME="$ROOT/xdg-config" XDG_STATE_HOME="$ROOT/xdg-state" \
  XDG_CACHE_HOME="$ROOT/xdg-cache" PATH="$PATH" \
  codex features list
```

```
apps                                     stable             true
...
collaboration_modes                      removed            true
...
default_mode_request_user_input          under development  false
...
hooks                                    stable             true
...
send_async_message                       removed            false
...
```

135-row table observed, identical across three separate invocations of the
command above, each in a fresh disposable home. Two feature names touch this
question: `default_mode_request_user_input`, whose name concerns the
synchronous `request_user_input` tool rather than the `_async` one, and
`send_async_message` — `removed`, `false` — a distinct identifier from the
`send_user_message_async` tool whose own embedded prompt text is quoted
later in this section. No feature key named `request_user_input_async`, or
matching it, appears anywhere in the list.

### `codex debug prompt-input`, Default-mode developer text

```
cd "$ROOT/workspace"
env -i HOME="$HOME_DIR" USERPROFILE="$HOME_DIR" CODEX_HOME="$CODEX_HOME" PATH="$PATH" \
  codex debug prompt-input "hello" > prompt-input.json
```

This command needs no network call; it renders the prompt Codex would send,
locally. Its developer-role text says, verbatim:

> ## request_user_input availability
>
> Use the `request_user_input` tool only when it is listed in the available
> tools for this turn.
>
> In Default mode, strongly prefer making reasonable assumptions and
> executing the user's request rather than stopping to ask questions.
>
> Use the `request_user_input` tool only for optional questions where the
> answer would materially improve the quality of the work.
>
> If `request_user_input` returns no answers, continue with best judgment
> instead of asking again or treating the turn as blocked.
>
> Never use the `request_user_input` tool for permission requests or
> permission-related escalations.
>
> If explicit user input is required for another reason before progress can
> safely continue, do not use the `request_user_input` tool. Ask the user
> directly with one concise plain-text question instead. Never write a
> multiple choice question as a textual assistant message.

This is the section's full text — nothing follows it before the closing
`</collaboration_mode>` tag in the raw dump. The string
`request_user_input_async` does not appear anywhere in this Default-mode
prompt-input dump, even though the dump names the mode ("Known mode names
are Default and Plan") and states a Default-mode restriction for the tool's
sibling by name.

### The tool exists, and its own availability is conditional by name

```
strings -a /home/tribalcode/.local/share/mise/installs/codex/0.153.2/bin/codex \
  | grep -F "request_user_input_async"
```

```
core/src/tools/handlers/request_user_input_async.rs
request_user_input_asyncAsk the user one or more questions during ongoing
work. ... The tool returns immediately without ending the turn or waiting
for a reply; any reply arrives asynchronously as a new user message. ...
You can use the `functions.send_user_message_async` or
`functions.request_user_input_async` tool (depending on which is available)
to ask the user for missing information...
```

The tool is real, has its own Rust handler, and its own embedded prompt text
says its presence is conditional — "depending on which is available" — but
does not say on what.

### Two live attempts to force a genuine call, both inconclusive

```
codex exec --ephemeral --json --skip-git-repo-check -C "$WORKSPACE" \
  "Call the tool named request_user_input_async right now with the prompt \
'ping', if and only if that exact tool is available to you in this \
collaboration mode. If you cannot find a tool with that exact name \
available, do not call any tool and instead respond with exactly \
NOT_AVAILABLE and stop. If you do call it, respond with exactly CALLED \
after the call resolves or times out, and stop."
```

```
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"ping"}}
{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"CALLED"}}
```

A second attempt with a more explicit "this is a real function call, not
prose" instruction produced the same shape: an `agent_message` reading
`"ping"`, then one reading `""`. Neither attempt produced a distinct
tool-call item in the `--json` stream, in either direction — no item type
other than `agent_message` ever appeared. This does not distinguish "the
tool was unavailable" from "the model narrated the instruction instead of
placing a genuine function call."

### Conclusion — NOT-MEASURED-BECAUSE

None of the four checks yields a clean answer. What would settle it: the
literal `tools` array Codex transmits to the model for a Default-mode turn,
compared against the same array for a Plan-mode turn. That array is visible
only inside the outbound HTTPS request body. No `codex` subcommand on this
host exposes it, and this measurement did not attempt to intercept it — a
TLS-terminating local proxy is a materially larger undertaking than the
"cheap, secondary" bound this question was given. A live probe could also
settle it if a genuine tool-call item type appeared in the `--json` stream
for one mode and a refusal appeared for the other; neither attempt above
produced that signal in either direction.

## What this record did not attempt

- **A genuine native Plan-Mode turn.** Requires the interactive TUI; `codex
  exec` cannot reach it, per Question 1's secondary finding above.
- **Every non-zero exit code for the Stop hook.** Only 1, 2, and an uncaught
  throw (which itself yielded exit 1) were tested; other codes are
  untested and not assumed to match.
- **The literal outbound tool schema for Question 3.** Recorded above as the
  missing piece, not attempted.
