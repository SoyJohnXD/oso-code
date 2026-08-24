# 0151 — The OpenCode baseline: the pin, the plugin contract, and the F7 verdict

Date: 2026-08-18
Status: accepted
Supersedes: the host-surface evidence in engram `oso/opencode-parity/ledger` #2913 and `docs/opencode-parity-plan.md` section 3 where it contradicts what the installed 1.18.18 binary and a live probe proved — the plugin module shape, the local plugin discovery rule, the config `plugin` key form, the headless permission defaults, and the location-filter claim about hooks in worktree sessions
Superseded-by: ADR-0152 — retires only the pending `permission.skill` line in the Consequences below ("S3 must empirically re-check skill visibility control; the parity ledger's `permission.skill` claim is downgraded to unverified until then"): the re-check happened and the frozen claim survived it. The pin, the plugin contract and the F7 verdict this decision settles all stand
Reconciled: applied — the first slice of the opencode-parity plan (`docs/opencode-parity-plan.md`) is what arms the port: it pins the host in `bootstrap/install-opencode.sh`, re-verifies the contract against THAT binary, and settles F7, the blocking doubt that decided whether the gate rail could reach appliers running in worktrees. Slices S2-S16 build on these facts; nothing in the frozen plan that touches the plugin contract or the gate rail may be implemented before this ADR.
Source: slice S1 of the opencode-parity plan; a live probe fixture at `/tmp/opencode/f7-probe` (project repo, tracked `.opencode/plugins/probe.ts`, git worktree `wt1` mirroring the adapter's `git worktree add -b <branch> <path> <WAVE START>`), headless sessions via `opencode run` against the built-in `opencode` provider model `deepseek-v4-flash-free`

## Decision

**OpenCode 1.18.18 is the pinned host of this port, and the gate rail is viable: `tool.execute.before` fires for sessions pinned to worktree directories, a throw inside it blocks the tool and surfaces the reason to the model, and `shell.env` reaches the tool process. The host contract re-verification that follows replaces the frozen-plan surface claims wherever they differ.**

### Part 1 — the pin and the probe environment

`SUPPORTED_OPENCODE_VERSION=1.18.18` is the pin carried by `bootstrap/install-opencode.sh` and asserted against the installed binary by a probe: `opencode --version` reports `1.18.18` (upgraded 2026-08-18 from 1.15.13 via the official installer; npm latest at the time). Every claim below was verified against THAT binary — `strings` evidence plus live headless sessions against a tracked probe plugin, with the operator's global config untouched.

The probe fixture mirrors the adapter's worktree mechanics: a git repo with a committed baseline, `git worktree add -b probe/wt1 <path>` (exactly the command D23's adapter runs), and a session launched with `opencode run --dir <worktree>` — `--dir` sets `session.directory`, the same value the TUI's worktree pin writes. The plugin is a named-export module in the tracked `.opencode/plugins/` directory, so the worktree checkout carries it — which is itself a load-bearing finding (Part 2).

### Part 2 — the plugin contract, corrected

Three frozen-plan claims about the plugin surface were wrong or unverifiable, and each correction changes an implementation detail:

- **Module shape.** A plugin module must export one or more NAMED plugin functions (`export const X = async (ctx) => hooks`), not a default object and not a default function. A plain object export fails load with `Plugin export is not a function`. The plugin function receives `{ project, client, $, directory, worktree }`.
- **Discovery.** Local plugins auto-load from `.opencode/plugins/` (project) and `~/.config/opencode/plugins/` (global) — no config entry needed. The config `plugin` key is an ARRAY of npm package names; the object form (`"plugin": {"probe": "./plugin/probe.ts"}`) is a HARD startup error: `Configuration is invalid at <path>`. D20's installed layout (single entry module importing sibling modules) survives, with the caveat that every module placed inside a plugins directory is treated as a plugin module — the `oso/*` siblings must live outside it and be imported by the entry.
- **Config strictness.** Confirmed: unknown/ill-typed config keys fail startup loudly with the offending path (captured: `Error: Configuration is invalid at /tmp/opencode/f7-probe/cfgtest/opencode.json`, artifact `run-g-cfgerr.json`). The installer owns `opencode.json` wholesale (D6) and must never emit an object-typed `plugin`.

### Part 3 — F7, the blocking doubt, is settled PASS

The question was: does `tool.execute.before` fire for child sessions pinned to a worktree? If tool hooks were directory-scoped like the `event` hook's `location` filter, appliers in worktrees would run with no commit gate exactly where the commits happen.

Live probe, session pinned to the worktree:

```
PLUGIN_INIT project={"id":"3e4cff3843c8aecce98e097659cab75724aa28a3","worktree":"/tmp/opencode/f7-probe/wt1","vcs":"git",...,"sandboxes":["/tmp/opencode/f7-probe/project"]} directory=/tmp/opencode/f7-probe/wt1 worktree=/tmp/opencode/f7-probe/wt1
TOOL_HOOK tool=bash session=ses_fe991a7d9ffeLtI06q12v6FNsB
TOOL_AFTER tool=bash session=ses_fe991a7d9ffeLtI06q12v6FNsB
```

Three facts fall out of that one log (quoted from the probe run captured in `run-a.json`):

1. The worktree session resolves to the SAME project instance as the root (identical `project.id`), with `project.worktree` reporting the worktree path and `sandboxes` listing the root. Hooks registered at project level therefore run for its worktree sessions — there is no second plugin instance and no directory filter on tool hooks.
2. `tool.execute.before` fired for the worktree session's bash call, and `tool.execute.after` fired after it. The commit-gate rail (D1) reaches worktree appliers.
3. The event hook fired too (`session.idle` during the worktree run) — the frozen plan's claim that hooks never fire for child worktrees was about the `location.directory`-filtered variant and is not a general property of this host. Events are project-scoped, not directory-scoped.

### Part 4 — deny semantics and shell.env, proven against the binary

- **Deny.** A throw inside `tool.execute.before` blocks the tool: the TUI/headless render shows `✗ <command> failed` and `Error: <message>` in the tool result the model reads; the command does NOT execute. The gate shim (D1) therefore maps "deny" to a throw carrying the remedy — confirmed workable, and confirmed it surfaces visibly for the model.
- **shell.env.** Fires per shell invocation with `input.cwd` = the shell's working directory (the worktree path for worktree sessions), and `output.env` values ARE present in the tool process environment — proven by a worktree bash that printed `F7_PROBE_ENV=injected-wt1` (captured: `run-f-envgrep.json`; `SHELL_ENV cwd=...wt1` entries in the probe `log.txt`). D13's identity publication per invocation holds. Caveat recorded for S7: the model itself may rewrite a prompt-embedded `${VAR}` before the command runs, so verification tests must read the environment at runtime (`env | grep`), never trust an expansion written by the model.

### Part 5 — new host facts the later slices must respect

- **Headless permission defaults.** A headless session's `session.created` metadata carries `permission="[{"permission":"question","pattern":"*","action":"deny"},{"permission":"plan_enter",...deny},{"permission":"plan_exit",...deny}]"` — headless `opencode run` denies the `question` tool and BOTH plan-mode tools by default. The S10 `plan_exit` rail and the S14 wave-runner smoke must therefore operate with explicit permission configuration, or the verify path cannot exercise them headlessly.
- **Model availability.** The operator's ollama cloud models require an ollama subscription this machine does not have (`this model requires a subscription`). The built-in `opencode` provider is available and was used for every probe: `opencode/deepseek-v4-flash-free` works. S14's smoke model note is amended accordingly: prefer `opencode/deepseek-v4-flash-free`, ollama only if the subscription appears.
- **Project identity.** `project.id` is a stable hash shared by root and worktrees; `project.worktree` and `sandboxes` carry the paths. S7's identity work should key on the project object rather than re-deriving from `--git-common-dir` alone — the host already publishes the relation the harness needs.
- **Unchanged claims.** `plan_exit` / `OPENCODE_EXPERIMENTAL_PLAN_MODE` / `experimental/workspace` are present in the binary (strings). `QuestionRejectedError`, `rejected permission` and `specified a rule` all exist in the binary — D8's deny-classification strings survive. Hook identifiers `session.idle`, `session.created`, `chat.message`, `experimental.chat.system.transform`, `experimental.session.compacting` are all present in 1.18.18.
- **Still pending.** `permission.skill` is absent from the binary strings — the S3 slice must verify whether skill-hiding exists at all in 1.18.18 and what it is spelled like, before the operator-only wrappers depend on it. The MCP `environment` key claim likewise stays unverified until the S13 installer writes it.

## Consequences

- S2's gate table and the TS shim proceed with F7 proven: worktree appliers are reachable by the gate rail.
- D20's single-entry layout holds, with the sibling-modules-outside-the-plugins-dir constraint recorded.
- S10 and S14 must include explicit `permission` entries for `question`/`plan_enter`/`plan_exit` in the installed config or the harness's own config, since headless defaults deny all three.
- S3 must empirically re-check skill visibility control; the parity ledger's `permission.skill` claim is downgraded to unverified until then.
- Verification of every later slice runs against 1.18.18; a version mismatch DEGRADES claims to `unverified:<version>` per D12.
