# 0104 — Codex plan marker allows one host terminal LF

Date: 2026-08-04
Status: accepted
Amends: ADR-0101 (the wire-exact approval digest distinguishes transport bytes from the marker's logical terminal-line contract)
Implemented-in: docs/blueprint.md, docs/parity-codex.md, docs/decisions/0101-codex-native-approval-and-operational-plan-artifacts.md, README.md, CHANGELOG.md, plugin/skills/_shared/bodies/plan.md, plugin/skills/_shared/platform/codex/plan.md, plugin/hooks/capture-plan-approval.sh, tests/hooks-test.sh, bootstrap/hook-hashes.txt
Reconciled: applied — Stop accepts the final marker with zero or one host terminal LF, reconstructs marker-only native Plan renderer splits from the unique exact-turn Plan item, binds the exact approval content, exposes conditional planning dispositions, and forbids blind unchanged retries.
Source: the live Codex rollout `019fce3d-e58a-7d90-872a-20458d9f3442`, its two `plan-approval-capture-blocked` events, and the operator's 2026-08-04 repair decision

## Decision

The assistant contract is logical: the v2 approval marker is the exact final logical line of a non-empty plan document, appears once, and has no model-authored content after it. Codex Stop may represent that terminal placement in `last_assistant_message` with either no suffix or one host-owned LF. The capture hook accepts exactly those two raw endings. A second LF, CR, space, other text, wrong action, duplicate marker, or marker-only document still fails closed.

Acceptance does not normalize the approval identity. The SHA-256 digest is computed over the exact raw JSON string field, including the escaped terminal LF when Stop supplies it; the decoded value is used only to validate the logical document and persist the human-readable plan without the internal marker. Therefore two transport representations can satisfy the same terminal-line rule while retaining distinct wire digests.

The approval document also carries a compact planning disposition before its full detail. It accounts for intent, surface mapping, decision freeze, doubt-pass outcome or N/A reason, slicing, wave width, and execution mode. When sequential mode is forced because no base ref exists or per-slice commits are disabled, the document states why the usual sequential/parallel question was unavailable.

A malformed-marker rejection never instructs the orchestrator to replay the same document. It may re-present only after naming and correcting a concrete marker-shape defect; otherwise it reports the failed capture without the marker and stops. This prevents a deterministic host-shape mismatch from duplicating the full plan and failing identically.

## 2026-08-04 amendment — native Plan item split

A later Codex 0.146 rollout showed a second transport shape: the native `<proposed_plan>` renderer can publish the human plan as a host-generated `item_completed` event whose `item.type` is `Plan`, then leave Stop's `last_assistant_message` with only the hidden Oso marker. This amends only the marker-only sentence above. An unbacked marker-only Stop still fails closed, but a backed marker-only Stop is valid when the regular transcript is session- and turn-attested and contains exactly one same-turn Plan item.

For that path, the digest binds the raw Plan item `text` field, one escaped LF separator, and the raw marker field. The persisted snapshot and `current.md` use the decoded Plan text, not the marker-only agent message. Missing, foreign-turn, foreign-session, duplicate, empty or marker-bearing Plan items are malformed and write no pending approval state.

## Consequences

- The real Codex terminal-LF payload reaches pending approval without weakening final-line validation.
- The native Plan renderer's marker-only split reaches pending approval only when backed by the unique exact-turn Plan item.
- The wire digest remains an exact audit binding rather than a normalized-document digest.
- Conditional phases remain conditional, but their disposition is visible at approval time.
- One capture failure produces one diagnosis instead of an unchanged duplicate plan.
