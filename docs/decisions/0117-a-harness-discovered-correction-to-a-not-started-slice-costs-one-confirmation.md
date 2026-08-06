# 0117 — A harness-discovered correction to a not-started slice costs one confirmation, not a re-approval

Date: 2026-08-05
Status: accepted
Implemented-in: plugin/skills/_shared/platform/codex/plan.md, tests/plugin-lint.sh, tests/hooks-test.sh, docs/blueprint.md, README.md
Reconciled: applied — the Codex plan platform file gains a third amendment lane beside the material-change rule and the hot-slice lane, gated on the slice being unstarted, an evidence citation, one operator confirmation, and the same `amend-plan` recording mechanics the hot-slice lane already uses; `tests/plugin-lint.sh` gained a rule (17) holding the lane to all four conditions.
Source: the same incident ADR-0116 traces, its second defect — the model's own words while working inside the gap it exposes: "aunque en este caso se sienta ceremonioso". D18 (forward recovery), the same ledger decision `docs/decisions/0113-stale-state-warning-is-scoped-to-this-repositorys-own-file.md` already applied to a different mechanism in this change.

## Decision

A third lane, beside the material-change rule and the hot-slice lane, both of which stay exactly as they are today: a correction the HARNESS ITSELF discovers, to a slice that has NOT STARTED, may amend `current.md` through one operator confirmation instead of a full return to Plan Mode, when every condition holds:

- The target slice carries no `active_slice` history and no `[x]` in the Engram plan. A slice already active or completed keeps the material-change route.
- The correction CITES the evidence that disproves the slice's premise — the file and line of the installed artifact, the way `docs/decisions/0116` cites `reference/init.md` and `SKILL.md`'s Commands table for the incident both decisions correct. An uncited correction is never eligible: it would be the harness rewriting an approved contract on its own assertion, the exact discipline the operator objected to losing.
- The citation and the corrected fact are presented to the operator, who CONFIRMS in one line — never a re-read of the whole plan.
- That confirmation, not the harness's own finding, is what authorizes the amendment, exactly as the operator's own request authorizes a hot slice.

On confirmation it reuses the hot-slice lane's own mechanics exactly — `amend-plan` against the approved snapshot, `oso-state show` read back, the same Engram and ledger update. `plugin/bin/oso-state`'s `amend-plan` already carries two callers off one verb, branching only on `plan_approval` state (ADR-0112), and logs its own event (`log_event plan-amended`) on every call regardless of caller; a third distinct classification would be new machinery a lane this narrow does not earn, so this one is authorized to use the same `approved`-state branch the hot-slice lane already exercises, under its own tighter conditions above.

Any single condition missing takes the material-change route instead — an uncited correction especially.

## Context

The incident's second defect: the amendment rail had a lane for an operator-requested hot slice and a lane for a full material change, and nothing for a correction the harness itself finds mid-execution, on work that has not started. That correction matches neither existing lane — it is not operator-originated, and it does rewrite — so the only route was the full round trip, and the model conceded the gap while working inside it rather than having anywhere narrower to put the fix.

The mechanics this lane needs already existed before this decision: `amend-plan`'s two-branch shape and its unconditional event log (ADR-0112) are what let this lane compose rather than invent. What was missing was the harness's permission and conditions to use them for a correction it originates rather than the operator — permission this decision states, tightly enough that it cannot become a second hole in the approval rail beside the one it closes.

This lane is Codex-specific by construction, not a choice made here: Claude Code carries no operational plan artifact for a correction like this to amend at all — its approval is `ExitPlanMode` over the plan argument directly, with no persisted `current.md`, digest, or `amend-plan` mechanism the way Codex's own material-change rule and hot-slice lane already document in this same file. The material-change RULE itself is neutral, stated once in `bodies/plan.md` §5; only the amendment MECHANISM — `current.md`, `plan_revision`, `amend-plan` — is Codex's own, and this lane extends that mechanism, so it lives beside it.

## Consequences

- A correction discovered mid-execution, on work that has not started, costs one line instead of a full plan re-presentation.
- The citation requirement is the check against the exact failure mode the operator named: nothing lands on the harness's own say-so.
- No new `oso-state` classification, no new file: the third lane composes the existing approved-state `amend-plan` branch under tighter, harness-specific conditions.
- Claude Code is untouched: it has no operational plan artifact for a lane like this to extend.
