# oso-code — Blueprint

Frozen design for the oso-code harness. A change to it takes a new decision under [docs/decisions/](decisions/), never a silent edit here.

## Decisions

Every decision this design has taken since the freeze is one file under [docs/decisions/](decisions/) — one per decision, numbered in the order it was written. `Date:` is a field, so a decision filed out of date order keeps its id and the index below sorts by date instead; the ids are cited from the skills, so they never move.

Each file carries its date, its status, what supersedes it and what it supersedes, the files that cite it, and a `Reconciled:` line saying where the decision landed:

| `Reconciled:` | Means |
|---|---|
| `applied` | the frozen body below reads as the decision decided |
| `superseded` | a later decision retired it and the body deliberately reads otherwise |
| `elsewhere` | it landed in the skills, the agents, the rubric or the installer, and the body never carried it |
| `nowhere` | it changed no file — a release record, engram data, an evaluation that adopted nothing |

`Status: superseded` means a later decision replaced the whole of it. A `Superseded-by:` on an accepted decision names the one clause that was retired and leaves the rest standing.

Three properties of the amendment log these files replace are facts to carry forward, not errors to correct:

- **Filing order** — the 2026-07-06 decision sat between the 2026-07-16 and 2026-07-21 entries, ten days out of order. A filing error, not a decision: ids here follow creation like every other, and the index below sorts by date, which is why 0027 reads third.
- **A contradiction left standing** — ADR-0058 records `tests/plugin-lint.sh` as a new file covering six rules, while ADR-0065 records the same file growing from two rules to six. `git cat-file -e 7d52356^:tests/plugin-lint.sh` fails with rc 128 and `git log --diff-filter=A -- tests/plugin-lint.sh` names only `7d52356`, so the file never existed before that commit and there was no two-rule state to grow from. Both files record what git shows; neither decision is rewritten to match it.
- **Provenance three decisions cannot get from `git blame`** — the amendment log forbade editing a filed entry, and three were edited in place anyway, so blame reports the annotating commit rather than the deciding one. `git log -S` on the original text recovers all three: `1ecac78` for ADR-0002 and `e556769` for ADR-0038, both annotated by `7d52356`, and `577f972` for ADR-0007 through ADR-0010, annotated by `4e565fa` — which deleted a phrase from ADR-0008's original text.

### Index

**2026-07-02 — execution model · commit `667388d`**

- [0001](decisions/0001-delegated-slice-execution.md) — Delegated slice execution

**2026-07-02 — after adversarial review · commit `1ecac78`**

- [0002](decisions/0002-adversarial-review-hardening.md) — Hardening after adversarial review

**2026-07-06 — plan flow · commit `6af5a9c`**

- [0027](decisions/0027-surface-mapping-phase-and-index-recall.md) — Surface mapping before the question battery, and `oso/index` recall

**2026-07-11 — harness audit (5-judge review) · commit `8b8456e`**

- [0003](decisions/0003-runtime-state-in-per-session-files.md) — Runtime state lives in per-session flat files
- [0004](decisions/0004-context7-wired-into-executable-prompts.md) — context7 is wired into executable prompts, not fenced off
- [0005](decisions/0005-rubric-operational-anchors.md) — The rubric gains operational anchors
- [0006](decisions/0006-pre-freeze-gates.md) — Decision rounds close through pre-freeze gates

**2026-07-11 — adaptive behavior · commit `577f972`**

- [0007](decisions/0007-operator-preference-store.md) — Operator preference store
- [0008](decisions/0008-optional-end-to-end-walkthrough.md) — Optional end-to-end walkthrough as `/plan` phase 5 *(superseded)*
- [0009](decisions/0009-gap-evidence-adaptive-teaching.md) — Gap-evidence adaptive teaching
- [0010](decisions/0010-oso-register-tuteo.md) — Oso's Spanish register

**2026-07-12 — walkthrough-before-approval · commit `4e565fa` · released 0.9.0**

- [0011](decisions/0011-single-approval-gate-starts-execution.md) — The walkthrough moves before approval, and one approval starts execution
- [0012](decisions/0012-pana-corrector-register.md) — Oso's register is a pana corrector
- [0013](decisions/0013-persona-scope-excludes-delegations.md) — Persona scope excludes delegations
- [0014](decisions/0014-engram-observations-in-english.md) — Engram observations carry English content and English titles
- [0015](decisions/0015-plan-step-0-self-heals-stale-index-rows.md) — `/plan` step 0 self-heals stale `executing` index rows
- [0016](decisions/0016-oso-index-format.md) — The `oso/index` format is standardized once
- [0017](decisions/0017-release-0-9-0.md) — Released as 0.9.0
- [0018](decisions/0018-ecommerce-index-row-corrected.md) — The ecommerce project's stale `oso/index` row is corrected at Close

**2026-07-16 — windows-install-behavior · commit `2905cde` · released 0.10.0**

- [0019](decisions/0019-mcp-wiring-hybrid-and-durable.md) — MCP wiring goes hybrid and durable
- [0020](decisions/0020-oso-state-reachable-from-every-skill.md) — `oso-state` is reachable from every skill
- [0021](decisions/0021-windows-bootstrapper-without-duplicated-logic.md) — The Windows bootstrapper duplicates no logic
- [0022](decisions/0022-identity-level-voice.md) — Voice is identity-level
- [0023](decisions/0023-walkthrough-contract-with-comprehension-check.md) — The `/plan` §5 walkthrough is a contract *(superseded)*
- [0024](decisions/0024-teaching-moment-block.md) — The teaching-moment block, and one definition of didactic
- [0025](decisions/0025-teaching-preference-is-engram-data.md) — The operator's teaching preference is engram data, not a repo default
- [0026](decisions/0026-benchmark-evaluation-adopted-nothing.md) — The Claude Code benchmark evaluation adopted nothing

**2026-07-21 — repaso-categories-antiswallow · commit `4cc2020` · released 0.11.0**

- [0028](decisions/0028-invariant-core-plus-derived-categories.md) — Decision rounds run on an invariant core plus derived categories
- [0029](decisions/0029-question-rounds-cap-at-four.md) — Question rounds cap at four
- [0030](decisions/0030-first-run-preference-round-shrinks-to-two.md) — The first-run preference round shrinks to two questions
- [0031](decisions/0031-repaso-de-cambios.md) — Repaso de cambios replaces the didactic walkthrough
- [0032](decisions/0032-anti-swallow-delivery-rule.md) — Anti-swallow delivery ground rule
- [0033](decisions/0033-exitplanmode-is-the-sole-approval-gate.md) — `ExitPlanMode` is the sole approval gate
- [0034](decisions/0034-release-0-11-0.md) — Released as 0.11.0

**2026-07-21 — osmani-hardening · commit `d51ad79` · released 0.12.0**

- [0035](decisions/0035-anti-rationalization-trap-tables.md) — Anti-rationalization trap tables at the weak gates
- [0036](decisions/0036-forked-doubt-pass.md) — Forked `doubt-pass` before the freeze
- [0037](decisions/0037-slice-regression-gate.md) — Slice regression gate

**2026-07-22 — debug-security-flows · commit `e556769` · released 0.13.0**

- [0038](decisions/0038-debug-mode.md) — A third mode: `/debug`
- [0039](decisions/0039-diagnosis-persists-once.md) — The diagnosis persists once, and never to the index
- [0040](decisions/0040-reverse-detour-to-plan.md) — Reverse detour from `/debug` to `/plan`
- [0041](decisions/0041-debug-mode-runtime-gating.md) — `mode=debug` edits are unrestricted; the commit gate is not
- [0042](decisions/0042-additive-only-offers-and-bug-detour.md) — The offers on `/plan` and `/quick` are additive only
- [0043](decisions/0043-stop-the-line.md) — Stop-the-line on unrelated breakage
- [0044](decisions/0044-inline-pre-commit-security-review-offer.md) — Pre-commit security-review offer, invoked inline *(superseded)*

**2026-07-24 — secfork-impeccable-pocock · commit `7d52356` · released 0.14.0 in the manifest, first installed inside 0.15.0**

- [0045](decisions/0045-forked-security-pass.md) — The security review runs in a fork, never inline
- [0046](decisions/0046-front-surface-design-bar.md) — The front-surface design bar, powered by Impeccable
- [0047](decisions/0047-verifier-judges-failing-check-quality.md) — The verifier judges the failing check's quality
- [0048](decisions/0048-debt-sweep-conformance-axis.md) — `debt-sweep` gains a ledger-conformance axis
- [0049](decisions/0049-expand-contract-slicing.md) — Expand-contract slicing for wide refactors

**2026-07-25 — gates-hardening · commit `7d52356` · released 0.15.0**

- [0050](decisions/0050-the-gate-is-a-discipline-rail.md) — The gate is a discipline rail, not an adversarial boundary
- [0051](decisions/0051-two-layer-commit-boundary.md) — The commit boundary goes two-layer
- [0052](decisions/0052-hybrid-jq-payload-reading.md) — Payload reading goes hybrid: jq where present, pure bash where not
- [0053](decisions/0053-the-matcher-becomes-a-lexer.md) — The commit matcher becomes a lexer
- [0054](decisions/0054-gate-polarity-and-state-discipline.md) — Gate polarity and state discipline
- [0055](decisions/0055-the-audit-trail.md) — The audit trail
- [0056](decisions/0056-event-log-rotates-at-30-days.md) — The event log rotates at 30 days
- [0057](decisions/0057-orphan-state-files-pruned-at-7-days.md) — Orphan state files are pruned at 7 days
- [0058](decisions/0058-the-bar-the-platform-and-distribution.md) — The bar, the platform, and distribution

**2026-07-25 — c-mechanisms · commit `7d52356` · released 0.15.0**

- [0059](decisions/0059-impeccable-pin-resolved-at-runtime.md) — The Impeccable pin is resolved at runtime from the npm channel
- [0060](decisions/0060-audit-loop-exit-is-an-adapter.md) — The design-audit loop exits on an adapter over upstream, not a token
- [0061](decisions/0061-security-pass-reviews-the-pending-tree.md) — `security-pass` reviews the pending working tree
- [0062](decisions/0062-plan-close-reads-both-sweep-verdicts.md) — `/plan`'s close reads both sweep verdicts by name
- [0063](decisions/0063-applier-assignment-kinds-are-a-closed-list.md) — `oso-applier` takes a closed list of four assignment kinds
- [0064](decisions/0064-front-surface-single-source-scope.md) — `front-surface.md` is single-source only over what it holds
- [0065](decisions/0065-plugin-lint-grows-to-six-rules.md) — `tests/plugin-lint.sh` grows to six rules

**2026-07-25 — harness-hardening pass · commit `bdd9cb6` · released 0.16.0**

- [0066](decisions/0066-fallow-is-reported-never-asserted.md) — fallow is reported, never asserted
- [0067](decisions/0067-impeccable-opt-out-is-recorded-data.md) — The `--no-impeccable` opt-out is recorded, and cleared
- [0068](decisions/0068-debug-verify-exception.md) — `/debug` gains a bounded `Verify-exception`
- [0069](decisions/0069-debug-verifier-payload.md) — `/debug`'s verifier launch names its whole payload
- [0070](decisions/0070-quality-pass-closes-quick-and-debug.md) — `quality-pass` closes quick and debug, never plan
- [0071](decisions/0071-debug-sweep-is-additive.md) — `/debug`'s sweep offer is additive, with its own fix route
- [0072](decisions/0072-marketplace-source-repair-with-consent.md) — The marketplace source is classified, warned about, and repaired only with consent
- [0073](decisions/0073-npx-probe-is-bounded-in-shell.md) — The npx probe is bounded in-shell at 20 seconds
- [0074](decisions/0074-update-envpath-unions-registry-first.md) — `Update-EnvPath` unions, registry scopes first
- [0075](decisions/0075-two-tier-update-instruction.md) — The update instruction is two-tier

**2026-08-02 — parallel wave execution (this change)**

- [0076](decisions/0076-worktrees-live-outside-the-project-repo.md) — Parallel worktrees live outside the project repo
- [0077](decisions/0077-slice-independence-from-surface-map-edges.md) — Slice independence is read off the surface map's edges
- [0078](decisions/0078-slices-are-cut-by-the-vertical-bar-only.md) — Slices are cut by the vertical bar only, never by the execution mode
- [0079](decisions/0079-waves-and-their-two-structural-boundaries.md) — Waves, and the two boundaries the graph does not draw
- [0080](decisions/0080-execution-mode-chosen-with-the-computed-width.md) — The execution mode is chosen in §4, with the computed width
- [0081](decisions/0081-a-dedicated-integrator-that-never-judges.md) — A dedicated integrator merges the wave, and never judges it
- [0082](decisions/0082-the-integration-gate-is-a-second-verifier-shape.md) — The integration gate is an `oso-verifier` run with a second verdict shape
- [0083](decisions/0083-a-wave-integrates-only-when-all-slices-are-green.md) — A wave integrates only when all of its slices are green
- [0084](decisions/0084-failure-routes-by-class.md) — Failure inside a wave routes by class
- [0085](decisions/0085-per-slice-commits-and-a-real-base-ref.md) — Commits land per slice, and the base ref must be real
- [0086](decisions/0086-the-green-window-around-a-per-slice-commit.md) — The green window around a per-slice commit
- [0087](decisions/0087-worktree-path-and-base-ref-in-both-payloads.md) — Both delegation payloads carry a worktree path and a base ref
- [0088](decisions/0088-worktree-lifecycle-and-repo-path.md) — The worktree lifecycle, and the `repo_path` key it runs on
- [0089](decisions/0089-oso-state-gains-an-event-verb.md) — `oso-state` gains an `event` verb
- [0090](decisions/0090-forked-triage-skill-for-attribution.md) — A forked `triage` skill answers attribution, and only that
- [0091](decisions/0091-concurrency-recorded-as-a-question-answered-at-the-first-wave.md) — The concurrency fact is recorded as a question, and answered at the first wave
- [0092](decisions/0092-execution-time-exit-back-to-sequential.md) — A degrading wave draws an offer to finish sequentially
- [0093](decisions/0093-the-commit-boundary-moves-to-push-and-pr.md) — The commit boundary moves to push and PR

**2026-08-02 — Codex baseline and runtime identity (this change)**

- [0094](decisions/0094-codex-baseline-and-minimum-version.md) — The verified Codex baseline, and the minimum version the harness supports
- [0095](decisions/0095-runtime-state-keyed-by-repository.md) — Runtime state is keyed by the repository, and a gate arms on an agent marker

**2026-08-03 — Codex host adapter, parity contract, and config ownership · released 0.18.0**

- [0096](decisions/0096-claude-and-codex-are-first-class-host-adapters.md) — Claude Code and Codex are first-class host adapters
- [0097](decisions/0097-codex-parity-is-a-release-ledger.md) — Codex parity is a release ledger
- [0098](decisions/0098-codex-config-ownership-is-per-leaf.md) — Codex configuration ownership is per leaf inside shared tables
- [0099](decisions/0099-the-checkout-hook-owner-migrates-only-when-exact.md) — the checkout hook owner migrates only when exact
- [0100](decisions/0100-the-integrator-smoke-must-preserve-live-authority.md) — the integrator smoke must preserve live authority

**2026-08-04 — codex-native-plan-lifecycle**

- [0101](decisions/0101-codex-native-approval-and-operational-plan-artifacts.md) — Codex native approval drives immutable and operational plan artifacts

**2026-08-04 — codex-post-install-repair**

- [0102](decisions/0102-codex-post-install-repair-is-bounded-and-profile-launches-are-fresh.md) — Codex post-install repair is bounded and explicit profile launches are fresh

**2026-08-04 — codex-plan-mode-attestation**

- [0103](decisions/0103-codex-plan-mode-is-attested-by-the-exact-turn.md) — Codex Plan Mode is attested by the exact hook turn

**2026-08-04 — codex-plan-marker-transport**

- [0104](decisions/0104-codex-plan-marker-allows-one-host-terminal-lf.md) — Codex plan marker allows one host terminal LF without normalizing the approval digest

**2026-08-05 — codex-fluidity**

- [0105](decisions/0105-explicit-codex-role-launches-set-fork-turns-none.md) — An explicit Codex role launches fresh through MultiAgentV2's `fork_turns`
- [0106](decisions/0106-codex-host-contract-claims-are-checked-against-the-installed-binary.md) — Codex host-contract claims are checked against the installed binary
- [0107](decisions/0107-plan-approval-keeps-its-own-session-key-apart-from-ownership.md) — Plan approval keeps its own session key apart from ownership, and the catch-all scopes to it
- [0108](decisions/0108-deny-records-name-what-they-denied-with-a-schema-version.md) — Deny records name what they denied, with a schema version
- [0109](decisions/0109-a-judge-that-runs-project-checks-cannot-stay-read-only.md) — A judge that runs project checks cannot stay read-only
- [0110](decisions/0110-plan-approval-state-migrates-inside-a-transaction-that-tells-the-truth.md) — Plan-approval state migrates inside a transaction that tells the truth
- [0111](decisions/0111-a-deny-hands-over-its-remedy-executably-or-says-it-has-none.md) — A deny hands over its remedy, executably, or says it has none
- [0112](decisions/0112-feedback-amends-a-pending-plan-in-place.md) — Feedback amends a pending plan in place, never destroying it

## Foundational decisions

| Decision | Choice | Rationale |
|---|---|---|
| Platform | Claude Code and Codex as first-class adapters over neutral behavioral bodies (ADR-0096) | One harness contract; host tools, lifecycle and paths stay in their own bindings |
| Distribution | One release: a native Claude plugin plus a Codex skills plugin and installer-owned roles, hooks, bounded config leaves and MCP wiring (ADR-0096, ADR-0098, ADR-0099, ADR-0102) | Codex's plugin schema cannot carry or pre-trust every runtime surface; the installer verifies its own leaves, composes Engram's root pointers, and repairs only exact Oso/Engram state without annexing shared host tables or foreign owners |
| Plan state | Engram for semantic recall; Codex additionally keeps immutable approval snapshots and mutable operational plans below `~/.local/state/oso-code/plans/` (ADR-0101) — no files inside project repos | Clean projects, durable per-machine execution evidence, and bounded hot amendments without rewriting what was approved |
| Enforcement | Native Plan Mode plus host approval adapter, state gates and prompt guidance (ADR-0096, ADR-0101, ADR-0102, ADR-0103, ADR-0104) | Runtime gates read state; Codex attests native mode from the exact turn, accepts its one host-owned terminal LF without normalizing the wire digest, binds the native approval prompt through that pending digest, and launches explicit delegated profiles with fresh complete context |
| Repos | This monorepo; legacy repos harvested then archived | Atomic versioning of rubric + gate + skill |
| Context budget | Each host's always-loaded global guidance ≤ 2k tokens | Behavior moves to on-demand skills; adding a second adapter does not duplicate the harness into startup context |
| Reference | gentle-ai kept as prompting reference only | The system works; oso-code is tailored, not a fork |

## Mode 1 — `/plan` (substantial changes)

Planning runs entirely in the host's native Plan Mode (read-only, harness-enforced), entered after a resume check. The behavioral phases below are shared; host tools and lifecycle spellings are adapter facts under ADR-0096 and are compared in the parity ledger required by ADR-0097.

0. **Resume check** — search engram for `oso/index` (direct topic-key search as fallback when the index doesn't exist yet) to find prior work on this change; resume from the recorded phase instead of re-asking decisions already made. Read `oso/preferences` here too: on first run (no observation yet) ask one round of two preference questions and save the observation; thereafter apply it silently and never re-ask.
1. **Intent** — understand WHAT the user wants at a high abstraction level. No code, no how. Output: intent statement + in-scope/out-of-scope. Human approves. If the intent turns out to be a bug — something that worked and broke — offer `oso-code:debug`; the human decides.
2. **Surface mapping** — evidence first: up to 3 parallel native explorer subagents (`Explore` on Claude Code, `explorer` on Codex) build a map of what the change touches from the intent, and the question battery is generated from that map. The Decision-rounds invariant core below audits the map for blind spots, and each surface derives its own categories from the evidence it carries; the core is the fallback question source only when exploration surfaces nothing. A front surface (shared trigger in `plugin/skills/_shared/front-surface.md`) also engages the Impeccable design bar; if Impeccable is absent, the gap is named with its install command and recorded visibly in the ledger, and the change continues without the bar.
3. **Decision rounds** — as many rounds as complexity demands. Each round uses the host question tool up to its platform cap — 4 questions on Claude Code, 3 on Codex — with options and tradeoffs, sourced from the surface-mapping battery. Everything lands in a **decision ledger**: contracts, architecture, data model, error handling. Exit: invariant core plus every derived category covered, an optional pre-freeze doubt pass on migrations/security/rollback triggers, + human declares the ledger frozen. The agent never assumes — an uncovered decision during execution stops the work and returns to the human.
4. **Slicing** — vertical slices, each with a goal, estimated files, its own verify criteria (at least one automated check that fails without the slice, or a declared `Verify-exception`), and the slices it depends on. The cut is by that vertical bar ALONE, never by the execution mode chosen at the end of this phase: the dependency graph is derived from the cut, and cutting for parallelism is what produces horizontal, individually unverifiable slices. Its edges are read off the surface map — a contract and its consumers, shared state two slices both write, a data flow running out of one into the other, and verification-bar coupling, the one none of the other three shows — with files overlap only as a secondary, physical check. A front change in a project with no `PRODUCT.md`/`DESIGN.md` opens with a design-foundation slice the orchestrator runs itself (Impeccable's `init` or `document`); a contract change with many consumers offers the expand-contract template (EXPAND → MIGRATE → CONTRACT, the CONTRACT slice gated on a named pre-delete completeness check). The graph groups into WAVES — a wave holds slices with no edge between any two of them, wave 0 is the design-foundation slice alone in the main checkout, and a CONTRACT slice never shares a wave with a MIGRATE one. Present the slices in wave order with the widest wave's width, then settle the mode in one question carrying that width, the arithmetic and a recommendation: run SEQUENTIALLY in the main checkout, or run each wave in PARALLEL with one worktree per slice — parallel recommended at a width of 3 or more, concurrency capped at 4 by default, and unavailable at all when the base ref is `none`. The mode and the cap go in the ledger; approval still happens through the Repaso-headed plan document (phase 5), which is where the single gate is, not here.

5. **Repaso de cambios (change recap)** — always delivered, no gate: a fixed three-section brief (Qué se va a realizar / Decisiones del ledger que lo moldean / Cómo va a funcionar), ~20-line soft cap, in the operator's language at their depth preference, immediately followed by the full plan detail (context, frozen ledger, every slice under the wave it runs in, verification bar). No confirmation loop: one host approval transition starts execution. Claude Code renders the document through native `ExitPlanMode`; Codex requires the operator to enter native Plan Mode before `$oso-code:plan`, binds the delivered bytes and composes the native `Implement the plan.` approval prompt with the narrower local rail recorded in ADR-0097 and ADR-0101. Its Stop transition also creates a pending immutable snapshot and operational `current.md` outside the repository; approval renames the snapshot to `approved-<digest>.md`. On approval, exit Plan Mode, save the plan under a rich title (`oso/{change}/plan — {description}`), upsert the change's `oso/index` row to `status: executing`, and initialize runtime state.
6. **Execution** — one slice at a time, or one WAVE at a time, whichever mode phase 4 recorded; delegated either way: an `oso-applier` subagent applies the slice, an `oso-verifier` subagent independently reruns every check (zero warnings: lint, types, tests, build as the project defines) and reads the diff to confirm the slice's regression check exercises its behavior and is neither tautological nor implementation-coupled. Both payloads carry the two coordinates that place the work — the WORKTREE PATH the slice lives in and the BASE REF it is judged against, which is what defines that diff. Loop apply → verify until green, then advance. Every green slice is COMMITTED in both modes, on by default and turned off only in the ledger's Verification row. SEQUENTIAL runs that loop in the main checkout and commits there, inside the green its own step 4 writes. PARALLEL cuts one worktree per slice of the wave below the host adapter's external worktree root — a sanitized session on Claude Code, the fixed `OSO_AGENT` marker on Codex — on its own branch `oso/<change>/<slice>`, runs the wave's slices side by side, and commits each one as it goes green inside a window the orchestrator opens and closes around that commit, since both layers of the commit rail read one repository-global flag and neither can see which worktree a commit comes from. A wave integrates only when ALL of its slices are green: a dedicated `oso-integrator` subagent merges the wave's branches one at a time and judges nothing, then an `oso-verifier` run over the merged tree is the integration gate, in its own verdict shape — the project's full bar plus a re-run of every wave slice's regression check, none omitted. Failure routes by class: a red slice repeats in its own worktree, a merge conflict stops the integrator and goes to the operator untouched, and a red integration returns the whole wave as a unit with the fix entering as a new slice. On Codex, an explicit operator request may add a hot slice without another Plan-Mode cycle only when it preserves frozen intent, scope and ledger decisions, adds no new contract/migration/security/rollback or execution-policy decision, carries all four slice fields and rewrites no active or completed unit; it is appended after the active slice or wave through the operational plan helper and the same addition is written to Engram. A material request becomes a recommended roadmap change or returns to native Plan Mode when the active outcome truly requires it. The first wave also answers what phase 3 could only record as a question — whether this project's bar tolerates being run concurrently — and a wave that degrades draws an offer to finish the remaining slices sequentially, an offer and never a gate. The orchestrator writes no code during execution — it cuts the worktrees, commits the green slices and delegates the merge — except the design-foundation slice (phase 4), where it runs Impeccable's design-doc generation itself; a front slice's applier payload carries the design docs plus the paths to Impeccable's `SKILL.md` and `reference/` playbooks, and its verify bar carries the pinned detector. Stop-the-line: breakage unrelated to the active slice — to the whole wave, under parallel — found mid-execution is named and handed to `oso-code:debug`, never fixed in passing, with the forked `oso-code:triage` skill establishing attribution first whenever no slice's diff plainly explains the red; declining is recorded in the ledger and the slice continues.
7. **Close** — when the user says they are happy: a change that ran in waves first clears what parallel leaves standing — every worktree of the change through `git worktree remove` and then `git worktree prune`, and only then its branches through the safe `branch -d`, since git refuses to delete a branch a standing worktree still has checked out — naming to the operator anything git refuses rather than forcing it. Then debt-sweep runs as a judge → fix loop inside Close (the `oso-code:debt-sweep` skill judges on two axes — code debt with fallow plus the clean-code rubric, and ledger conformance from the bare decisions + scope it is handed; debt findings go to the applier as a debt cleanup, readability and semantics only, never functionality, while conformance findings go to operator triage one at a time, each with its two readings for the operator to pick between — the CODE diverged, and the fix goes to the applier as judge findings, which may change behavior inside the finding they resolve; or the DECISION changed, and the ledger is amended by a dated entry beside the frozen one, never an edit of it — except `Unimplemented`, which is a slice's worth of work missing and returns to phase 6 as its own slice with its own failing check; re-judge until both axes are clean, and a `Conformance: skipped — no ledger provided` is never a pass, since it says the axis never ran: it blocks the green instead of opening it). On a front change, Impeccable's `audit` then runs its own audit → fix → re-audit loop: the applier fixes each finding as judge findings, the orchestrator re-runs the project's zero-warnings bar beside every re-audit, and the loop ends on the audit exit bar in `plugin/skills/_shared/front-surface.md` — Impeccable emits no `clean` token, so that bar translates its integrity verdict and severity bands — or on the operator accepting the residual, which is named in the ledger rather than dropped. Before any commit — if the ledger recorded a security derived category (auth/payments surfaces), offer and recommend a review of the pending working-tree diff through the forked `oso-code:security-pass` skill, relay its report verbatim, fix accepted findings through the applier, and re-run until clean or the operator accepts the residual; the operator decides — and what that review reads is the change since the base ref, since per-slice commits leave the pending working tree holding only what the close itself landed. A commit is part of the flow and is never asked for: phase 6 lands one per slice in both modes, and the close commits its own fixes the same way. PUSH and PR are the two that still require the operator to ask. Update the `oso/index` row to `status: done`; session summary to engram under a rich title.

## Mode 2 — `/quick` (fast iteration)

- **Micro-intent**: one exchange — what and what visible success looks like. If the orchestrator detects the change is substantial, it recommends `/plan` with the reason; the human decides. If the ask turns out to be a bug, it offers `oso-code:debug` instead.
- Rapid inline iteration with visible results (run the app, screenshot); breakage unrelated to the change is named and handed to `oso-code:debug`, never fixed in passing. On a front surface, quick reads the design docs and Impeccable's `SKILL.md`/`reference/` playbooks itself, and runs Impeccable's `init` or `document` as a direct step when the project has neither doc.
- On "done": quality pass — rubric verify + alignment apply + zero warnings, with the pinned design detector — its pin resolved from the npm CLI, whose release line is independent of the plugin's — and an Impeccable `audit` loop among the close checks on a front change, whose findings go to `oso-applier` as judge findings like the plan's, never inline, and whose accepted fixes re-run the project's checks before the commit gate unlocks. Before any commit, a change that touched data models, auth, or payments draws a pre-commit offer of the forked `oso-code:security-pass` review, re-run after accepted fixes until clean or the operator accepts the residual.

## Mode 3 — `/debug` (something broke)

Stop-the-line triage for a break — reproduce-first, minimal fix scope, no feature work riding along. Delegated like `/plan`'s execution; edits run under `mode=debug` (unrestricted; the commit gate still holds until verify is green).

1. **Reproduce** — a concrete repro (exact steps + observed vs expected) before any code, captured verbatim as diagnosis evidence and the regression-test seed. No repro → no fix: stop with ranked hypotheses; an operator "fix on hypothesis" override is recorded, and the regression test stays mandatory.
2. **Localize + reduce** — narrow to the failing layer with evidence (bisect, targeted logging), then reduce to the smallest still-failing case.
3. **Diagnosis freeze** — the triage exit bar: root cause, repro evidence, fix decision, named regression test — or a `Verify-exception: <reason>` on that line, only where the fix touches no code the suite can execute — zero-warnings commands, any override. Persisted once to `oso/{bug}/diagnosis` (no `oso/index` row — the index tracks changes, not bugs). Reverse detour (ADR-0040): when triage reveals a design flaw needing architecture or contract decisions, offer `oso-code:plan` — the operator decides, and on acceptance the diagnosis travels as intent input.
4. **Delegated fix/verify** — `oso-applier` fixes with the diagnosis packaged as its ledger; `oso-verifier` is launched with the fix criteria, the zero-warnings commands the diagnosis froze, the rubric path, and the diagnosis itself as fix-decision context — under that name and never "as ledger", since this flow freezes none and the recorded fix decision is the narrower bar in a ledger's place — and confirms the named regression test fails without the fix and passes with it, or reads the recorded `Verify-exception` in the test's place. Loop apply → verify until green. A fix on front surface adds the design payload and the pinned detector to that loop — never Impeccable's `init`, `document`, or an audit loop: a bug fix does not bootstrap a design system, and the regression test — or its recorded exception — stays the exit criterion.
5. **Close** — `oso-code:quality-pass` on the touched code, with `oso-code:debt-sweep` offered beside it — additive, never instead of it — only when the fix sprawled across many files, and the quality pass re-run over whatever cleanup that sweep lands; a pre-commit `oso-code:security-pass` offer if it touched data models, auth, or payments; session summary to engram; no commit of its own — the per-slice commit is `/plan`'s and this mode has no slices — and push/PR only if the user asks.

## Hooks (mechanical state and bounded approval transport)

- Block `git commit` while the slice/session verify is not green — two layers over the same state file: the git `core.hooksPath` pre-commit hook (`plugin/git-hooks/pre-commit`) at the commit's own boundary, and the PreToolUse Bash matcher for what a git hook never sees (`--no-verify`, `commit-tree`, `update-ref`).
- Block Edit/Write/MultiEdit/NotebookEdit and the named MCP writer tools (`mcp__fallow__fix_apply`) in mode 1 when no slice is active; `active_slice=none` is the disarmed sentinel. A parallel wave arms that one flag as `active_slice=wave-<n>` and every applier of the wave writes under it, because the gate cannot see which worktree an edit lands in.
- Runtime flags live in flat `key=value` files under `~/.local/state/oso-code/`, outside projects, keyed by a SHA-256 digest of `git rev-parse --path-format=absolute --git-common-dir` (ADR-0095). The same repository therefore reaches one file from its main checkout and every linked worktree; two agent sessions in that repository also share it, and the last writer's `session` value owns teardown. Worktree paths and audit events remain session-scoped. An absent state file allows silently; once armed, a state file that cannot be read denies.
- On Codex, `UserPromptSubmit` refuses `$oso-code:plan` outside native Plan Mode. Because Codex 0.146's hook field reports approval policy rather than collaboration mode, the rail attests the exact turn by binding `transcript_path` and `turn_id` to its host-generated `task_started` event, with the documented field as the compatibility fallback. That same resolver guards `Stop` capture, replanning feedback and the transition to native `Implement the plan.` approval. `Stop` creates the presented/current artifacts, approval promotes the immutable snapshot only for the same pending session, and pending `PreToolUse` keeps new local execution closed. Approved snapshots persist; `current.md` alone accepts recorded in-scope amendments.

## Tool policy

| Tool / convention | When | Never |
|---|---|---|
| fallow | Debt-sweep only, loaded by the debt-sweep subagent | Planning, slice verify, main context |
| context7 | Wired into executable prompts: the `oso-applier` (never-guess-a-signature contract) and the `/plan` decision rounds / `/quick` iterate steps verify library-dependent decisions against current docs before recommending | Restating docs the code already makes obvious |
| engram | Frozen decision ledger (one save), plan state (one upserted topic key), `oso/index` recall row (one upserted key per change, `status: executing` → `status: done`), session summary and discovered conventions/gotchas — all under rich titles (`{topic key} — {human description}`) | Explorations, intermediate phase artifacts, verbose progress |
| oso/preferences | First-run ask in `/plan` step 0, then read at every plan/quick start; natural-language changes update it via `mem_update` | Per-project scope (it is per-machine, `scope: personal`), asked in `/quick`, or re-asked once the observation exists |
| impeccable | Front surfaces only (shared trigger in `plugin/skills/_shared/front-surface.md`): design docs as applier conventions, the pinned design detector in the verify bar (pin resolved from the npm CLI per that file's recipe), Impeccable's `audit` at close on `/plan` and `/quick`, its findings routed through `oso-applier` in both modes and its loop ended by that file's exit bar | Non-front changes, `/debug` init/document/audit, skipping the design bar silently when the plugin is absent, and letting the loop end without naming the residual it leaves |

## Bootstrap responsibilities

1. Prerequisites (runtime) per OS: Linux, macOS, Windows.
2. MCP install and wiring verification: engram and context7 asserted connected; fallow wired for debt-sweep use but only reported, since nothing provisions the Rust it builds from and a hard check would make the one-step Windows path red by construction. The Impeccable plugin installs by default (`--no-impeccable` opts out, recorded as a marker file the installer writes and clears), and `verify.sh` asserts the plugin — a `note:` naming the opt-out instead, wherever that marker stands — plus the `npx impeccable` CLI behind a 20-second in-shell bound, since an unreachable registry would otherwise hang the report short of its summary.
3. Legacy cleanup: remove gentle-ai configs, hooks, skills, and CLAUDE.md blocks. Known duplication to kill: engram protocol (currently in three places). The persona is already consolidated in `plugin/output-styles/oso.md` — one place, no duplication to kill.

## Skill authoring rule

Every wrapper follows its host's current skill-authoring contract; neutral bodies remain valid under both adapters (ADR-0096). Before writing each skill, review how gentle-ai solved the equivalent prompt and harvest what works.

## Construction order

1. Monorepo skeleton, plugin manifest, slash-command skills (the `commands/` directory is legacy; `skills/<name>/SKILL.md` is the current format).
2. `/quick` mode first — simpler, fast visible value for the team.
3. `/plan` planning phases.
4. Hooks + runtime state.
5. Debt-sweep + adjusted rubrics.
6. Bootstrap with gentle cleanup.
7. Team pilot.
