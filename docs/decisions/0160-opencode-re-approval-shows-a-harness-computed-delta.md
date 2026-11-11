# 0160 — OpenCode re-approval shows a harness-computed delta

Date: 2026-11-11
Status: accepted
Related: ADR-0159 (the OpenCode 2 adapter and the `permission.assert` approval this extends), ADR-0033 and ADR-0011 (`ExitPlanMode` as the Claude Code gate, unchanged), ADR-0112 (feedback amending a pending plan, the Claude-era answer to the same problem)
Source: the change ledger `oso/plan-approval-delta/ledger`; the adapter and state tests of this change, and `core/test/certify/opencode-v2-plan-delta.test.ts` driven against the real OpenCode 2.2.6 binary

## Decision

**On OpenCode, re-approving a held plan takes two calls of `oso_plan_approve`. The first returns the delta the harness computed and raises no prompt; the second, from a later turn with identical bytes, raises the one authorization prompt bound to the digest of the full new document. Claude Code is unchanged.**

### Why the first call returns the delta

The operator re-read the whole plan on every material change, so a one-line revision cost a full re-read. The obvious place for a delta is the authorization prompt itself, but what OpenCode renders there was never measured: every measurement of the prompt is headless. The tool result is the one channel the model is guaranteed to receive. So the first call returns the delta as its result, the model relays it verbatim as turn-ending text, and the prompt comes only on the second call. The delta summary also rides in the prompt metadata, best effort.

### The delta

- **By section and slice, as a total partition.** Every heading section of the held and the new document, and every slice block inside one, is exactly one segment: changed, added, removed, unchanged or format-only, with moves marked. Joining the non-added segments in base order reconstructs the held document byte for byte, and joining the non-removed ones in next order reconstructs the new one; a property test holds that invariant. A document with no slice blocks gets a section-level delta.
- **Format-only** means the two bodies differ and are equal once every whitespace run collapses to one space and the ends are trimmed.
- **The base is the held immutable snapshot on disk** — the approved snapshot, or the presented one when the prompt was refused before a first grant — never `current.md` and never text the model supplies. Operational amendments in `current.md` that the new document does not contain are listed in their own section; nothing carries over automatically.

### The state

- The first call writes the immutable `presented-<digest>.md` snapshot and three keys, `plan_presented_digest`, `plan_presented_base` and `plan_presented_turn`, through the core `present-plan` verb, and touches no other plan key. A document matching only an older presentation, or one over a different base, is a new first call.
- The second call is refused when its turn id equals `plan_presented_turn`. On the grant the core `supersede-plan` verb writes a new immutable approved snapshot, keeps the previous one as history, replaces `current.md`, increments `plan_revision` and clears the presented keys. Neither verb has an `oso-state` CLI form.
- The prompt always appears; no classification of the delta skips it. A refused prompt changes nothing.
- Supersede happens only between slices. With a slice or wave active the first call is refused with the state's message, so work in flight is never disarmed.
- When the delta cannot be computed, the tool presents the whole plan through the one-call path with a notice naming the cause, and the model tells the operator the delta was unavailable.
- The digest binding is unchanged: the prompt's resource is the sha256 of the full new document. The delta is display-only, and the grant result repeats its digest.

### Named residuals

- **The operator reads the model's relay.** The delta reaches the operator through the model's turn-ending text, not from the harness directly, and what OpenCode renders for tool results and prompt metadata is unmeasured. The turn boundary, the summary in the prompt metadata and the delta digest in the grant result narrow this; none closes it.
- **The certify suite carries state between two host processes.** The adapter's Cleanup removes the plan state file when the host process ends, so each headless run starts without the held plan. The suite restores the state file between the two runs from the host's own `execute.after` snapshot. In real use both turns happen in one host process; that carry-over is simulated, not measured.

## Consequences

- The OpenCode plan and roadmap references describe the two steps, and `opencode-reapproval-relays-a-harness-delta.test.ts` holds that wording.
- The nightly drives seven `opencode-v2-*` suites, `opencode-v2-plan-delta` among them; `docs/parity-opencode.md` records what it measured.
- A first presentation with nothing held is unchanged: one call, one prompt.
