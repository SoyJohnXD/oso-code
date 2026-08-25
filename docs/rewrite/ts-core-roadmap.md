# oso-code rewrite — the shared core in TypeScript on Node

Roadmap slug: `ts-core-rewrite`. Written 2026-08-25 from a measured audit (engram: `oso/harness-complexity-audit/diagnosis`, `/alternatives`, `/runtime-benchmark`; decision: `oso/harness-rewrite/decision`). This document is the input to `/oso-code:roadmap`: §1–§3 of that mode are answered here, once, so the chain runs without coming back to ask. Where it says DECIDED, the decision is frozen; an applier or verifier that finds it wrong reports `blocked` with evidence and never reinterprets it.

## 0. Purpose, non-goals, end state

**Purpose.** Replace the bash core of the harness — the 13 gate scripts, `oso-state`, and the per-host installers — with ONE TypeScript implementation on Node that the three hosts share: Claude Code and Codex spawn it, OpenCode imports it in-process. Rebuild the tests around it so the per-slice bar runs in seconds on Linux, macOS and Windows. Cut the instruction prose to what a model needs, and delete the machinery that exists only to police prose.

**What does not change.** The way of working: plan / quick / debug / roadmap flows, the apply → verify → integrate loop, the independent verifier, the state machine (`mode`, `active_slice`, `verify_green`, `auto`, `auto_wait`, `roadmap`), the gates' BEHAVIOUR (what is denied, when, with what message), the on-disk state format (`key=value`), the events log, the run journals, the engram topics, the three hosts. A user of the harness sees the same rails, faster.

**Non-goals (YAGNI, cut deliberately).** No new gates. No JSON state format. No Bun or Deno runtime. No Go binary. No new host. No change to the plan/quick/debug flow semantics beyond the defects named in §6.3. No retroactive comment sweep of files the rewrite does not delete.

**End state, measured at the close of child C6** (the numbers the verifier of that child reads):

| Measure | Today (2026-08-25) | Target |
|---|---|---|
| `tests/hooks-test.sh` | 13,414 lines, 1,799 asserts, 17m51s local, no single-case run | deleted; `npm test` ≤ 60 s local, one file runnable alone |
| PR CI wall time | 18 min ubuntu + 143 min windows, red 12/12 runs | ≤ 5 min on ubuntu AND windows, green |
| Windows runtime deps for hooks | Git Bash (permanent), jq | `node` only |
| Gate implementations | 2 (bash for Claude/Codex, TS duplicates for OpenCode) | 1 |
| Hook cold start | 37 ms (bash sourcing lib+lexer) | ≤ 100 ms (node bundle, measured 59 ms) |
| Installer | 8,694 lines in 12 bash scripts + 306-line awk TOML editor + python3 | one `oso` CLI, TOML/JSON via parsers, ≤ 2,500 lines |
| Lint rules over prose wording | ~39 of 51 | 0; ~12 structural checks live in `npm test` |
| Orchestrator preamble for `/plan` (Claude) | ~20,000 words (~27k tokens) | ≤ 6,000 words (~8k tokens) |
| Files to hand-maintain per rule | 3–6 (body, 3 platform files, README, lint) | 1 (+ one host reference where a host differs) |
| Cost of adding a host | +15,201 lines (OpenCode, measured) | one adapter module + one `references/<host>.md` per skill, ≤ 1,500 lines |

## 1. Facts the design stands on (verified, with where)

- Node ≥ 22 is ALREADY a hard requirement of the bootstrap (`bootstrap/install.ps1:67`; `docs/windows.md` "Node.js 22 or newer"); Git Bash is documented there as "a permanent runtime dependency" only because every hook is a `.sh`. jq is provisioned only to edit `settings.json`.
- Claude Code hooks reference (fetched 2026-08-25, https://code.claude.com/docs/en/hooks.md): a `command` hook has an EXEC form — `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/…/gate.js", "commit"]` — that runs without any shell; on Windows the exec form needs a real executable (`node.exe` is one). Shell form uses Git Bash on Windows when installed, PowerShell otherwise. `if` takes permission-rule syntax (`"Bash(git *)"`) and is evaluated only on tool events. Exit 2 blocks on blockable events "whether or not you print JSON"; the blocking message is the JSON reason if any, stderr otherwise. Stop hooks return `shouldContinue: true` to prevent stopping ("exit 2 has the same effect"). SessionStart may return `additionalContext`. Default `command` timeout 600 s.
- Codex runs the same hook scripts with the same JSON envelope today (`codex/hooks/hooks.json`: PreToolUse, SubagentStop, Stop, UserPromptSubmit, SessionStart, SessionEnd), shell form, `__OSO_HOOKS_DIR__` substituted by the installer. Codex hook documentation is thin; what the repo has MEASURED on the pinned Codex is the contract (`docs/parity-codex.md`).
- OpenCode gates are routed by `opencode/hooks/routes.ts` from `tool.execute.before`, `experimental.chat.system.transform`, `dispose`, `event`; the shim spawns `bash <gate>.sh` (`opencode/plugin/oso/gates.ts:169`) and `oso-state` (`plan-state.ts:68`). `unattended-run.ts` and `approval.ts` REIMPLEMENT in TS what `auto-continue.sh`, `capture-plan-approval.sh` and `approve-plan-token.sh` do in bash. OpenCode plugins are TS by the host's own contract.
- Agent Skills (`SKILL.md`) is an open standard (agentskills.io) read by Claude Code, Codex CLI (`~/.codex/skills`, `.agents/skills`) and OpenCode. Anthropic's skill guidance: SKILL.md body < 500 lines, references one level deep, SKILL.md is an overview and not only pointers, one default with an escape hatch.
- Benchmarks on the operator's machine (Linux, node 26): gate-shaped cold start bash 37 ms / node bundle 59 ms / node running `.ts` directly 89 ms; 100 `node:test` cases in 0.18 s; `cd opencode && node --test` runs 152 cases in 5 s.
- Four verified, unfixed defects in the unattended rails (engram `oso/auto-wait-stall-field-failure/diagnosis`): (1) `auto_wait` is never returned to `none` because the close commands in a host-neutral body cannot carry a Claude-only key; (2) the 45-minute expiry is evaluated only inside a `Stop`, so a held stop never expires; (3) the wait mark is keyed on `auto_change` and re-dated at every child boundary; (4) auto-compaction has never executed in a real run.
- `bodies/plan.md:19` instructs the orchestrator to write `$OSO_STATE_DIR/deploy-deny/<digest>.patterns`; `OSO_STATE_DIR` exists only inside `plugin/hooks/lib.sh:260` (not exported) and `oso-state` has no verb for it.
- The tree that GOVERNS the rewrite is the installed release (`~/.claude/plugins/cache/oso-code/oso-code/0.25.0`), never the working tree being rewritten. Nothing in this roadmap edits the installed copy until C6.

## 2. Global ledger (applies to every child unless a child says otherwise)

**G1 — Language and runtime. DECIDED.** TypeScript, strict, compiled and bundled to plain JavaScript (ESM) that runs on Node ≥ 22. Hooks and CLIs are never run from `.ts` at runtime. Code is written against Node's standard APIs (`node:fs`, `node:child_process`, `node:crypto`, `node:path`, `node:test`) and nothing Bun- or Deno-specific.

**G2 — Repository layout. DECIDED.** One npm workspace at the root:

```
package.json                 workspaces: core, opencode; scripts: build, test, typecheck, check
core/                        the shared implementation
  package.json               name @oso-code/core, private
  src/state/                 schema.ts, store.ts, transitions.ts, cli.ts   (oso-state)
  src/gates/                 one file per gate: commit.ts edits.ts unknown.ts proddeploy.ts
                             autocontinue.ts planstop.ts planprompt.ts handoff.ts
                             stale.ts version.ts teardown.ts reanchor.ts statebin.ts
  src/shell/                 lexer.ts (port of plugin/hooks/lexer.sh, same records)
  src/hosts/                 envelope.ts (hook input/output types), claude.ts, codex.ts
  src/routes/                routes.ts — the gate table (replaces tools/hook-gates.txt) and
                             render.ts — hooks.json for Claude and Codex from that table
  src/install/               oso.ts (CLI), claude.ts codex.ts opencode.ts, toml.ts json.ts,
                             backup.ts verify.ts repair.ts purge.ts, trust.ts (hashes)
  src/bin/                   gate.ts, oso-state.ts, oso.ts, precommit.ts (entry points)
  test/                      mirrors src; test/fixtures/ holds the parity fixtures (§7)
plugin/                      the Claude Code plugin root (unchanged location)
  dist/                      COMMITTED bundles: gate.js, oso-state.js, precommit.js
  hooks/hooks.json           rendered, exec form, node
  skills/ agents/ output-styles/   (reshaped in C5)
codex/                       manifests + rendered agents/skills; hooks copy plugin/dist
opencode/
  plugin/oso-code.ts         the OpenCode plugin: an adapter importing @oso-code/core
  dist/oso-code.js           COMMITTED bundle with the core inlined
bootstrap/
  install.sh install.ps1     thin: check node ≥ 22, exec `node bootstrap/oso.js …`
  oso.js                     COMMITTED bundle of core/src/bin/oso.ts
  hook-hashes.txt            generated from the committed bundles
.github/workflows/pr.yml     the PR gate (≤ 5 min)
.github/workflows/nightly.yml   host certification and real installs
```

Bundles are committed because a Claude Code marketplace install is a git checkout with no build step, and `${CLAUDE_PLUGIN_ROOT}` must point at runnable files. `npm run check` fails when a committed bundle differs from a fresh build (the same discipline `tools/render-hooks-json.sh --check` enforces today).

**G3 — Toolchain, pinned by the first slice of C1 at the versions `npm view` returns then. DECIDED.** `typescript` (7.0.2 today; fall back to the latest 5.x only if the 7.x compiler rejects the tree — recorded as delegated), `esbuild` (0.28.x), `smol-toml` (1.8.x) as the only runtime dependency of the installer, `@types/node`. Test runner `node:test` with `node --test` — zero test dependencies. No lint framework in the PR gate beyond `tsc --noEmit` and the structural checks in `core/test/structure/`.

**G4 — The bar, as numbers, enforced in CI from C1 on. DECIDED.** `npm test` ≤ 60 s on the PR runner; PR workflow ≤ 5 min wall on ubuntu and windows; one gate cold start ≤ 100 ms measured by a test that spawns the bundle 20 times and asserts the mean; `core/` source ≤ 6,000 lines and `core/test/` ≤ 8,000 lines at C6 (guards against re-growing the monolith); no test in the PR gate may read the developer's real `$HOME`, network, or an installed host binary — such a test belongs to nightly.

**G5 — Host mechanisms after the rewrite. DECIDED.** Behaviour per gate is unchanged; only the transport changes. The table below is the source that `core/src/routes/routes.ts` encodes and `render.ts` renders; `tools/hook-gates.txt` is deleted in C2.

| gate | event | Claude Code | Codex | OpenCode |
|---|---|---|---|---|
| commit | PreToolUse | exec form `node gate.js commit`, `if: "Bash(git *)"` | `node "<hooks dir>/gate.js" commit` | in-process, `tool.execute.before`, matcher `bash` |
| edits | PreToolUse | exec form, matcher `Edit\|MultiEdit\|Write\|NotebookEdit\|mcp__fallow__fix_apply` | shell form, matcher `apply_patch\|mcp__fallow__fix_apply` | in-process, matcher `edit\|write\|fallow_fix_apply\|apply_patch` |
| unknown | PreToolUse | not wired (as today) | shell form, `--allow` list from the table | in-process, allow list from the table |
| proddeploy | PreToolUse | exec form, matcher `Bash\|mcp__.*deploy.*` | shell form, same matcher | in-process, matcher `bash\|.*deploy.*` |
| autocontinue | Stop | exec form; the push is `shouldContinue: true` on the pinned client, exit-2 fallback measured in C2 | not wired (as today) | in-process on `session.idle` (the same core function; `unattended-run.ts` is deleted) |
| planstop | Stop | not wired | shell form | not wired |
| planprompt | UserPromptSubmit | not wired | shell form | not wired |
| handoff | SubagentStop | not wired | shell form, matcher = the role list | native (wave tool) |
| statebin | SessionStart | exec form | not wired | native |
| stale | SessionStart | exec form, `additionalContext` | shell form | in-process, `experimental.chat.system.transform` |
| version | SessionStart | exec form | not wired | not wired |
| reanchor | SessionStart | exec form, `additionalContext` | not wired | in-process, `event` (`session.compacted`) |
| teardown | SessionEnd | exec form | shell form | in-process, `dispose` |
| git pre-commit | git hook | 3-line `sh` wrapper (git supplies `sh` on every OS) calling `node <plugin>/dist/precommit.js` | same wrapper | same wrapper |

The deny mechanism for Claude and Codex stays the exit-code contract (exit 2, message on stderr) because both hosts honour it today and the parity fixtures assert it byte for byte. JSON output is used only where a gate already returns structured data (`additionalContext` on SessionStart, the Stop push). The OpenCode adapter maps a `GateVerdict` to the host exactly as `translateGateResult` does today, minus the subprocess.

**G6 — State. DECIDED.** `core/src/state/schema.ts` types the runtime state as a discriminated shape and `store.ts` reads/writes the SAME `key=value` file at the SAME path (`$HOME/.local/state/oso-code/<sha256 of the git common dir>.state`) with the same atomic-rename write; illegal combinations are rejected on read with a named error (`StateInvariantError`) instead of being interpreted. `transitions.ts` owns every multi-key write the flows perform (`arm slice`, `close slice`, `arm auto`, `park`, `disarm`), so a rule such as "a slice close returns `auto_wait` to `none`" is CODE the CLI runs, never prose the orchestrator must remember. The CLI keeps every verb and flag `plugin/bin/oso-state` accepts today (`set get show clear event capture-plan approve-plan cancel-plan amend-plan journal handoff publish|wait|consume`) with identical stdout/stderr, plus two new verbs: `close-slice <n>` (writes `active_slice=none verify_green=true auto_wait=none` in one atomic write) and `deny-pattern add <pattern>` (the write `bodies/plan.md:19` currently asks the orchestrator to do by hand).

**G7 — Events and journals. DECIDED.** `events.jsonl`, `runs/<repo>/<change>.log`, the push tally and the wait sidecar keep their paths and line formats. The wait sidecar is keyed on the RUN (`auto_change` at arming plus the session id) so a child boundary never re-dates it (defect 3).

**G8 — Tests. DECIDED.** Three layers and only the first two run in the PR gate. (1) Unit and gate tests in-process: a gate is a pure function `(envelope, state, clock, fs) → verdict`; the entry point is the only thing that touches stdin/stdout. (2) Installer tests against a fixture `HOME` created per test, no network, assertions read the resulting TOML/JSON through the parsers, never through grep. (3) Host certification in `nightly.yml`: the contract and behaviour bars against the pinned host binaries, a real install into a fixture HOME on ubuntu, macos and windows, `claude plugin validate --strict`. Nightly red opens an issue and never blocks a PR. The parity fixtures (§7) are layer 1 during the migration and stay as the regression net after it.

**G9 — CI. DECIDED.** `pr.yml`: matrix ubuntu-latest + windows-latest; steps: `npm ci`, `npm run typecheck`, `npm test`, `npm run check` (bundles and rendered manifests equal a fresh build), `claude plugin validate --strict plugin` and `--strict .` on ubuntu. `nightly.yml`: everything in G8 layer 3, plus the bash-3.2 container until C3 deletes the last bash. The current `ci.yml` is deleted by C0 after both files exist.

**G10 — Prose. DECIDED.** One `SKILL.md` per skill per host wrapper, ≤ 300 lines, carrying the flow itself; host bindings in `references/<host>.md` one level deep, present only where the host differs; agents authored once per role in `core/src/agents/*.md` and rendered to `plugin/agents/*.md`, `codex/agents/*.toml`, `opencode/agents/*.md` by `npm run build`; no rule stated in more than one file; no ADR ids, version history or "before this version" sentences in runtime prose; absolutes only where a gate enforces them. Structural checks that survive (as tests in `core/test/structure/`): every host wraps every skill; every path a prose file references resolves; rendered manifests and bundles equal a fresh build; no shipped file carries a home path; every dot-directory is owned or ignored; no verification script invokes the host binary directly; shipped executables carry no decision citations; the verdict grammar has one implementation; the Impeccable pin is never a placeholder; parity docs name the pinned harness version; the OpenCode platform overlay covers every section or declares the divergence; shell sources carry no comment below the header (until the last shell source is gone).

**G11 — Decisions record. DECIDED.** `docs/decisions/` is frozen as history: nothing is deleted, nothing new is added, and no check reads it. This document and the engram ledgers are the record of the rewrite. `docs/blueprint.md` is rewritten in C5 as a ≤ 150-line map of the new tree. `CHANGELOG.md` keeps one entry per release with no rule counting.

**G12 — Execution rules for every applier and verifier (from the operator's standing rules).** Sweep a defect CLASS, never an instance; the verifier's remit is bounded in its launch prompt and everything outside it goes to a `for_the_sweep:` list; every behavioural sentence written in prose or a commit message names the file that supports it; fix rounds are capped at two per slice, after which the finding goes to the sweep with its evidence; zero inline comments in anything written (the rubric's debt class, no repo exception); the green window is two Bash calls — the state write, then the commit — never one; when two options tie, the one with fewer moving parts wins.

**G13 — Models. DECIDED.** The operator runs the orchestrator on Opus. `oso-applier`, `oso-verifier` and the judges launch with `model: sonnet` by default, named in the announcing sentence. `model: opus`, with the reason named, on exactly these slices: C1-S2 (extracting the parity fixtures out of `tests/hooks-test.sh`), C2-S1 (the shell lexer port and the four PreToolUse deniers — the option-arity defect class lives there), C2-S3 (the Stop contract measured against the pinned client), C4-S1 (the bars against real binaries).

**G14 — Deletion discipline. DECIDED.** Every bash file is removed only by a CONTRACT slice whose Verify carries the completeness grep proving zero remaining references (`rg -n '<file>' --glob '!docs/decisions/**'` returns nothing) and whose diff deletes the tests that exercised it. Expand and Migrate slices never delete.

**G15 — Inherited from `opencode-plan-execution` (engram `oso/opencode-plan-execution/ledger`, `/plan`). DECIDED.** That run was PARKED at slice 3 of 11 on 2026-08-25. Its frozen decisions D2–D9 and D13 stay decided and are NOT re-planned: §11 assigns each to the child that lands it and the test that proves it, and that child's ledger records them as INHERITED naming this entry. Its slices 4–11 are never executed as written; their intent lands through §11. Its named pendings travel to this roadmap's presence phase.

## 3. The queue

Seven children, in order. Every child is a PLAN-mode change arriving with its intent, its own decisions and a proposed cut; its own planning phases confirm the cut against the tree and never reopen a decision written here. Sequential execution for C0, C1 and C6; parallel allowed from C2 on (the bar is `npm test`, which tolerates concurrent runs — each test owns its temp dirs).

### C0 — `rewrite-freeze`: a green 10-minute gate, prose lints gone, nothing else changed

**Intent.** Make the repository cheap to iterate on BEFORE any port: the PR gate becomes fast and green on the existing bash, the checks that police prose wording are deleted, and the record stops demanding per-decision bookkeeping. No behaviour of the harness changes.

**Decisions.**
- C0-D1: `.github/workflows/pr.yml` runs, on ubuntu only for now: `bash -n` syntax, `bash tests/plugin-lint.sh`, `cd opencode && npm ci && npm test`, `bash tests/hooks-test.sh`, `claude plugin validate --strict` (both manifests). Windows and the bash-3.2 container move to `nightly.yml` together with the three `verify-*.sh` reports, the pinned-OpenCode download and both bars.
- C0-D2: every assertion in `tests/hooks-test.sh` that reads the developer machine (installed binary versions, wall-clock bounds, network) is either given a fixture or moved under `OSO_NIGHTLY=1`. The two local failures of 2026-08-25 name the class: `the opencode installer pin matches the installed binary` and `the bounded MCP drift check ends well inside a generous multiple of its own bound`; the Windows and bash-3.2 failures (`Engram repair …`, `every workaround spelling in this table …`) are the same class.
- C0-D3: `tests/plugin-lint.sh` keeps exactly the twelve structural rules G10 lists and deletes the rest, including the four decision-bookkeeping rules (`check_every_decision_records_where_it_landed`, `check_blueprint_index_names_every_decision`, `check_cited_decisions_resolve_to_a_file`, `check_living_records_cite_lines_that_still_carry_something`) and the two count rules. README's `tests/` row becomes one sentence naming the two scripts. CHANGELOG's next entry states the rule count once and no rule reads it.
- C0-D4: `docs/decisions/` frozen per G11. A note at the top of `docs/blueprint.md` says so; the index of decisions stays as it is.

**Proposed slices.**
- S1 — `pr.yml` + `nightly.yml` exist and `ci.yml` is deleted. Files: `.github/workflows/*`. Verify: `gh workflow list` shows both; a PR run of `pr.yml` completes green under 20 min on the existing suite (observed by the orchestrator with `gh run view`); `Verify-exception: workflow files carry no unit test — the run itself is the check`. Depends-on: none.
- S2 — machine-dependent asserts fixtured or gated (C0-D2). Files: `tests/hooks-test.sh`, `bootstrap/lib/verification-fixtures.sh`. Verify: `bash tests/hooks-test.sh` exits 0 on this machine with the OpenCode binary at 1.18.23 and no network; failing-check: a new case asserting the pin check reads `OSO_PINNED_OPENCODE_VERSION` from the fixture rather than the machine. Depends-on: none.
- S3 — prose lints deleted (C0-D3). Files: `tests/plugin-lint.sh`, `README.md`, `CHANGELOG.md`, `docs/blueprint.md`. Verify: `bash tests/plugin-lint.sh` prints `lint: clean — twelve rules`; `rg -c '^check_' tests/plugin-lint.sh` = 12; failing-check: the linter's own self-test asserts each of the twelve rules flags its fixture. Depends-on: none.
- Exit for the child: `pr.yml` green on the last commit; `bash tests/hooks-test.sh` green locally; no file under `plugin/skills` changed.

### C1 — `rewrite-state`: the workspace and `oso-state` in TypeScript, bash and TS proven equal

**Intent.** Stand up the TypeScript workspace (G2, G3, G9) and port the state kernel — `plugin/bin/oso-state`, 725 lines, called at 259 sites of the suite and by every gate — as a library plus a CLI whose observable behaviour is proven identical to the bash by parity fixtures, then switch every caller to it and delete the bash.

**Decisions.**
- C1-D1: `core/src/state/store.ts` reads and writes the existing file format and path (G6); `schema.ts` validates; `transitions.ts` carries `armSlice`, `closeSlice`, `armAuto`, `park`, `disarm`, `armWait`, `clearWait`. `cli.ts` maps the verbs one-to-one to today's; stdout and stderr texts are copied from the bash verbatim (the parity fixtures assert them).
- C1-D2: parity fixtures live in `core/test/fixtures/state/*.json`: `{ name, env, state_before, argv, stdin, expect: { exit, stdout, stderr, state_after, events_appended } }`. `core/test/parity.test.ts` runs every fixture against BOTH `plugin/bin/oso-state` and `node plugin/dist/oso-state.js` while both exist. Fixtures are extracted from the `oso-state` cases of `tests/hooks-test.sh` by reading them, never by running the bash and recording its output (a recorded expectation is tautological).
- C1-D3: `plugin/hooks/lib.sh` resolves `oso-state` through `OSO_STATE_BIN` already; the MIGRATE slice points it, `persist-state-bin.sh`, the git pre-commit hook, `opencode/plugin/oso/plan-state.ts` and the installers at `node <dist>/oso-state.js`. The bash `plugin/bin/oso-state` is deleted by the CONTRACT slice with G14's grep.
- C1-D4: `npm run build` produces `plugin/dist/oso-state.js` (esbuild, `--platform=node --format=esm --bundle`), and `npm run check` diffs it. `pr.yml` gains `npm ci`, `npm run typecheck`, `npm test`, `npm run check` on ubuntu AND windows from this child on.

**Proposed slices.**
- S1 EXPAND — workspace, tsconfig strict, esbuild, `node --test`, `pr.yml` steps, an empty `core` that builds; `oso-state` CLI skeleton printing the same usage text. Verify: `npm run typecheck && npm test && npm run check` green on ubuntu and windows; failing-check: `core/test/bin/usage.test.ts` asserts the usage text equals the bash's. Depends-on: none.
- S2 EXPAND (opus) — the parity fixtures for every verb, extracted from the suite. Verify: `node --test core/test/parity.test.ts` runs ≥ 120 fixtures against the bash and all pass (the bash is the oracle at this point); failing-check: the fixture runner fails on a fixture whose `state_after` is unreachable. Depends-on: S1.
- S3 EXPAND — `store.ts`, `schema.ts`, `transitions.ts`, `cli.ts`; parity green against the TS bundle. Verify: parity passes against both binaries; `StateInvariantError` on `mode=none active_slice=3`; failing-check: a transitions test that fails when `closeSlice` omits `auto_wait=none`. Depends-on: S2.
- S4 MIGRATE — every caller on the bundle (C1-D3). Verify: `bash tests/hooks-test.sh` green with `OSO_STATE_BIN` pointing at the bundle; `cd opencode && npm test` green; failing-check: a hooks-test case that runs the suite's `persist-state-bin` path and asserts the published path ends in `oso-state.js`. Depends-on: S3.
- S5 CONTRACT — delete `plugin/bin/oso-state` and its bash-only tests; `rg -n 'bin/oso-state' --glob '!docs/decisions/**' --glob '!docs/rewrite/**'` returns nothing. Depends-on: S4.
- Exit: `npm test` ≤ 30 s; `plugin/dist/oso-state.js` committed and `npm run check` green; hooks-test green; the two new verbs exist.

### C2 — `rewrite-gates`: the thirteen gates in TypeScript, three hosts on one implementation

**Intent.** Port every gate to `core/src/gates/*` as pure functions behind one entry point, switch Claude and Codex to spawning the bundle and OpenCode to importing the core, fix the three unattended-rail defects in code, and delete every gate script, `lib.sh`, `lexer.sh`, the route table and their tests.

**Decisions.**
- C2-D1: `core/src/hosts/envelope.ts` types the hook input (`session_id`, `cwd`, `tool_name`, `tool_input`, `hook_event_name`, …) and the output (`Deny {message}`, `Allow`, `Context {additionalContext}`, `Push {reason}`); `claude.ts` and `codex.ts` serialise them to what each host accepts; the OpenCode adapter consumes the verdict object directly.
- C2-D2: `core/src/shell/lexer.ts` ports `plugin/hooks/lexer.sh` record for record (`>` command word, `.` argument, `<` stdin text); its tests are the lexer cases of the suite as fixtures plus every shape named in the option-arity defect class (git's value-taking options, wrapper prefixes, read-only markers, interpreter payloads, `bash -cO extglob`). No third-party shell parser: the gate must answer the same question the bash answers, and a library's grammar is a second source of truth.
- C2-D3: `autocontinue.ts` fixes defects 1–3: (1) the disarm is `transitions.closeSlice` (C1) so no close can omit it; (2) the expiry is reachable without a future Stop — the SessionStart `stale` gate and the OpenCode `session.idle` path evaluate the same `waitExpired(now)` function and report it, and the Stop net treats an expired mark as no mark; (3) the sidecar is keyed on the run (G7). Defect 4 (compaction) is out of scope: it is an experiment, not a port, and needs 1–3 first.
- C2-D4: parity fixtures for gates extend the C1 shape with `hook_event`, `stdin` (the envelope), `expect.exit`, `expect.stdout`, `expect.stderr`; every `run_hook` / `assert_*` case of the suite that exercises a gate becomes one fixture (~5,000 lines of bash → fixtures + `core/test/gates/*.test.ts`). The bash gate is the oracle until the MIGRATE slice.
- C2-D5: `routes.ts` is the table; `render.ts` renders `plugin/hooks/hooks.json` (exec form, `if` on the commit gate) and `codex/hooks/hooks.json` (shell form); `opencode/hooks/routes.ts` is no longer generated — the OpenCode adapter imports `routes.ts`. `tools/hook-gates.txt` and `tools/render-hooks-json.sh` are deleted by the CONTRACT slice.
- C2-D6: the OpenCode plugin (`opencode/plugin/oso-code.ts` and `oso/*.ts`) keeps its host-specific parts — `oso_plan_approve`, `oso_plan_cancel`, `oso_wave` tools, the workspace adapter, identity, trace, lifecycle wiring — and DELETES `unattended-run.ts`, `approval.ts`'s duplicated approval logic, `gates.ts`'s spawn path and `plan-state.ts`'s spawn, calling `@oso-code/core` instead. Its bundle `opencode/dist/oso-code.js` inlines the core.
- C2-D7: the Stop push on Claude is measured on the pinned client in S3: the adapter emits `shouldContinue: true` (documented) and the fixture asserts the client continued; if the pinned client only honours the older `decision: block`, the adapter emits both fields and the ledger records it as delegated with the measurement.

**Proposed slices** (gate groups are cut by shared code, not by host).
- S1 EXPAND (opus) — lexer + the four PreToolUse deniers (`commit`, `edits`, `unknown`, `proddeploy`) with their fixtures, parity green against bash. Depends-on: none (C1 closed).
- S2 EXPAND — the SessionStart/SessionEnd group (`stale`, `version`, `reanchor`, `statebin`, `teardown`) with fixtures. Depends-on: none.
- S3 EXPAND (opus) — `autocontinue` with C2-D3, `planstop`, `planprompt`, `handoff`; the Stop contract measured (C2-D7); fixtures include the hanko reproduction (state `auto_wait=18`, mark 9 min old → push after the fix). Depends-on: none.
- S4 MIGRATE — `hooks.json` rendered for Claude (exec form) and Codex from `routes.ts`; `plugin/dist/gate.js` committed; the installed-copy smoke: a fixture HOME with the plugin, `claude --version` present, one PreToolUse envelope through the real `hooks.json` command line on ubuntu and windows. Depends-on: S1, S2, S3.
- S5 MIGRATE — the OpenCode plugin on the core (C2-D6), `opencode/dist/oso-code.js` committed, `cd opencode && npm test` green with the duplicated modules gone. Depends-on: S1, S2, S3.
- S6 CONTRACT — delete `plugin/hooks/*.sh`, `plugin/hooks/lib.sh`, `plugin/hooks/lexer.sh`, `tools/hook-gates.txt`, `tools/render-hooks-json.sh`, and every gate case of `tests/hooks-test.sh`; G14 grep; the hook cold-start test (G4) added. Depends-on: S4, S5.
- Exit: one gate implementation; `npm test` ≤ 45 s; hooks-test.sh now holds only installer cases; `pr.yml` green on windows with no Git Bash step.

### C3 — `rewrite-installer`: one `oso` CLI for install, verify, repair and purge on every host

**Intent.** Replace `bootstrap/install*.sh`, `verify*.sh`, `purge*.sh`, `repair*.sh`, `bootstrap/lib/*` and `install.ps1`'s body with `core/src/install/*` behind `node bootstrap/oso.js <install|verify|repair|purge> --host <claude|codex|opencode> [--yes] [--ci]`, tested in-process against a fixture HOME, and delete `tests/hooks-test.sh`.

**Decisions.**
- C3-D1: host adapters own their config surface: Claude — `settings.json` hooks/permissions region, `CLAUDE.md` global source, the marketplace registration, MCP entries (engram, context7, fallow), Impeccable mount; Codex — the managed TOML region of `config.toml` (`smol-toml` parse → edit → stringify, preserving the unmanaged part byte for byte, which is what `toml-regions.awk` guarantees today and the tests must keep asserting), agents, skills, hooks copy, trust hashes; OpenCode — `opencode.json` managed keys (merge, never overwrite), plugin copy, skills, agents. The backup, transaction and rollback semantics of today's installers are kept as one shared module.
- C3-D2: `verify` produces the same report shape (`ok:`/`FAIL:` lines, `passed: N, failed: M`) so nightly's pinned check-name sets keep working; `--ci` and the `OSO_VERIFY_SKIP_*` switches survive as flags.
- C3-D3: `bootstrap/install.sh` and `install.ps1` become ≤ 40-line wrappers: find node ≥ 22 (winget/brew/pacman/apt provisioning stays in the wrapper where a package manager is the only way), then exec `node bootstrap/oso.js`. `verify.bat` execs the same.
- C3-D4: installer tests create a fixture HOME per test, run the adapter in-process, and assert through the parsers; `npm test` may not touch the real HOME (G4). Real installs run in `nightly.yml` on the three OSes.
- C3-D5: `tests/hooks-test.sh` is deleted by the last CONTRACT slice; every remaining case is either a fixture-HOME test in `core/test/install/` or a nightly certification step, and the slice's diff lists each case with its destination.

**Proposed slices.** S1 EXPAND shared modules (backup/transaction, toml, json, trust, report) + `oso verify` for Claude; S2 EXPAND Claude install/repair/purge; S3 EXPAND Codex (TOML region parity fixtures from the awk cases); S4 EXPAND OpenCode; S5 MIGRATE wrappers + nightly real installs; S6 CONTRACT delete bootstrap bodies, `bootstrap/lib/*` and `tests/hooks-test.sh`; the two bash bars (`tests/opencode-behavior-bar.sh`, `tests/opencode-contract-bar.sh`) are NOT touched here — C4 ports and then deletes them. Depends-on chain S1 → S2/S3/S4 (parallel) → S5 → S6.
- Exit: `bootstrap/` ≤ 400 lines of shell/ps1; `core/src/install` ≤ 2,500 lines; nightly real installs green on ubuntu, macos, windows for Claude and Codex, and ubuntu + windows for OpenCode (Windows OpenCode leaves "UNVERIFIED" here).

### C4 — `rewrite-certification`: host certification as a nightly lane in TypeScript

**Intent.** Port `tests/opencode-contract-bar.sh` and `tests/opencode-behavior-bar.sh` (and the Codex smoke parts of `verify-codex.sh`) to `core/test/certify/*.test.ts`, run only under `OSO_CERTIFY=1` with the pinned binaries, reporting per gate what was measured; `docs/parity-*.md` shrink to the divergence tables those runs fill in.

**Decisions.** C4-D1: a certification test that cannot drive its gate reports `not-run` as a result, never `pass` — the `exit 3` tolerance of today's CI is replaced by a report line the nightly summary shows. C4-D2: the pinned host versions live in one file, `core/src/install/pins.ts`, read by installers, certification and the parity docs check.

**Proposed slices.** S1 (opus) contract + behaviour bars as tests; S2 nightly wiring + parity doc tables; S3 CONTRACT delete the two bash bars. Exit: nightly green with every gate row `measured` on the pinned OpenCode and Codex.

### C5 — `rewrite-prose`: skills, agents and records in the shape the models read best

**Intent.** Reshape the instruction layer per G10 without changing what any flow decides or asks: one SKILL.md per skill, host references one level deep, agents from one source, the eleven contradictions and dead references closed, the standing-rule text cut to what a gate does not already enforce, README and blueprint rewritten as maps.

**Decisions.**
- C5-D1: `plugin/skills/<skill>/SKILL.md` carries the flow (today's `_shared/bodies/<skill>.md`, rewritten: ≤ 300 lines, no sentence over 60 words, no exception-of-an-exception — a rule is stated once with its one escape hatch); `plugin/skills/<skill>/references/<host>.md` carries only what that host spells differently; `_shared/rubric.md`, `reporting.md`, `front-surface.md`, `didactic.md` stay shared and are cut to their operative content. Codex and OpenCode wrappers are rendered by `npm run build` from a six-field stub.
- C5-D2: the closed defects: `plan.md:19` uses `oso-state deny-pattern add`; `slice B14`, `trap 5`, the ADR-0097 cap, "your Codex role's payload" in host-neutral bodies, the AUTO-marker "alone vs same write" contradiction, `/oso-code:plan` vs `oso-code:plan` spellings, `reporting.md:28` missing OpenCode, the default-branch discovery contradiction between debt-sweep and security-pass, `didactic.md` scope vs debug, and the 3-question vs 1-question round for quick — each fixed in one place and covered by a structural test where a test can read it (spelling and reference checks), by the verifier's read otherwise (`Verify-exception` stated).
- C5-D3: the unattended-run material (AUTO, park, ceiling, wait) becomes `_shared/unattended.md`, read by plan and roadmap; the parallel wave loop becomes `references/parallel.md`, read only when PARALLEL was chosen.
- C5-D4: the orchestrator preamble bound (G4, ≤ 6,000 words for `/plan` on Claude) is asserted by a structural test that sums the words of the files a wrapper binds.

**Proposed slices.** S1 shared references + agents from one source (rendered) + wrappers rendered; S2 plan + roadmap + unattended + parallel; S3 quick + debug; S4 judges (debt-sweep, quality-pass, security-pass, doubt-pass, triage) + rubric/reporting/front-surface cuts; S5 README, blueprint, CHANGELOG, the twelve structural checks ported to `core/test/structure/` and `tests/plugin-lint.sh` deleted. Parallel S2/S3/S4 after S1.
- Exit: preamble test green; zero platform files under `_shared/platform/`; every verdict token still spelled identically at every call site (the verdict-grammar test).

### C6 — `rewrite-release`: 0.26.0 prepared, installed here, certified

**Intent.** Bump the version, write the CHANGELOG entry, regenerate hashes and bundles, install the tree on the operator's machine with the new installer for the three hosts, run the certification, and stop at the tag: the release itself is on the never-solo list.

**Slices.** S1 version bump + CHANGELOG + `npm run build` + `npm run check`; S2 local install of all three hosts via the new CLI, `oso verify` green on each; S3 `OSO_CERTIFY=1` run green. Exit: the roadmap parks with the tag and the marketplace publish as the operator's two pendings.

## 4. Autonomy policy for this roadmap

The roadmap mode's three tiers, its irreversibility bar and its never-solo list apply unchanged. Specific to this roadmap:

- Deleting a bash file, a test, a lint rule or a workflow is REVERSIBLE (git) and is decided here, so it never reaches the bar; the CONTRACT slices carry those deletions under G14.
- Choosing a library version, a bundle flag, a test file name or a fixture layout is the flow's own recommendation tier; no such choice reaches the operator.
- Any finding that a documented host contract differs from what the pinned binary does is a RECONCILIATION: record what was measured, emit what works, and queue the divergence for the presence phase with the evidence. It never blocks a child.
- A verifier that fails a slice on PROSE it was not asked to judge is outside its remit (G12): the orchestrator routes the finding to the sweep and does not re-run the applier for it.
- The two pendings of C6 (tag, publish) are the operator's.

## 5. Host compatibility after the rewrite

| | Claude Code | Codex CLI | OpenCode |
|---|---|---|---|
| Delivery | marketplace plugin, root `plugin/` | `~/.codex/` managed region + hooks dir + `~/.codex/skills` | `~/.config/opencode/plugin/oso-code.js`, `opencode.json` keys, `skill/` |
| Gate transport | `node` exec-form hooks, bundle under `plugin/dist` | `node` shell-form hooks, bundle copied by the installer, hashed | in-process import of the core |
| State | `node plugin/dist/oso-state.js` | same bundle | library call |
| Windows | node.exe; no Git Bash for the harness (the client's own Bash tool still needs it) | as documented by the host; installer via `node` | verified by nightly from C3 |
| Skills | SKILL.md + `references/claude.md` | rendered wrapper + `references/codex.md` | rendered wrapper + `references/opencode.md` |
| Agents | rendered `plugin/agents/*.md` | rendered `codex/agents/*.toml` | rendered `opencode/agents/*.md` |
| Certification | nightly `claude plugin validate`, real install | nightly real install + hooks smoke on the pinned binary | nightly contract + behaviour bars on the pinned binary |

## 6. What stays exactly as it is (so nobody "improves" it)

1. The flows' phases, gates, verdict vocabularies and report shapes.
2. The state keys, their values, the file path and its `key=value` format; `oso-state`'s verbs and texts.
3. What each gate denies and the message it prints (the parity fixtures are the proof).
4. `events.jsonl` and the run journal formats.
5. The engram topic keys and the index standard.
6. The three hosts and the gate-per-host table (only the transport column changes).
7. `docs/decisions/` as history.

## 7. The parity harness (the safety net of C1–C3)

A fixture is a JSON file: `{ "name", "env": {…}, "home": { "<relative path>": "<content>" }, "cwd": "<fixture repo or none>", "argv": […], "stdin": "…", "expect": { "exit": n, "stdout": "…", "stderr": "…", "home_after": { … }, "events": [ … ] } }`. `core/test/parity.test.ts` materialises `home` into a temp directory, runs the subject with `HOME` and `XDG_*` pinned there, and compares. While bash and TS coexist the subject is BOTH and both must pass; after the CONTRACT slice the subject is the bundle alone and the fixtures stay as regression tests. Fixtures are written from the suite's assertions by reading them (C1-D2); a fixture whose expectation was recorded from a run is rejected in review as tautological, per the verifier's own quality gate.

## 8. Risks and their treatment

| Risk | Treatment |
|---|---|
| Codex hook exec form or `if` unsupported | Codex stays on shell form with a plain `node` command (G5); measured in C2-S4's smoke on the pinned Codex |
| The pinned Claude client honours a different Stop field | C2-D7: measured, both fields emitted if needed, recorded as delegated |
| TypeScript 7 compiler rejects something | G3 fallback to latest 5.x, recorded |
| Node version drift on operator machines | `engines.node >= 22` in every package.json; the wrappers refuse older nodes with the install command |
| A parity fixture encodes a bash bug as expected behaviour | the fixture's expectation is read from the suite's assertion text, and a verifier flags any fixture whose expected value cannot be traced to an assertion |
| Windows exec form path quoting | `${CLAUDE_PLUGIN_ROOT}` inside `args`, never a shell string; nightly runs the real hooks.json on windows-latest |
| Scope creep into flow semantics | §6 list; the debt-sweep's conformance axis judges against this document's decisions |
| The live run `opencode-plan-execution` (branch `oso-run/opencode-runtime-parity`, slice 3 of 11) | precondition in §9 |

## 9. Preconditions before C0 is armed

The run `opencode-plan-execution` is PARKED (`auto=parked`, state `mode=plan active_slice=none verify_green=false`) with slice 3 pending in the tree across ten paths, unverified on prose only: the code criteria passed, the verifier failed the same prose-claim class twice, and the fix-round cap of two (G12) says stop. It is not finished and not resumed. What lands from it, and how:

1. **Commit slice 3's tree as it stands, from the operator's own terminal** (the git pre-commit hook allows a commit with no session id; the harness's commit rail is per session): `git add -A && git commit -m "chore(opencode): park slice 3 — /oso-plan routes to build, prose claims unverified"`. Nothing is edited first; the commit message is the record that the prose is unverified.
2. **Merge PR #2 to `main` as it is** — `bea25f6` (the OpenCode host), `1f916cd` (the pin, measured), `2adebe0` (the host fact, measured) and the parked commit. The rewrite needs all four on `main`: C2-D6 keeps the OpenCode plugin's host-specific parts, C4 ports the permanent behaviour test and reads the pin, C5 rewrites every prose file the parked slice touched. CI is red on that PR for the same machine-dependent reasons C0 removes from the gate; the merge is the operator's.
3. **Drop the parked state**: `oso-state --session d67e0dc2-2c93-4775-abb8-9cd7106824cc clear` (the command the SessionStart notice offers), so C0 arms on a clean state. The run journal and the engram topics stay as the record.
4. `git switch main && git pull && git status --porcelain` is empty; `opencode --version` is whatever it is — C0-S2 makes the suite stop caring.
5. The operator runs `/oso-code:roadmap ts-core-rewrite` and points §1 at this file; the queue, the global ledger and each child's decisions are read from here; G15 and §11 are the inheritance.
6. Model policy G13 is stated in the arming instruction.

## 11. Inherited defects and decisions — where each lands, and what proves it

From the parked run's ledger (`oso/opencode-plan-execution/ledger`) and plan (`/plan`). "Proof" is the automated check the receiving child's slice must add; a row marked prose is verified by the verifier's read with a `Verify-exception`.

| Origin | What it is | Lands in | Proof |
|---|---|---|---|
| Bug 1 / D2, slice 3 | `/oso-plan` routes to `build`; `opencode/agents/oso-plan.md` deleted; roster 7, all `mode: subagent` | on `main` via §9 step 2; C5-S1 renders the OpenCode wrapper stub with `agent: build` | C4-S1: the capability assertion reads BOTH sides from the real binary (`opencode debug agent <route>`) — the routed agent admits `oso-state` and `git commit` |
| Bug 1 / D9(2), slice 10 | the behaviour bar runs a full plan cycle (grant, arm, edit, green, commit) entering through `/oso-plan` | C4-S1 | the certification test goes red with the route reverted in the fixture |
| Bug 2 / D5, slices 2 and 8 | milestones ride the stream where the host keeps text before a same-turn tool call; measured: all three hosts keep it in the TRANSCRIPT | C5-S2 (`_shared/reporting.md` states one rule; each `references/<host>.md` states only a measured divergence) | C4 ports the permanent host-fact test of slice 2. The RENDERING half is MEASURED: on 2026-08-25 the operator observed, on Claude Code 2.1.241 (Claude Code), a marker line written before a same-turn Bash call rendered above the tool block (screenshot in the session). So C5 states ONE rule for the three hosts — a milestone rides the stream and never ends the turn; only content that needs an answer ends it — and deletes the Claude "anti-swallow" clauses in `platform/claude/*.md`, `output-styles/oso.md` and `bootstrap/claude-global.md`, recording the client version the measurement was taken on |
| Bug 3 / D7, slice 6 | `runStateCommand` refuses an empty owner with a named error; the `event` dispatcher runs no run-dependent rail in a non-git cwd, without per-session caching | C2-S5 | two node tests, one per layer (empty owner → named error; idle in a non-git cwd → zero output) |
| Bug 3 / D8, slice 7 | plugin-load traces quiet outside a repo; severity floor over log and toast sinks; `showToast` signature pinned against the binary; `plan-state` reports its full argv | C2-S5 | a test loading the plugin in a non-git cwd asserting zero output on all sinks; the floor asserted; the signature assertion |
| D13, slice 4 | the edits gate denies only inside the repository whose state armed it (today an armed `mode=plan` denies edits anywhere on the machine) | C2-S1 | a gate fixture: armed state in repo A, an edit under repo B → allow; under A with no slice → deny |
| D3(b), slice 4 | the edits gate also denies SHELL writes (`bash -c 'cat > f'`) inside the repo while no slice is armed, through the lexer | C2-S1 | fixtures for the write shapes the lexer names; the declared porosity (pinned holes) is recorded, not fixed |
| D4, slice 4 | teardown clears `mode=plan` without `plan_approval=approved`, and a closed change's `mode=plan active_slice=none` leftover; never an approved plan in flight | C2-S2 | three teardown fixtures, one per shape |
| D3(a), slice 5 | the flow arms `mode=plan active_slice=none verify_green=false` at the start of phase 1 on every host | C1-S3 adds `transitions.armPlan`; C5-S2 puts the call in the SKILL.md | transitions test; prose |
| D6, slice 9 | the journal is unconditional; `auto_change` means "which run is running", written at every mode's start and cleared at its close, so no run inherits a journal | C1-S3 (`armRun`/`closeRun` in `transitions.ts`) ; C5-S2/S3 call them | a fixture: two consecutive runs of different modes in one repo write two files; the second inherits nothing |
| Ambient, plan record | the `.waiting` sidecar compares only label and session, so a second delegation under one label inherits the first's clock | C2-S3 (with defects 1–3 of G7/C2-D3) | fixture: two delegations under one label → two clocks |
| Ambient, plan record | `tests/hooks-test.sh` exports `OPENCODE_IMPECCABLE_SOURCE` while the installer forwards `OSO_IMPECCABLE_SOURCE`, so a fixture install clones Impeccable from GitHub — ~44 cascading failures without network | C0-S2 | the suite runs green with the network off |
| Ambient, plan record | the host binary self-updates (1.18.22 → 1.18.23 twice on 2026-08-25) and every pin check goes red | C0-S2 (the pin check reads the fixture), C4-D2 (pins in one file, certification reads the pinned download, never the machine's binary) | suite green with any installed version |
| Ambient, plan record | `bootstrap/verify-codex.sh` is ambient red (Codex 0.149.1 vs 0.146.0 pin, plugin absent, stale bytes) | C0-S1 (nightly), C3/C4 | nightly report, never the PR gate |
| Ambient, plan record | `copy_lint_fixture` needs ~1.2 GB of TMPDIR | gone with `tests/hooks-test.sh` (C3-S6) | — |
| D10, D11, slice 11 | linter rule 42 generalised; reconciliation table; new ADRs | moot: C0-D3 deletes the prose rules, G11 freezes ADRs, C5 rewrites `docs/parity-opencode.md` as divergence tables | — |
| Named pending | real-project validation: reinstall and run `/oso-plan` through to a committed slice | C6-S2/S3 on this machine; the real project is the operator's | certification green + the operator's run |
| Named pending | the operator's `opencode` sits at whatever version it self-updated to | no action: C0-S2 and C4-D2 make the version irrelevant to the suite | — |

## 10. Glossary of the numbers a verifier reads

- "Green" for `npm test`: exit 0, ≥ 1 test executed, zero skipped tests without an `OSO_NIGHTLY`/`OSO_CERTIFY` guard.
- "Cold start ≤ 100 ms": mean of 20 sequential spawns of `node plugin/dist/gate.js commit` with a 300-byte envelope on stdin, measured by `core/test/perf/coldstart.test.ts`, on the PR runner and locally.
- "Preamble ≤ 6,000 words": `wc -w` over the wrapper plus every file it binds for the `plan` skill on Claude, computed by `core/test/structure/preamble.test.ts`.
- "Lines": `wc -l` over tracked files under the named directory.
