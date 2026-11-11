# 0160 — OpenCode re-approval shows a harness-computed delta

Date: 2026-11-11
Status: accepted
Related: ADR-0159 (the OpenCode 2 adapter and the `permission.assert` approval this extends), ADR-0033 and ADR-0011 (`ExitPlanMode` as the Claude Code gate, unchanged), ADR-0112 (feedback amending a pending plan, the Claude-era answer to the same problem)
Source: the change ledger `oso/plan-approval-delta/ledger`; the adapter and state tests of this change, and `core/test/certify/opencode-v2-plan-delta.test.ts` driven against the real OpenCode 2.2.6 binary

## Decision

**On OpenCode, re-approving a held plan takes two calls of `oso_plan_approve`. The first returns the delta the harness computed and raises no prompt; the second, with identical bytes from a later turn opened by a later user message in the session, in practice the operator's next one, raises the one authorization prompt bound to the digest of the full new document. Claude Code is unchanged.**

### Why the first call returns the delta

The operator re-read the whole plan on every material change, so a one-line revision cost a full re-read. The obvious place for a delta is the authorization prompt itself, but what OpenCode renders there was never measured: every measurement of the prompt is headless. The tool result is the one channel the model is guaranteed to receive. So the first call returns the delta as its result, the model relays it verbatim as turn-ending text, and the prompt comes only on the second call. The delta summary also rides in the prompt metadata, best effort.

### The delta

- **By section and slice, as a total partition.** Every heading section of the held and the new document, and every slice block inside one, is exactly one segment: changed, added, removed, unchanged or format-only, with moves marked. Joining the non-added segments in base order reconstructs the held document byte for byte, and joining the non-removed ones in next order reconstructs the new one; a property test holds that invariant. A document with no slice blocks gets a section-level delta.
- **Format-only** means the two bodies differ and are equal once every whitespace run collapses to one space and the ends are trimmed.
- **The base is the plan in force, the held immutable snapshot on disk** — the approved snapshot, or the presented one when the prompt was refused before a first grant — never a document presented since, never `current.md` and never text the model supplies. Operational amendments in `current.md` that the new document does not contain are listed in their own section; nothing carries over automatically.

### The state

- The first call writes the immutable `presented-<digest>.md` snapshot and three keys, `plan_presented_digest`, `plan_presented_base` and `plan_presented_turn`, through the core `present-plan` verb, and touches no other plan key. A document matching only an older presentation, or one over a different base, is a new first call.
- The turn is the id of the user message that started the calling assistant message's turn, read through the host session API as the nearest earlier message of type `user` before the calling message in `session.context`. In practice that is the operator's next message; the host marks a message a plugin admits through `session.prompt` the same way, as named below. On OpenCode 2.2.6 one turn spans several assistant messages, one per step, so an assistant message id would let the next step of the same turn pass. When the host cannot resolve that user message, the call fails closed and writes nothing; it never falls back to the assistant message id.
- The second call is refused when its turn equals `plan_presented_turn`. On the grant the core `supersede-plan` verb writes a new immutable approved snapshot, keeps the previous one as history, replaces `current.md`, increments `plan_revision` and clears the presented keys. Neither verb has an `oso-state` CLI form.
- The prompt always appears; no classification of the delta skips it. A refused prompt changes nothing. Re-sending the document that is already the approved plan raises no prompt and changes nothing.
- Supersede happens only between slices. With a slice or wave active the first call is refused with the state's message, so work in flight is never disarmed.
- When the held plan is readable but the delta cannot be computed, the two steps stand with a notice naming the cause in place of the delta: the model tells the operator the delta was unavailable and that confirming approves the whole new document, the prompt metadata carries the cause instead of a delta digest, and a refusal changes nothing.
- Only when the held plan itself cannot be read does the tool present the whole plan through the one-call path with that notice: it captures before the prompt, so a refusal there leaves the plan pending. This is the one accepted exception to a refusal changing nothing.
- The digest binding is unchanged: the prompt's resource is the sha256 of the full new document. The delta is display-only, and the grant result repeats its digest.
- Both verbs re-hash what they store. `present-plan` refuses a digest that is not the sha256 of the document it receives, and `supersede-plan` re-hashes the presented snapshot under the lock and refuses, writing nothing, when its bytes no longer match the granted digest.

### Named residuals

- **The operator reads the model's relay.** The delta reaches the operator through the model's turn-ending text, not from the harness directly, and what OpenCode renders for tool results and prompt metadata is unmeasured. The later-turn boundary, the summary in the prompt metadata and the delta digest in the grant result narrow this; none closes it.
- **The certify suite carries state between two host processes.** The adapter's Cleanup removes the plan state file when the host process ends, so each headless run starts without the held plan. The suite restores the state file between the two runs from the host's own `execute.after` snapshot. In real use both turns happen in one host process; that carry-over is simulated, not measured.
- **Any later user message opens the later turn.** The harness checks that a later message of type `user` exists, not who typed it. Measured on OpenCode 2.2.6, a message a plugin admits through `session.prompt` during a turn, delivered as a steer, counts too: the adapter's own unattended continuation under `auto=running`, or any co-installed plugin. Compaction and synthetic input are separate message types and do not count. Nothing is approved without the operator: the grant still requires the operator's answer to the host prompt, bound to the digest of the full new document, and a refusal changes nothing. A plugin that can call `session.prompt` can already set the outcome of a permission evaluation, so it is inside the gate's trust boundary already. The model has no direct path: the adapter exposes no tool that posts into the model's own session.

## Consequences

- The OpenCode plan and roadmap references describe the two steps, and `opencode-reapproval-relays-a-harness-delta.test.ts` holds that wording.
- The nightly drives seven `opencode-v2-*` suites, `opencode-v2-plan-delta` among them; `docs/parity-opencode.md` records what it measured.
- A first presentation with nothing held is unchanged: one call, one prompt.
- The certify suite also makes both calls inside one prompt: the first returns the delta, and the second is refused as the same operator turn with no prompt raised.
- The Claude-side bundles `plugin/bin/oso-state` and `plugin/dist/oso-state.js`, and `bootstrap/hook-hashes.txt`, are regenerated from the shared core and may change bytes with no change in Claude behavior. Claude never writes the `plan_presented_*` keys.

## Security review

Two security reviews ran over this change.

The first found two defects, F1 and F2, both fixed in slice S6 and described above. F1, medium: the later-turn rule was keyed on the assistant message, which a next step of the same turn changes. F2, low: supersede promoted the presented snapshot without re-hashing it.

The second, measured against the real OpenCode 2.2.6, returned one low finding: this record and the OpenCode references said the later turn is opened by the operator's next message, while the harness accepts any later user message. Slice S7 corrected that wording, and the operator accepted the boundary as a residual.

The accepted residuals:

- The whole-plan path checks for an active slice outside the lock, as the first capture always has; moving it would change Claude's capture.
- An unreadable held plan still captures before its prompt, the one exception to a refusal changing nothing.
- The operator reads the model's relay of the delta, as named above.
- The certify suite carries the state between two host processes, as named above.
- Any later user message opens the later turn, including a plugin-admitted steer, as named above.
- Anything that can write the state root can rewrite the state and every snapshot; the re-hash turns a swapped presented snapshot into a refusal and protects nothing beyond it.
