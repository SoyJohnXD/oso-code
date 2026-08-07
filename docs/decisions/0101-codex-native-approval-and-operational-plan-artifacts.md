# 0101 — Codex native approval drives an immutable snapshot and mutable operational plan

Date: 2026-08-04
Status: accepted
Amends: ADR-0033 (Codex now composes its native approval UI instead of inventing a second operator token), ADR-0094 (the verified lifecycle evidence includes the native `Implement the plan.` prompt), ADR-0097 (the approval degradation is narrower hook coverage, not a second non-native approval interaction)
Reconciled: applied — Codex requires native Plan Mode before the skill starts, binds its native approval prompt to the pending digest, persists separate approved and operational artifacts, and permits only operator-requested in-scope hot slices outside a new planning cycle.
Source: the first live Codex 0.146.0 plan run after release 0.18.2 and the operator's 2026-08-04 lifecycle decision

## Decision

`$oso-code:plan` does not enter Plan Mode. The Codex `UserPromptSubmit` hook rejects that operator invocation unless the exact turn attests native Plan Mode under ADR-0103, and the wrapper repeats the refusal before phase 0 for an installation whose hooks have not yet been trusted. The operator enters `/plan` or uses Shift+Tab; Oso never prints a slash command as though it executed one.

The Codex adapter removes `APPROVE OSO PLAN`. A valid Plan-Mode presentation ends in one hidden versioned marker, and the Stop hook binds its wire digest while persisting the human document outside the repository. Under ADR-0104, final means the final logical line: Stop may serialize no suffix or one host terminal LF, and the digest still covers the exact raw representation. Codex's native approval UI then submits the exact observed prompt `Implement the plan.` after changing the turn to a non-Plan mode. `UserPromptSubmit` consumes that phrase only when the same repository and hook session own a pending digest. Without pending Oso state, the common phrase is ordinary Codex conversation and the hook is invisible.

Plan artifacts live under `~/.local/state/oso-code/plans/<repository digest>/`. A pending presentation is `presented-<approval digest>.md`; successful native approval renames it to immutable `approved-<approval digest>.md`; `current.md` is the mutable operational copy. The state file records both paths and a revision. No artifact enters the project repository, Claude's `ExitPlanMode` adapter is unchanged, and approved snapshots are not automatically deleted.

During execution, an explicit operator request may append a hot slice without returning to Plan Mode only when it preserves the frozen intent, scope and ledger decisions; adds no new contract, migration, auth/security/rollback surface, dependency policy, base ref or execution-mode decision; carries the complete slice fields; and does not rewrite active or completed work. The state helper appends the dated amendment to `current.md`, increments the revision and reopens verification; the orchestrator updates the Engram plan observation with the same slice. A material request is recommended into an Engram roadmap change. If it is required for the active outcome, the plan returns to native Plan Mode for fresh approval.

## Consequences

- The operator uses one approval interaction: Codex's native control.
- Oso still binds approval to exact bytes and keeps new local tools closed while that digest is pending.
- A common native prompt cannot be globally reserved, so missing pending state is an allow/invisible result rather than an approval error.
- The immutable snapshot preserves audit evidence while `current.md` makes bounded execution amendments durable and inspectable.
- Hosted tools, specialized paths and writes to an already-running process still do not cross the complete local hook rail; the parity degradation remains, but its UX no longer duplicates native approval.
