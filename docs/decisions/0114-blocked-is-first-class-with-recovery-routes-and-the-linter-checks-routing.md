# 0114 — `blocked` is a first-class verdict with recovery routes, and the linter checks routing, not mention

Date: 2026-08-05
Status: accepted
Reconciled: applied — the four judge bodies each declare `blocked` in their own `end with exactly one of:` vocabulary; `oso-integrator` gained an equivalent `## Verdict` block; every caller of the five gained an explicit forward route rather than a bare mention; and `tests/plugin-lint.sh`'s call-site rule now requires every token of an axis a caller engages, with a routing verb beside it, and reaches agent files as emitters.
Source: five Codex-only surfaces instructed a judge to terminate on `blocked` with no neutral body declaring it and no caller reading it — `codex/agents/oso-debt-sweep.toml:7`, `oso-doubt-pass.toml:7`, `oso-triage.toml:7`, `oso-security-reviewer.toml:7`, and `plugin/skills/_shared/platform/codex/security-pass.md:16` — leaving `plugin/skills/_shared/bodies/plan.md`'s security-pass re-run loop with no reachable exit; three sibling drifts of the same shape (`Quality Pass: blocked`, `oso-integrator`'s `status: blocked`, `Security Pass: findings`); and the pre-freeze doubt pass on this change, which warned that formalizing `blocked` without routes would create "four new sanctioned halts" and that a stricter linter would let "callers gain mechanical token lists that satisfy the lint while handling nothing"

## Decision

**`blocked` becomes part of the vocabulary of every judge that can emit it, and every caller gets a route that DOES something — never a synonym for stop.**

- `plugin/skills/_shared/bodies/debt-sweep.md` gains a whole-report `Debt Sweep: blocked` verdict (a third, standalone `end with exactly one of:` block) that pre-empts both axes when the assignment itself never reached the judge whole.
- `plugin/skills/_shared/bodies/doubt-pass.md`, `triage.md`, `security-pass.md` each gain `blocked` as a third (`triage.md`: fourth) member of their existing single-axis vocabulary.
- `plugin/agents/oso-integrator.md` gains a `## Verdict` block — `status: done` / `status: conflict` / `status: blocked` — naming what was already true of its report shape but never declared as one vocabulary.
- `plugin/skills/_shared/bodies/quality-pass.md` already declared `Quality Pass: blocked`; only its callers were missing a route.

The route differs by what `blocked` MEANS at that judge, read from its role file and body rather than assumed uniform:

| Judge | What `blocked` means | Route |
|---|---|---|
| debt-sweep, doubt-pass, triage | The Codex role's payload never carried the skill wrapper path or the ARGUMENTS (`codex/agents/oso-*.toml`) — an orchestrator launch defect, not a finding about the change. | Resolve what the judge named missing and invoke it again fresh; never treat it as evidence about the wave, the ledger, or the code. |
| security-pass | Either the same missing-payload-field launch defect, OR the native reviewer itself could not run (missing, unauthenticated, unreachable, or exited unsuccessfully — `platform/codex/security-pass.md:16`), which is an environment problem, not a launch defect. | Resolve what it names missing (a launch field, or the native reviewer) with the operator, then invoke the judge again fresh. The route names both causes rather than picking one, because the caller only ever sees the token and the reason text — never silently substitute the fallback for a native failure, which the platform file already forbids. |
| quality-pass | It ran (inline, no fork) and could not resolve some findings itself — an unresolved judgment call, not a transport failure. | Present the unresolved findings to the operator with options and tradeoffs, apply their decision the way quality-pass's own Apply step already does, then re-run the judge until it returns `passed`. |
| oso-integrator | The wave payload the orchestrator built does not match what git actually holds — a branch, a worktree, or a slice's commit the orchestrator's own bookkeeping got wrong. It is not one of the three wave-failure classes ADR-0084 enumerates, because nothing about the WAVE failed; the orchestrator's own record of it did. | Report the mismatch to the operator with the exact questions the integrator returned, since only the operator can say how the missing state is recovered; re-invoke `oso-integrator` with the corrected payload once resolved. Never guess a subset of the wave to merge. |

Two routes share a shape (resolve-and-reinvoke) and two do not (quality-pass's operator-mediated fix-and-rerun, oso-integrator's operator-mediated payload correction), because the shape follows the cause: a transport-layer defect the caller itself introduced is fixed and retried without troubling the operator's judgment; a defect in the environment, in an unresolved finding, or in the orchestrator's own state record needs the operator's decision before anything reruns.

The three sibling drifts close the same way:

- `Quality Pass: blocked` — `bodies/quick.md` and `bodies/debug.md` each gain the route above, next to where they already invoke quality-pass.
- `oso-integrator`'s `status: blocked` — `bodies/plan.md`'s "Merge the wave" paragraph gains the route above, adjacent to (never inside) ADR-0084's three-class failure routing, which stays exactly three classes because none of them is this.
- `Security Pass: findings` — never named verbatim by any of the three callers (`bodies/plan.md`, `quick.md`, `debug.md`), which all looped on bare `clean` and "the residual findings" without the compound token. All three now name it and route it: the operator chooses between fixing through the existing loop and explicitly accepting the residual, exactly what the prose already implied but the token never spelled.

**`tests/plugin-lint.sh`'s call-site vocabulary rule moves from "at least one token, file-scoped presence" to "every token of an axis a caller engages, line-scoped and paired with a route verb."**

- Tokens are read per AXIS (one `end with exactly one of:` block) instead of flattened into one bag per emitter, because an emitter can hold several axes that never resolve together — debt-sweep's debt findings and ledger conformance both run on every invocation, and a whole-report `blocked` axis pre-empts either. A caller's coverage of one axis is one of a small enumerable set of shapes: untouched (flagged, unless the axis carries a `: skipped` token and the caller names only that — the one legitimate partial read, preserved from the prior rule for `/debug`'s Conformance axis, which never receives a ledger to judge and has no reason to name the two outcomes it structurally cannot reach); partial (flagged, naming what is missing); complete-but-missing-skip (flagged, unchanged from the prior rule); or complete.
- A complete axis is checked once more: every one of its tokens must appear on a LINE that also carries one of a fixed set of recovery verbs already native to this repo's own routing prose (resolve, relaunch, invoke, launch, route, report, operator, offer, apply, fix, escalate, retry, loop, and related forms). A token named with nothing beside it fails here, which is what makes a bare, mechanically-satisfying token list — the shape the doubt pass predicted — rejectable rather than merely discouraged.
- Agent files join skill bodies as emitters, but only as far as an agent file volunteers a vocabulary: a plain `status: done|conflict|blocked` line is too generic a word to grep safely across a whole file, so an agent counts as an emitter only once it carries the SAME `end with exactly one of:` block a skill body already uses. `oso-integrator` now does; `oso-applier` and `oso-verifier`'s differently-shaped `status:`/`verdict:` report lines stay outside this rule's reach, exactly as a skill with no verdict block already stays outside the rule above it.

## What the rule cannot check

Stated rather than left implicit, per this change's own bar:

- The routing-verb pairing is LINE-scoped, not clause-scoped: it proves a route verb sits on the same physical line as the token, never that the verb actually describes what happens to THAT token rather than an unrelated action sharing its long paragraph-line. This repo writes call sites as dense, single-line paragraphs, which is exactly what keeps the heuristic from firing on the terse, itemized shape a gamed caller would actually produce — but it is a heuristic, not a proof of correctness.
- Codex-side vocabulary checking for debt-sweep, doubt-pass, triage, and security-pass is unchanged and was already vacuous before this decision: none of `bodies/plan.md`'s bound Codex sources carry the `` `oso-code:<emitter>` `` identity these four judges would need for the Codex caller-detection branch to fire at all (Codex reaches them through `oso-*` custom roles via `subagents.md`, a file no wrapper's reference regex resolves). This is a pre-existing gap this decision did not create and does not close; it was out of scope for a `blocked`-routing change and would require rethinking how Codex names a forked judge as a caller-detectable identity.
- An agent's vocabulary is invisible to this rule until the agent file itself states an `end with exactly one of:` block. This is a deliberate scope limit, not blindness: forcing every `status:`/`verdict:` line in every agent file into this rule's reach would also pull `oso-applier` and `oso-verifier` in, whose already-correct, differently-phrased routing this decision does not touch.

## Consequences

- `bodies/plan.md`'s security-pass re-run loop (`RE-RUN the security-pass judge until it returns clean or the operator explicitly accepts the residual`) now has a reachable exit on `blocked` instead of running forever against a token neither `clean` nor a residual finding set.
- A caller that adds a new emitter reference without a route for one of its tokens fails lint with the missing token named, instead of passing silently because some other token of the same emitter happened to be present elsewhere.
- A caller that pastes a bare, mechanically complete token list to satisfy this rule fails it for that reason specifically — the message names which tokens carry no route.
- `docs/blueprint.md`'s index gains this decision under the existing 2026-08-05 — codex-fluidity heading.
