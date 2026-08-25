# opencode-parity — execution plan

Third-host port of the oso-code harness to OpenCode CLI. Plan artifact for the
`feature/opencode-parity` branch. Execution happens in a fresh session; this
file is the single source the orchestrator follows.

- **Base**: `main` @ `2c9b021` (v0.25.0)
- **Branch**: `feature/opencode-parity`
- **Created**: 2026-08-18
- **Position**: READY — approved and frozen 2026-08-06 (engram `oso/opencode-parity/ledger` #2913, `oso/opencode-parity/plan` #2914). NOT STARTED. The Codex deferral that held it (21 unpushed commits on main) closed with v0.25.0 (`2c9b021`, pushed 2026-08-15).
- **Execution mode**: SEQUENTIAL (P1 — see amendments). The frozen plan said PARALLEL cap 4; the orchestrator host (opencode) does not yet have the `oso_wave` machinery, this plan is what builds it, and the wave dependency graph already orders the slices — so sequential is the faithful, safe reading. Waves remain as planning units: verify every slice of a wave before starting the next.
- **Delegation policy**: EVERY subagent launch uses `subagent_type: "general"` with an explicit `model: "opencode/deepseek-v4-flash-free"` in the task payload. Never sonnet/opus overrides, never another agent type (P2).
- **Per-slice commits**: ON, onto `feature/opencode-parity`.
- **CHANGE BASE**: resolved when slice 1 arms — the commit `main` points at that moment, written into this plan by amendment (ADR-0118 coordinates).

## 0. Superseded after this plan closed

This file is a CLOSED record of the `opencode-parity` execution. Nothing below is
rewritten: each slice states what that execution actually delivered, and that is
the only thing a closed plan is good for. Three of its entries were falsified by
the `opencode-runtime-parity` change that followed, so a reader acting on them
would be acting on a tree that has moved.

- **D23 and S11 — the workspace adapter's `create`.** The frozen decision made
  `create` the adapter's own awaited `git worktree add -b <branch> <path> <WAVE
  START>`, and S11 delivered `worktreeRoot`, `createWorkspace`, `UNSAFE_REF` and
  `UNSAFE_PATH` in `opencode/plugin/oso/workspace.ts` to that shape. Commit
  `1ebb29a` deleted all four, and the tests behind them. What that file exports
  now is the registration seam and nothing that cuts a worktree —
  `WorkspaceAdapterInput`, `WORKSPACE_ADAPTER_TYPE`, `registerWorkspaceAdapter`
  and `OSO_WORKSPACE_ADAPTER`: the adapter registers for discovery only and its
  `configure` refuses by name.
  Nothing in the plugin package runs `git worktree add` any more. A wave's
  worktree is cut by the ORCHESTRATOR before any child session exists —
  `plugin/skills/_shared/bodies/plan.md:219` — and `oso_wave` pins a tree that
  already exists. `docs/parity-opencode.md`'s workspace-adapter row and its
  degradation ledger carry the current shape.
- **S11's Verify line is no longer satisfiable.** It asks for "a test that the
  worktree exists, is populated and is on the requested branch when create
  returns", and there is no `create` to return. It was satisfied when it was
  written and nothing replaced it in kind, because the function it verified is
  gone rather than moved. The property behind it — a child writes only inside
  its own worktree — is proven end to end instead, by the wave smoke in
  `bootstrap/verify-opencode.sh:633-642`, over worktrees that script cuts itself
  at `:498-501`.
- **S12's delivery paragraph names `createWorkspace`.** Its worktree-pinning
  test built real worktrees through that helper; `opencode/plugin/oso/wave.test.ts:51`
  defines its own `addWorktree` fixture and builds them with that now. S12's own
  Verify line — two concurrent children returning distinct verdicts, each writing
  inside its own worktree — still holds and is still tested.

## 1. Intent

Port the oso-code harness — today a Claude Code plugin and a Codex CLI plugin
sharing neutral behavioral bodies — so it also runs under OpenCode CLI as a
third first-class host, with all three modes (/plan, /quick, /debug), the five
auxiliary skills, three writing agents, four forked judges, the runtime gates,
the delegation rail, parallel wave execution, installation and verification.

Visible outcome: the operator opens OpenCode in any repo, types the opencode
spelling of the plan mode, and the same flow runs that runs today in Claude
Code — phases 1-5, ledger frozen in engram, approval, then slices delegated
with the commit gate denying `git commit` until the verifier returns pass.

## 2. Scope

**In**: 8 skill wrappers + an OpenCode platform overlay; 7 agent contracts; a
TypeScript plugin carrying the gates; state bootstrapping; the plan-approval
rail; `bootstrap/install-opencode.sh`; a purge script for the gentle-ai/SDD
harness installed in the operator's OpenCode; `bootstrap/verify-opencode.sh`;
`docs/parity-opencode.md`; extension of the verification bar (lint, tests, CI)
to three hosts; ADRs.

**Out**: rewriting flow logic; changing Claude/Codex trees beyond generalizing
to three hosts; a fourth harness.

## 3. Host surface — verified evidence (from installed OpenCode bytes, v1.15.13 and v1.18.14)

Full source: engram #2913 surface map. Condensed traps the slices must respect:

1. **GATE RAIL**: no subprocess hooks. The only block is throwing inside
   `tool.execute.before` `(input: {tool, sessionID, callID}, output: {args}) => Promise<void>`.
   The bash gates keep running UNCHANGED via a TS shim that writes the JSON
   envelope to their stdin and translates all three exits (D1): deny JSON →
   throw; empty stdout → allow; exit 2 + stderr → block.
2. **IDENTITY**: state keyed by repo (sha256 of absolute `--git-common-dir`).
   `lib.sh` is `${OSO_AGENT:-$(json_field payload session_id)}` — env wins.
   `shell.env` fires PER SHELL INVOCATION and its values override process.env (D13).
3. **LIFECYCLE**: no SessionStart, no SessionEnd. Available:
   `experimental.chat.system.transform`, `chat.message`, `session.idle` (every
   turn), `dispose()`. Teardown = liveness-guarded sweep at plugin start and on
   `dispose()` (D19). The `event` hook IS filtered by `location.directory` —
   it never fires for child worktrees (verified trap 3).
4. **SKILLS/APPROVAL**: only `name`+`description` parsed; every skill
   auto-registers as a slash command; `permission.skill: deny` hides it from
   the model while keeping the slash command. No `context: fork`. No
   ExitPlanMode/Stop/UserPromptSubmit. Native `plan_exit` tool behind
   env-only `OPENCODE_EXPERIMENTAL_PLAN_MODE` renders a modal; on Yes the TUI
   writes a synthetic `agent: "build"` user turn. THE TUI FLIPS THE ACTIVE
   AGENT ON ANY COMPLETED TOOL PART WHOSE ID IS THE LITERAL `plan_exit`,
   keyed on `status === "completed"`, never on the result value — so decline
   must THROW (D3). OpenCode injects its own plan-mode reminder whenever the
   active agent is literally named `plan` — the phase agent is therefore
   named `oso-plan` (D3).
5. **DELEGATION/WAVES**: `task` is synchronous, no cwd/directory/workspace
   param. No SubagentStop. Workspaces API `POST /experimental/workspace
   {type: "worktree", branch}` (NO start-commit param) creates the worktree
   at `~/.local/share/opencode/worktree/<projectID>/<name>`; our own adapter
   runs `git worktree add -b <branch> <path> <WAVE START>` (D23). `POST
   /session/:id/message` blocks until the turn completes and returns
   `{info, parts}` — the verdict is in-band (D5). Verified traps: (1)
   `createFromInfo` FORKS the checkout (worktree EMPTY when create resolves);
   (2) the plugin `client` is v1 SDK with no `.experimental` — raw fetch
   against `PluginInput.serverUrl`; (4) published `.d.ts` lags binaries.
6. **DENY VISIBILITY**: TUI shows a tool error as red click-to-expand row; a
   message containing `rejected permission` / `specified a rule` /
   `QuestionRejectedError` / `user dismissed` is classified denied →
   strikethrough → never expandable. D8: deny delivered twice — throw carries
   the full remedy, `client.tui.showToast` one actionable sentence, and the
   message contains none of those strings.
7. **DISTRIBUTION**: no marketplace, no hot reload. `opencode.json` is JSON
   only — unknown top-level key is a HARD error; no marker region. Installer
   owns it wholesale and re-applies operator `provider`, `model`/`small_model`,
   `permission`, `mcp` from backup (D6). MCP env key is `environment`, not
   `env`. Plugin discovery glob is `{plugin,plugins}/*.{ts,js}` — one
   asterisk, single entry `plugin/oso-code.ts` importing `plugin/oso/*.ts` (D20).

## 4. Frozen decisions (D1–D26, condensed — full text in engram #2913)

| # | Decision |
|---|---|
| D1 | Gates are a TS shim spawning the existing bash gate scripts unchanged; all three exits translated. |
| D2 | Parallel waves BUILT on the workspaces API, not deferred. |
| D3 | Phases 1-5 on own primary agent `oso-plan` (`edit: deny`, pattern-scoped bash); `plan_exit` plugin tool with full digest rail (`capture-plan` before modal, `approve-plan` on Yes, ownership + content-parity checks); decline THROWS; session-scoped permission rules are the kill switch while pending. |
| D4 | gentle-ai purge = full wipe of `~/.config/opencode` by its own script, never by the installer, behind verified backup + written restore. |
| D5 | `oso_wave` THIN: worktrees, child sessions pinned, readiness barrier, verdicts in-band. Handoff receipt rail NOT used on this host. |
| D6 | Installer owns `opencode.json` wholesale from template; operator `provider`/`model`/`small_model`/`permission`/`mcp` re-applied from backup; `permission` merges per sub-key (installer owns `skill`+`task`, restored block owns `bash`+`read`). Files for skills/agents/commands/plugins. |
| D7 | CHANGE BASE set when slice 1 arms; WAVE START / SLICE START per ADR-0118. Bar below. |
| D8 | Deny delivered twice: throw (full remedy) + `client.tui.showToast` (one sentence); banned deny strings avoided. |
| D9 | Third host row in `tools/hook-gates.txt`; `render-hooks-json.sh` gains a TS route-table emitter. |
| D10 | Seven agents: 3 operational (applier/verifier/integrator, full contracts) + 4 thin judge adapters (doubt-pass, debt-sweep, triage, security-reviewer) taking SKILL PATH + ARGUMENTS. Surface exploration uses native `explore`. |
| D11 | Eight wrappers in `~/.config/opencode/skill/` prefixed `oso-*`; `_shared/` copied beside; three operator-only modes carry `permission.skill: deny`. |
| D12 | OpenCode updated first, all claims re-verified against that build, deltas recorded, version pinned exactly by installer; mismatch DEGRADES `unverified:<version>`. |
| D13 | Identity = ROOT session id published per shell invocation via `shell.env`; lineage map root→child; `OSO_AGENT` never exported into the server process itself. |
| D14 | Purge removes `~/.config/opencode` entirely, offers removal of `~/.gentle-ai/` + `~/.local/bin/gentle-ai`, reports the three project-level `opencode.json` untouched. |
| D15 | Impeccable PINNED acquisition without Codex: `git clone --depth 1 --branch skill-v$SUPPORTED_IMPECCABLE_VERSION`, then existing `mount-impeccable.sh` with `version:` verification; shared-mount registry keeps `owner.*` convention. MCP declared with `environment`. |
| D16 | `verify-opencode.sh` includes a real wave-runner smoke (scratch repo, two worktree workspaces, two children, per-worktree write proof + verdict via prompt result). Skips when no model. |
| D17 | CI: one ubuntu step running `verify-opencode.sh` with measured pinned failure count; both `bash -n` lists extended. Windows untouched. |
| D18 | Lint rule 18 table-driven over N-host marker table; every host-literal enumeration generalized; new rule 21 (version agreement); rule 15 counts updated. |
| D19 | Stale-state advice via `experimental.chat.system.transform` on first turn; teardown = liveness-guarded sweep (pid+link) at start + `dispose()`, never reaping a live owner. |
| D20 | Source tree = sibling top-level `opencode/` mirroring `codex/`; installed plugin layout single discovered entry `plugin/oso-code.ts` + `plugin/oso/*.ts` modules. |
| D21 | `bootstrap/opencode-global.md` carries the Voice block (no output-style concept), installed as `~/.config/opencode/AGENTS.md`; lint rule 7 third arm. |
| D22 | TS bar: `opencode/` gets its own `package.json`; `tsc --noEmit` + Bun tests enter D7's bar and CI; tests cover 3-exit translation, envelope composition, argument mapping (`filePath`→`file_path`), deny composition. |
| D23 | Own workspace adapter via `experimental_workspace.register`; `create` runs `git worktree add -b <branch> <path> <WAVE START>`; awaited create kills the forked-checkout trap. **Superseded — see §0: `create` is gone and the orchestrator cuts the worktree.** |
| D24 | Execution on stock `build` agent. Enforcement = state gates keyed by repo+session (survive the flip) + session-scoped permission rule. Operator's own `build` never overridden. |
| D25 | Engram wired by its own installer, mirroring `engram setup codex`; fallback preserves operator's `engram.ts` from backup as a file. Verify Engram's OpenCode support before writing the branch. |
| D26 | Full unknown-tool catch-all deny while armed — same as Codex. |

## 5. Amendments for this execution (P-series)

- **P1** — Execution mode is SEQUENTIAL (frozen "PARALLEL cap 4" deferred until
  `oso_wave` exists downstream of this very plan; dependency graph already
  orders waves). Waves retained as planning units.
- **P2** — Delegation policy: every subagent launch = `general` +
  `opencode/deepseek-v4-flash-free`, stated explicitly in the task payload.
  Per the operator's instruction (2026-08-18). Supersedes any model note in
  the frozen plan for THIS execution only; harness agent files keep their
  declared models.
- **P3** — Plan artifact: this file. Slices commit onto `feature/opencode-parity`.
- **P4** — Orchestrator: one opencode session. Engram records in topics
  `oso/opencode-parity/ledger` and `oso/opencode-parity/plan` stay authoritative
  alongside this file; updates here reflect there.
- **P5** — CHANGE BASE per D7/ADR-0118: commit main points at when S1 arms.

## 6. Slices — 16 in 8 waves

### Wave 1

- [x] **S1 — Host baseline and contract verification.** DONE 2026-08-18 (commit pending at 8b06f39 base; CHANGE BASE confirmed: `main` @ `2c9b021`). ADR-0151 pins 1.18.18 and records F7 = PASS with live-probe evidence.
  Update OpenCode to the target build, re-verify EVERY host-contract claim
  against THAT binary, and PROVE **F7**: does `tool.execute.before` fire for
  worktree-pinned child sessions. Record deltas and the pin.
  Files: `docs/decisions/` (baseline ADR), `bootstrap/install-opencode.sh`
  (pin constant), `docs/parity-opencode.md` (skeleton), `tests/hooks-test.sh`.
  Verify: a section asserting the declared version constant matches what a
  probe of the installed binary reports; the F7 finding recorded with evidence.
  Depends-on: nothing. NOTE: a negative F7 redesigns the wave runner here,
  not later.

### Wave 2 (width 4)

- [x] **S2 — Third host in the gate table + TypeScript route emitter.** DONE 2026-08-18 (e71bd6f). 75 opencode cells, 13 new tool rows, renderer loosened to 3 hosts, `render_routes()` emitter, refusal by name proven.
  Files: `tools/hook-gates.txt` (70 new cells), `tools/render-hooks-json.sh`
  (loosen the three hard 2-host assertions, add the emitter),
  `opencode/hooks/routes.ts`, `tests/hooks-test.sh`.
  Verify: `--check` covers three hosts; a `tool` row missing an opencode cell
  is refused by name. Depends-on: S1.
- [x] **S3 — Platform overlay, eight wrappers, global.** DONE 2026-08-18. 10 overlays, 8 wrappers, global; ADR-0152 proves `permission.skill` deny hides skills; headless `--command` unusable (recorded).
  Files: `plugin/skills/_shared/platform/opencode/*.md` (~10),
  `opencode/skills/*/SKILL.md` (8), `bootstrap/opencode-global.md`.
  Verify: each wrapper resolves its two paths; the global routes all three
  operator-only modes in this host's exact spelling. Depends-on: S1.
- [x] **S4 — The seven agents.** DONE 2026-08-18. 7 opencode/agents/*.md; verifier PASS: body tokens byte-exact, `hidden: true` cosmetic, tools→permission per docs.
  Files: `opencode/agents/*.md` (7).
  Verify: each judge names SKILL PATH and ARGUMENTS; each agent declares its
  verdict vocabulary. Depends-on: S1.
- [x] **S5 — Purge script.** DONE 2026-08-18. `purge-opencode.sh` (backup verificado con manifest sha256, wipe de config/state/cache/bin, keep-gentle-ai, restore mismo-home con rollback, guard XDG no-default fail-closed), `docs/opencode-purge-and-restore.md`, suite +17 casos purge (1577 passed / 0 failed). Cierres de verifier inline re-verificados: guard XDG como usage_error (exit 2), 3 fixtures XDG-override, restore keep-gentle en el mismo home (patrón purge-codex).
  Files: `bootstrap/purge-opencode.sh`, `docs/opencode-purge-and-restore.md`,
  `tests/hooks-test.sh`.
  Verify: a section proving the wipe, the restore from backup, and that the
  three project-level opencode.json files are left intact and reported.
  Depends-on: S1.

### Wave 3

- [x] **S6 — Plugin skeleton, TypeScript bar, gate shim.** DONE 2026-08-18. `opencode/` con package.json (typescript devDep) + tsconfig strict NodeNext; entry `plugin/oso-code.ts` (named export, tool.execute.before real + stubs identity/lifecycle); shim `plugin/oso/gates.ts` (3-exit: deny JSON→throw, exit0→allow, exit2+stderr→block, otro→block fail-closed; envelope command/session_id/cwd/file_path←filePath; matcher regex; __OSO_HOOKS_DIR__ env→relativo; spawnSync); `verdict.ts` (status:/verdict: in-band); 32 tests node:test pass + tsc clean + lint clean + suite 1577. Desvío registrado: ejecución inline del orquestador (4 spawns applier vacíos — host de delegación roto esta sesión); barra de tests con node:test (node 26 type-stripping; bun ausente) — mismos archivos corren con bun cuando exista.
  Files: `opencode/package.json`, `opencode/tsconfig.json`,
  `opencode/plugin/oso-code.ts` (registration points stubbed so wave 4 slices
  do not collide), `opencode/plugin/oso/gates.ts`, `opencode/plugin/oso/*.test.ts`.
  Verify: Bun tests proving all three exit translations, the envelope
  composition and the `filePath`→`file_path` mapping; `tsc --noEmit` clean.
  Depends-on: S2.

### Wave 4 (width 5)

- [x] **S7 — Identity and lineage.** DONE 2026-08-18. Delegated (applier→verifier, host OK esta sesión). `shell.env` publishes the root session id; lineage map.
  `plugin/oso/identity.ts` — deriveRootId(cwd) = sha256 del git common dir (walk-up: .git dir = root; .git file `gitdir:` = worktree → resolve y strip `/worktrees/<name>`; 16 hex); roleOf root|child|none; child_id = sha256(worktree git dir); publishIdentity → {OSO_ROOT_SESSION_ID, OSO_SESSION_ID, OSO_ROLE, OSO_LINEAGE} con lineage JSON leído de `<common dir>/oso-lineage.json` (tolerante, read-only, nunca lanza). `oso-code.ts` shell.env real (merge a output.env, no-op on failure).
  Verify: childResolvesToRoot + lineagePub + preCommitArmsOnMarker (hook .git/hooks/pre-commit arma con el marker publicado real vía publishIdentity, ambos sentidos) + missing-lineage degradation + outside-repo none; 5 tests → 37/37 pass, tsc clean, lint clean, zero citation tokens.
  Files: `opencode/plugin/oso/identity.ts`, `opencode/plugin/oso/identity.test.ts`,
  `opencode/plugin/oso-code.ts` (shell.env stub → real).
  Verify: Bun test that a child resolves to its root, plus a section proving
  the git pre-commit arms on the published marker. Depends-on: S6.
- [x] **S8 — Lifecycle.** DONE 2026-08-18. Delegated (applier→verifier; verifier pass con 1 major pre-existente + 1 minor cerrados inline). Stale-state advice by injection, liveness marker, sweep at start and on `dispose()`.
  `plugin/oso/lifecycle.ts` — markers `oso-live-<sessionId>.json` en el common dir (tolerante); isLive = kill(pid,0) sin ESRCH (pid===process.pid live); sweepStale solo sobre markers muertos: `git worktree remove` + `git worktree prune` (nunca rm -rf — ADR-0088), marker dropeado solo tras teardown completo, fail-open → `left`; buildStaleAdvice + injectStaleAdviceOnce (una vez por sesión). Wiring: session.idle touch marker (sessionID presente, nunca lanza), transform inyecta advice, start + dispose corren sweep (dispose exportada named, return shape { hooks } intacto). identity.ts ganó `commonDirOf(cwd)` (thin export, sin duplicar el walk).
  Verify: sweepNeverTouchesLiveOwner (reaped [] + worktree vivo + marker presente), deadOwnerReaped, failedRemoveKeepsMarker, touchMarker, staleAdviceText, injectionOnce, corruptMarkerIgnored — 8 tests → 45/45; +fix flake EPIPE pre-existente de S6 en gates.ts (retry sin input cuando el gate no lee stdin) — 10/10 runs verdes.
  Files: `opencode/plugin/oso/lifecycle.ts`, `opencode/plugin/oso/lifecycle.test.ts`,
  `opencode/plugin/oso-code.ts` (session.idle/transform/start/dispose reales),
  `opencode/plugin/oso/identity.ts` (commonDirOf), `opencode/plugin/oso/gates.ts` (EPIPE retry), `opencode/plugin/oso/oso-code.test.ts` (rename).
  Verify: a test that the sweep never touches a live owner's worktree.
  Depends-on: S6.
- [x] **S9 — Linter generalization.** DONE 2026-08-18. Delegado con glitch: el applier EJECUTÓ (árbol modificado) pero devolvió task_result vacío (glitch de reporte, no de ejecución); verificación inline del orquestador + 4 fixes propios (bug rule 21 + 3 wrappers opencode). Rule 18 (check_hook_renders_and_published_hashes_match) verificado table-driven vía renderer (sin cambios); los 4 loops `for host in claude codex` → +opencode (check_forked_skills_declare_a_verdict_token, check_call_sites ×2, check_global_routing_names_every_operator_only_mode con invocation `/mode`); skill_sources() case opencode + regex `platform/(claude|codex|opencode)`; +opencode en check_integrator_report_names_next_wave_start y check_verifier_payload_is_closed (openode/agents/oso-*.md); NEW rule 21 check_parity_docs_agree_on_harness_version (fuente de verdad = pines SUPPORTED_*_VERSION de bootstrap/install-*.sh vs versiones nombradas en docs/parity-*.md; fix del orquestador: extraer versión del match `named="${named##* }"`); rule 15 prose surfaces: check_reporting_host_difference_is_single_sourced en loop 3 hosts (claude 'native subagent card' / codex 'draws no card' / opencode 'native agent files' — nueva surface plugin/skills/_shared/platform/opencode/reporting.md reescrita); spelled count 41→42 (tests/plugin-lint.sh header, README.md, CHANGELOG top); suite: copy_lint_fixture +opencode, fixture rule count forty-two, sección mutación call-site opencode (oso-debt-sweep bare → rojo nombrando archivo+regla), sección parity version (1.18.18→1.19.0 → rojo nombrando doc+pin). Fixes del orquestador: 3 wrappers opencode (oso-debt-sweep/doubt-pass/triage) ganaron el párrafo call-site con tokens+rutas (la auto-invocación `oso-<name>` de S3 los convirtió en call sites sin contrato).
  Verify: mutating an opencode wrapper turns the linter red naming the file
  and the rule. Depends-on: S3, S2, S6.
- [x] **S10 — `plan_exit`.** DONE 2026-08-19.
  Agent `oso-plan`, the full digest rail, throw-on-decline.
  Verify: a test that declining produces no completed tool part.
  Depends-on: S6, S3.
  Delegado (applier OK, sin glitch de reporte); verificación inline del
  orquestador: 4 barras verdes en ejecución propia (plugin-lint clean,
  hooks-test passed 1579 / failed 0, tsc --noEmit clean, node --test 51 pass).
  Entregas: `opencode/agents/oso-plan.md` (primario fases 1-5, edit deny, bash
  read-only pattern-scoped — `"*": deny` primero y last-match-wins verificado
  en docs opencode.ai/permissions, luego git*/git log*/ls*/cat*/grep* allow);
  `opencode/plugin/oso/plan.ts` (rail: digestOf, repoStateDir bajo
  OSO_STATE_DIR|~/.local/state/oso-code/plans/<sha256(commonDir)>, capturePlan
  fail-open con marker `<!-- oso-session: <id> -->` primera línea, approvePlan
  con content-parity + ownership y el mensaje EXACTO ADR-0112, declineThrows
  Error con remedio si la sesión ya presentó un digest distinto,
  planApprovalState read-only); wiring en oso-code.ts (PluginInput ahora acepta
  client para client.tui.showToast; tool.execute.before corre declineThrows
  ANTES de capturePlan y tira en decline → no hay completed part; chat.message
  aprueba en part type "agent" agent "build" o texto exacto "Implement the
  plan.", toast de una frase en ok:false); 6 tests en
  opencode/plugin/oso/plan.test.ts (incluida la prueba handler-level de que el
  decline produce throw/no completed part). Orden crítico declineThrows→capture
  resuelto por el orquestador: capture primero sobrescribiría el presented y el
  check quedaría ciego. Sin strings D8 prohibidas ni tokens S#/D#/ADR en
  comentarios.
- [x] **S11 — Own workspace adapter.** DONE 2026-08-19.
  **Superseded — see §0: every symbol this slice names is deleted and the Verify
  line below is unsatisfiable, because there is no longer a `create` to return.**
  `create` runs `git worktree add -b <branch> <path> <WAVE START>`.
  Verify: a test that the worktree exists, is populated and is on the
  requested branch when create returns. Depends-on: S6.
  Delegado (applier OK, sin glitch); verificación inline del orquestador: 4
  barras verdes en ejecución propia (plugin-lint clean, hooks-test passed
  1579 / failed 0 / skipped 1, tsc --noEmit clean, node --test 55 pass).
  Entregas: `opencode/plugin/oso/workspace.ts` (worktreeRoot bajo
  ~/.local/share/opencode/worktree/<projectID>/, createWorkspace corre
  `git worktree add -b <branch> <path> <start>` con cwd=repoDir, valida
  name/branch como componentes seguros — UNSAFE_REF permite "/" en refs como
  oso/<change>/<slice>, UNSAFE_PATH rechaza separadores en name — y tira el
  stderr de git como remedio; registerWorkspaceAdapter fail-open: sondea
  client.experimental_workspace.register en runtime vía cast (tipos publicados
  sin surface, trap 4) y degrada a raw fetch POST {serverUrl}/experimental/
  workspace con AbortController 2s, no-op sin serverUrl); wiring en
  oso-code.ts (PluginInput += serverUrl; registerWorkspaceAdapter tras el
  sweep en try/catch que traga todo, hooks existentes intactos); 4 tests en
  opencode/plugin/oso/workspace.test.ts (worktree poblado+en el branch+HEAD==
  start al retornar create — el criterio de verify, que además prueba que el
  adapter vence al forked-empty del host; start ref desconocido tira stderr;
  name/branch inseguros rechazados antes de git; register no-op). Sin strings
  D8 prohibidas ni tokens S#/D#/ADR en comentarios.

### Wave 5

- [x] **S12 — `oso_wave` thin fan-out.** DONE 2026-08-19.
  **Partly superseded — see §0: the `createWorkspace` this slice's test built its
  worktrees with is deleted; the Verify line below still holds and is still tested.**
  Verify: two concurrent children return distinct verdicts and each wrote
  inside its own worktree. Depends-on: S11, S7.
  Delegado (applier OK, sin glitch); verificación inline del orquestador: 4
  barras verdes en ejecución propia (plugin-lint clean, hooks-test passed
  1579 / failed 0 / skipped 1, tsc --noEmit clean, node --test 60 pass).
  Entregas: `opencode/plugin/oso/wave.ts` (WaveChildLaunch/WaveChildResult/
  SessionTransport; defaultTransport: sondea client.session.create/post en
  runtime vía cast → fallback a raw fetch POST {serverUrl}/session {directory}
  y POST {serverUrl}/session/{id}/message {prompt} con AbortController 60s —
  core path, falla LOUD con Error claro si no hay surface ni serverUrl, no
  no-op; runWave con readiness barrier: Promise.all de creates antes de
  cualquier post, posts en paralelo (bloquean hasta completar el turno del
  child, veredicto in-band vía parseAgentVerdict sobre el texto final), child
  fallido → result blocked y los hermanos reportan, timeoutMs opcional);
  opencode/plugin/oso/wave.test.ts (5 tests: veredictos distintos done/fail;
  pinning a worktrees REALES via createWorkspace con HOME aislado — directorios
  de create == los worktree paths, la escritura end-to-end se prueba en el
  smoke de S14/D16; readiness barrier sin post antes del último create; child
  fallido → blocked y siblings intactos; defaultTransport sin surface tira).
  El pin de child sessions por session.directory está probado en ADR-0151 F7.
  Sin strings D8 prohibidas ni tokens S#/D#/ADR en comentarios.

### Wave 6

- [x] **S13 — Installer.** DONE 2026-08-19.
  Config, skills, agents, plugin, MCP, engram, pinned Impeccable acquisition,
  owner registry.
  Verify: an install into a fixture HOME leaves every artifact where OpenCode
  actually reads it. Depends-on: S3, S4, S6, S5.
  Delegado (applier OK, sin glitch de reporte); verificación inline del
  orquestador: 4 barras verdes en ejecución propia (plugin-lint clean,
  hooks-test passed 1651 / failed 0 / skipped 1 — +72 sobre el baseline S12,
  skip pre-existente, node --test 60 pass, tsc --noEmit clean, bash -n clean).
  Entregas: `bootstrap/install-opencode.sh` reescrito de skeleton S1 a
  instalador completo (612 líneas, espejo de la estructura de install-codex.sh:
  initialize_paths/parse_args/preflight_*/begin_transaction con backup_target +
  lib/install-backup.sh/rollback_transaction/on_exit/checkpoints). D6 config:
  dueño total de opencode.json desde template estricto JSON (sin región
  marcador, plugin SIEMPRE array, MCP con `environment` nunca `env`, contract
  check que rechaza `env`), reaplica del backup `provider`/`model`/`small_model`/
  `permission`/`mcp` (permission merge por sub-clave: installer dueño de
  skill+task+question+plan_enter+plan_exit, bloque operador de bash+read vuelve
  entero). D11: 8 wrappers a `skill/` (singular) + `_shared/` al lado,
  permission.skill deny para oso-plan/oso-quick/oso-debug. Agents a `agent/`
  (singular), commands a `command/` (3 nuevos opencode/commands/*.md, el plan
  rutea a `agent: oso-plan`). D20 plugin: entrada única plugin/oso-code.ts +
  plugin/oso/*.ts (sin *.test.ts) + hooks/routes.ts al lado. D21
  opencode-global.md → AGENTS.md. D15 Impeccable pinneado: clone
  skill-v$SUPPORTED_IMPECCABLE_VERSION (pin leído de install-codex.sh, 4.0.2)
  + lib/mount-impeccable.sh con verificación version:, `--no-impeccable`
  opt-out. D25 engram: `engram setup opencode` si lo anuncia (--help), fallback
  preserva plugins/engram.ts previo del backup. Owner registry en
  ~/.local/state/oso-code/opencode-install-registry (installer vs operator por
  target/key). Los tres opencode.json de proyecto NUNCA se tocan (probado en
  fixture). tests/hooks-test.sh +443 líneas / +72 assertions: decline, usage
  error, happy path (cada categoría en la ruta que el host lee: config/skills/
  agents/commands/plugin/routes/AGENTS/engram/impeccable, reapply del operador,
  tree plural del operador intacto, plugin stale reemplazado wholesale,
  project-configs intactos, llamadas externas solo probe --version), engram
  fallback, --no-impeccable, rollback byte-exacto, reinstall idempotente,
  clone pinneado por tag, tag errado → refusal loud. Nota: D6 tira `theme`/
  `agent` del config instalado (no están en la lista de 5 keys a reaplicar);
  los agentes oso-* son archivos (no config), así que la superficie del harness
  no depende de `agent`. Sin strings D8 prohibidas ni tokens S#/D#/ADR en
  comentarios.

### Wave 7

- [x] **S14 — `bootstrap/verify-opencode.sh`**, including the real wave-runner
  smoke. DONE 2026-08-19.
  Verify: the report reaches its summary and the smoke proves per-worktree
  isolation. Depends-on: S13, S12. NOTE: smoke needs a local model — the
  operator's machine has an ollama provider with 6 models in
  `~/.config/opencode`; defaulting to that, else the smoke skips.
  Delegado (applier OK, sin glitch de reporte); verificación inline del
  orquestador: barras verdes en ejecución propia — `bash
  bootstrap/verify-opencode.sh` → passed 14 / failed 0 / exit 0 (smoke
  aislado REAL con dos children sobre el host 1.18.18 y el modelo
  opencode/deepseek-v4-flash-free), plugin-lint clean, bash -n clean. Sin
  tokens S#/D#/ADR ni strings D8. `bootstrap/verify-opencode.sh` (600 líneas,
  espejo de verify-codex.sh): check()/fold_lines/escape_sed_pattern/
  bounded_command_output + remove_temporary_fixture con guard de parent+prefijo;
  local checks sobre fixture HOME desechable (install-opencode.sh --yes
  --no-impeccable con shims PATH para opencode/engram/fallow-mcp): versión
  instalada == pin, config contract (plugin array, sin `env`, permission.skill
  deny los 3 modos), 8 wrappers + _shared byte-exactos, agentes byte-exactos,
  commands (3, oso-plan rutea a agent: oso-plan), plugin entry+oso/*+routes
  byte-exactos sin *.test.ts, plugins/engram.ts presente, AGENTS.md ==
  opencode-global.md, owner registry con targets installer; + barra TS (tsc
  --noEmit + node --test 60) y bash -n de los 3 scripts. Smoke wave-runner
  (D16): scratch repo con baseline + dos worktrees `git worktree add -b oso/wtN
  <path> <start>` (misma forma que el adapter S11); config fixture con
  permission question/plan_enter/plan_exit/bash allow (headless deny por
  defecto — ADR-0151 part 5); dos children `opencode run --dir <wt> -m
  opencode/deepseek-v4-flash-free --format json` (sin --command, ADR-0152 part
  3) con prompt que escribe proof file en su propio worktree y cierra con
  status:/verdict: in-band; XDG state/cache/data por child (evita lock de
  opencode.db en paralelo); preflight bounded (120s) → skip limpio si no hay
  modelo; children bounded 300s; asserts: cada worktree tiene SOLO su proof,
  ninguno el del otro, el root ninguno, y el NDJSON trae status:done
  verdict:pass por child (parser python que espeja parseAgentVerdict). Esto
  COMPLETA el criterio de verify de S12 (escritura end-to-end por worktree).
  Cleanup por trap EXIT; el config real del operador nunca se abre (mtime
  intacto). OSO_VERIFY_SKIP_SMOKE=1 → skip limpio.

### Wave 8 (width 2)

- [x] **S15 — CI and suite sections.** DONE 2026-08-19.
  New ubuntu step with its measured pinned failure count; both `bash -n`
  lists extended; host-exclusive sections.
  Verify: the CI step gives signal against a deliberate mutation.
  Depends-on: S14, S9.
  Delegado (applier OK, sin glitch de reporte); verificación inline del
  orquestador: barras verdes en ejecución propia — hooks-test passed 1664 /
  failed 0 / skipped 1 (+13 sobre baseline S14 de 1651; skip pre-existente;
  incluye las 10 ok del bloque nuevo), plugin-lint clean, bash -n clean,
  verify-opencode.sh sigue 14/0 con smoke aislado, YAML parsea (ruby), y la
  simulación de mutación (un wrapper borrado de un repo copia) da rc≠0 y
  nombra "expected exactly 8 OpenCode skill wrappers (found 7)". Entregas:
  `.github/workflows/ci.yml` — nuevo step ubuntu "OpenCode verify report
  reaches its summary" (env OSO_VERIFY_SKIP_SMOKE=1; `cd opencode && npm ci`
  primero porque node_modules está gitignored y sin deps el bar TS falla;
  HOME=$(mktemp -d) bash bootstrap/verify-opencode.sh → report → grep
  '^passed:' → pin de AMBOS half: `passed: 12` y `failed: 0` — medido en
  clean-room 2026-08-19; pin de passed también porque failed=0 solo no
  detecta un check removido/añadido); comentario extenso documentando por qué
  el verifier es self-contained (fixture HOME + shims), version probe skip sin
  binario, smoke skip sin modelo. Listas bash -n: ya globban bootstrap/*.sh
  (cubren install/verify/purge-opencode) — solo se añadió la nota al comentario
  del step ubuntu, sin duplicar. `tests/hooks-test.sh` — bloque host-exclusive
  "OpenCode verifier" (~line 13890, +117 líneas / 13 assertions, guardado por
  RUNS_ON_WINDOWS_BASH + node_modules-absent): corre verify-opencode.sh contra
  HOME de fixture con PATH sin opencode (version probe skip) y
  OSO_VERIFY_SKIP_SMOKE=1; asserts: rc=0, exactamente un summary, cero FAIL,
  ≥10 ok, ambos skips, fixture install ready, HOME apuntado NO se muta (3
  archivos exactos con npm_config_cache redirigido — verificado: npm escribe
  update-notifier en $HOME/.npm si no se redirige), config/guidance/sentinel
  intactos, y la mutación (un wrapper borrado de repo copia) → rc≠0 nombrando
  el artifact. Sin strings D8 ni tokens S#/D#/ADR en líneas añadidas.
- [x] **S16 — Docs and release.** DONE 2026-08-19.
  `docs/parity-opencode.md` complete; blueprint foundational rows (ADR-0096
  and the "second adapter" context-budget row); README; CHANGELOG.
  Verify: rules 13, 14 and 21 pass over the new ADRs and all version
  authorities agree. Depends-on: S14.
  Delegado (applier OK, sin glitch de reporte) + 1 fix del orquestador:
  el applier bumpió CHANGELOG a 0.26.0 pero dejó los manifests de plugin en
  0.25.0 → la suite falló "the changelog opens on the plugin manifests'
  release version"; el orquestador bumpió ambos plugin.json a 0.26.0 y
  re-corrió la suite completa → passed 1664 / failed 0 / skipped 1.
  Verificación inline del orquestador: 4 barras verdes en ejecución propia
  (plugin-lint clean, hooks-test passed 1664 / failed 0 / skipped 1, tsc
  --noEmit clean, node --test 60 pass) + version authorities 0.26.0 en los
  tres (plugin/.claude-plugin, codex/.codex-plugin, CHANGELOG) + blueprint
  indexa 0153 + parity-opencode nombra EXACTAMENTE una versión (1.18.18,
  rule 21). Entregas: `docs/parity-opencode.md` completo — 6 pendings
  resueltos a Verified con la evidencia de su slice (approval rail S10,
  workspace adapter S11, MCP env key S13, delegación in-band S12, version
  agreement S6 —corrige el "S22" stale—, model availability S14), +7 rows
  Verified nuevas (installer config ownership, plugin layout, AGENTS.md,
  engram, Impeccable pinneado —S13—, verify+wave smoke S14, CI step S15),
  sección "Frozen loss and degradation ledger" (roadmap no portado, headless
  --command inusable, no subagents/handoff rail), "Where the shared tree has
  to land" y cierre 3 hosts. ADR-0153 (installer/verifier/CI host facts, 4
  parts + reconciliations: S22 stale, drops theme/agent, sin --command).
  Blueprint: Platform row → Claude Code, Codex y OpenCode (ADR-0096+0151),
  Distribution row, Context budget → "second and third adapter", index gana
  0153 bajo fecha 2026-08-19. README: fila opencode/ en layout, fila
  bootstrap/ actualizada, sección Install OpenCode, spellings /oso-plan
  quick debug, Surfaces → tercer runtime verificado. CHANGELOG 0.26.0
  (tercer host, 16 slices, ADRs 150→153, 1664 casos). Sin strings D8 ni
  tokens S#/D#/ADR en comentarios de ejecutables.

## 7. Verification bar (every slice closes at zero)

- `bash tests/hooks-test.sh`
- `bash bootstrap/verify.sh`
- `bash bootstrap/verify-codex.sh`
- `bash bootstrap/verify-opencode.sh` (from S14)
- `bash -n` over the repo's shell files, with the lists extended
- `claude plugin validate --strict plugin` and `--strict .`
- `tools/render-hooks-json.sh --check` and `--check-hashes`
- from S6: `cd opencode && tsc --noEmit && bun test`

## 8. Blocking obligations

- **F7** (doubt pass): nobody has established that `tool.execute.before` fires
  for worktree-pinned CHILD sessions. If tool hooks are directory-scoped like
  the `event` hook, appliers in worktrees run with NO commit gate and NO slice
  gate exactly where the commits happen. Proven in S1, before the wave runner
  is built.
- **S14**: real wave-runner smoke requires a model (local ollama available).
- **D25**: verify whether Engram supports installing into OpenCode before
  writing the engram-wiring slice.

## 9. Execution protocol (fresh session)

1. `cd <your oso-code checkout>`, confirm
   `feature/opencode-parity` is checked out and this file is current.
2. Run Wave 1 → Wave 8 in order, one slice at a time. Start a slice by
   arming it in this file (`[x]` when green) and recording `CHANGE BASE` via
   amendment if slice 1.
3. Every delegation: `subagent_type: "general"`,
   `model: "opencode/deepseek-v4-flash-free"`, task payload explicit.
4. Per slice: implement → run that slice's verify against section 7 bar →
   zero closes the slice → commit on `feature/opencode-parity`
   (conventional commit, per repo style).
5. Every wave completes before the next one arms.
6. Amendments to this plan are recorded here with a P-number and mirrored to
   engram topics `oso/opencode-parity/ledger|plan`.
7. A blocked slice returns a blocked report (status/done_so_far/questions) —
   never a guess. The orchestrator resolves with the operator.
8. Final wave ends with the port ready for a real-repo smoke and the parity
   report (`docs/parity-opencode.md`) closing S16.

## 10. References

- Engram `oso/opencode-parity/ledger` #2913 (intent, surface map, D1-D26, doubt pass)
- Engram `oso/opencode-parity/plan` #2914 (frozen slice checklist)
- ADR-0087 (execution coordinates), ADR-0118 (CHANGE BASE / WAVE START / SLICE START)
- ADR-0124 (Impeccable pin 4.0.2), ADR-0096 (first-class host adapters)
- `docs/parity-codex.md` (parity-report model for this host)
- `docs/blueprint.md` (foundational rows updated by S16)
