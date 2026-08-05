# 0107 — Plan approval keeps its own session key apart from ownership, and the catch-all scopes to it

Date: 2026-08-05
Status: accepted
Implemented-in: plugin/hooks/lib.sh, plugin/hooks/block-unknown-tool.sh, plugin/hooks/cleanup-state.sh, plugin/bin/oso-state, plugin/skills/_shared/platform/codex/plan.md, bootstrap/hook-hashes.txt, tests/hooks-test.sh, docs/blueprint.md
Reconciled: applied — `capture-plan` now writes `plan_approval_session` beside `session`; `approve-plan`, `cancel-plan` and `amend-plan` compare against the new key; the catch-all's pending check is scoped to it; SessionEnd gained a second sweep that clears an orphan by that key; `state_says` grew an optional owner-key argument rather than a new sibling.
Source: the operator-reported trap — a stale `plan_approval=pending` denied `Bash` itself, with no local escape, in a repository no session currently owned

## Decision

`session` stays exactly what ADR-0095 made it: the OWNERSHIP identity, read by the catch-all's own-tooling paths, `block-commit-until-green.sh`, `block-edits-without-slice.sh`, teardown and the git `pre-commit` hook, and overwritten on every `oso-state set` by whichever caller wrote last — deliberately, since Codex's fixed `OSO_AGENT=1` marker (`plan.md:59`) makes "last write wins" the only ownership rule a host with no per-call session id can keep.

A pending plan approval needs a different identity: which session may approve, cancel or amend it — call it the APPROVAL identity. `session` cannot serve both. Codex's model-issued writes carry no real session (see below), so any state write issued while a plan is pending or approved — and Codex's own operational-amendment flow requires exactly that, per `plan.md`'s hot-slice section — overwrites `session` with the fixed marker, unbinding it from the session that actually presented the plan. The catch-all's own pending check, if scoped to that same drifting key, would then deny a session its own pending plan, or worse, keep denying every session in the repository once the marker orphans the file at SessionEnd (the trap this decision closes).

**A second key, `plan_approval_session`, carries the approval identity instead.** Only `capture-plan` writes it, with the real payload session id the Stop hook passes — never a value from `${OSO_AGENT}`. `approve-plan`, `cancel-plan` and `amend-plan` compare against it instead of `session`; their rejection text is unchanged. No verb clears or reassigns it: `oso-state` has no delete, so an approval cycle's identity lives until the whole state file is dropped — by `cancel-plan`, or by SessionEnd — exactly as `session` already does for ownership.

**The catch-all gate scopes its pending check to the new key.** `block-unknown-tool.sh` already reads the real payload session at `json_field "$input" session_id` (`:24`), not `hook_session`, so it has the correct value in hand; it now requires `plan_approval_session` to equal that value before denying. The order is unchanged — the check still runs before the allowlist, and still denies every local tool, `Bash` included, for the session that owns the pending plan: that is the documented contract (`plan.md:21`), not the defect. The defect was scope — a repository-wide pending denying sessions that never presented anything — and scoping is the whole fix.

**`state_says` gains an optional fourth argument, `owner_key`, rather than a new sibling function.** The existing `session` parameter already reached every call site but was spent only on the unreadable-state error text; a caller that names `owner_key` now also spends it on an equality check against that key's stored value. `block-commit-until-green.sh` and `block-edits-without-slice.sh` call the unchanged three-argument form and keep reading repository-scoped facts (`verify_green`, `mode`, `active_slice`) on purpose — those are ownership facts, not approval ones, so they get no fourth argument and no behavior change. A brand-new predicate function would have had exactly one caller and duplicated `state_says`'s own unreadable-state handling; extending the primitive already used by three gates reuses that handling instead of forking it.

**SessionEnd gained a second, narrow sweep.** The existing sweep matches `session` against `hook_session()`, which is `OSO_AGENT` when set — so on Codex it can never equal the real ULID `capture-plan` recorded, and a pending plan a session never got to resolve outlives it, orphaned. The new sweep reads the SessionEnd payload's own real `session_id` — never `hook_session` — and drops the whole state file (matching how `cancel-plan` already clears a pending: full-file removal, because there is no key-level delete) wherever `plan_approval_session` names that same session. It is fail-open like the rest of the hook: nothing about it can cost the session its ordinary ownership-keyed cleanup, because it runs as an independent, best-effort pass alongside that cleanup rather than gating it.

### Rejected: a hook→model bridge

The alternative once on the table was exposing Codex's real hook session id to the model, so every model-issued write could carry it the way Claude's already does, and `session` could stay the single identity for both roles. Rejected for three reasons:

1. **Codex does not expose it.** `plan.md:59` states this deliberately — the fixed `OSO_AGENT=1` marker exists precisely because the host gives the model no session id to carry. A bridge would have to manufacture one, which is not a hook reading a host fact but a hook inventing a claim.
2. **It would break `plugin/git-hooks/pre-commit`.** That hook has no JSON payload at all — it resolves its session from `${CLAUDE_CODE_SESSION_ID:-${OSO_AGENT:-}}` in its own process environment (`pre-commit:39`), by design, because a git hook speaks git's protocol, not PreToolUse's. A bridge that redefined what the shared marker means, or that required a per-call model-supplied identity, would leave this hook — the one gate a human's own commit still passes through — reading a fact the bridge never touches or a fact it can no longer trust.
3. **It moves the trust boundary from hook to model.** Every identity this rail currently gates on is a host-supplied fact: a payload field a hook reads directly, or an environment variable the host process sets before the model ever runs. A bridge makes session identity a model-supplied string instead — the one thing a gate exists to constrain becomes the one thing it would have to take on faith.

A second key costs one more field in the state file and three comparisons moved from one key to another. A bridge would have cost the git hook's independence from the model and the rail's own trust model. The former is what shipped.

## Consequences

- A stale or foreign pending can no longer deny a session that never presented anything — including `Bash`, so `oso-state clear` is reachable again from inside the session actually blocked.
- A session's own pending plan still denies that session's own tools until native approval or `CANCEL OSO PLAN`, unchanged from the documented contract.
- A model-issued state write under the shared Codex marker can overwrite `session` freely without ever costing a pending or approved plan its identity, because that identity no longer lives in the key such a write touches.
- SessionEnd now reaches an orphaned pending that the ownership-keyed sweep structurally cannot see on Codex, closing the trap at its source instead of only at the gate that used to fall into it.
- `state_says` remains one function with one unreadable-state error path for all four call sites, instead of splintering into a scoped and an unscoped implementation of the same grep.
