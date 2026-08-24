# 0155 — A model-less `variant:` is dropped at runtime, so D15's `-max` siblings are closed rather than built

Date: 2026-08-23
Status: accepted
Supersedes: the second half of this change's frozen ledger decision D15 — the five `-max` sibling agent files declaring only `variant: max`. D15's first half stands as implemented: the eight `opencode/agents/*.md` files declare neither `model` nor `variant`, so a child inherits what the operator is running
Reconciled: applied — nothing is built, and that is the decision. The eight agent files are unchanged and no `-max` sibling exists
Source: this change (opencode-runtime-parity), slice 23; measurement against the pinned host, OpenCode 1.18.20

## Decision

**The five `-max` sibling agents D15 asked for are not built. A `variant:` declared without a `model` beside it is dropped when the host reads the agent, and the task path forwards the parent session's own variant, so the five files would have configured nothing and launched nothing.**

D15 wanted two things and the measurement separates them. The first — that an `oso-*` agent declare no model, so a delegation runs on whatever the operator is paying for rather than on a pin the harness chose for them — is real, is implemented, and is what the eight files under `opencode/agents/` do today. The second asked for a `-max` sibling of five of them carrying `variant: max` and nothing else, so an operator could route one delegation to the stronger variant by name.

On 1.18.20 that sibling is inert twice over: the host drops a `variant` that arrives with no model to attach it to, and the task path a delegation travels forwards the PARENT's variant regardless. Five files, five slash-command-visible names, and no behavioural difference between calling one and calling its plain sibling — configuration a reader would reasonably believe in and a run would ignore.

Leaving the half unimplemented was the alternative and it was rejected for the reason this repo keeps a decision log at all: an open conformance finding at the close is a claim that something is owed, and nothing is owed here. The measurement retires the ask; it does not defer it.

## Consequences

- A later host release that attaches a model-less `variant` to the session it launches reopens this as a new decision, with its own measurement. This file records what 1.18.20 does, not what OpenCode must always do.
- An operator who wants a delegation on the stronger variant runs the parent session on it: the task path forwards the parent's variant, which is the same mechanism that made the siblings redundant.
- `docs/parity-opencode.md`'s agent rows are unaffected — they record that the harness pins no model per agent, which is D15's first half and still true.
