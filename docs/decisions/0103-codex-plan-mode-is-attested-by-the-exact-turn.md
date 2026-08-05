# 0103 — Codex Plan Mode is attested by the exact hook turn

Date: 2026-08-04
Status: accepted
Amends: ADR-0094 (the frozen 0.146 hook contract includes its observed runtime mismatch), ADR-0101 (native-mode checks no longer equate Codex collaboration mode with `permission_mode`)
Implemented-in: docs/blueprint.md, docs/parity-codex.md, docs/decisions/0101-codex-native-approval-and-operational-plan-artifacts.md, README.md, plugin/skills/_shared/platform/codex/plan.md, plugin/hooks/lib.sh, plugin/hooks/capture-plan-approval.sh, plugin/hooks/approve-plan-token.sh, tests/hooks-test.sh, bootstrap/hook-hashes.txt, CHANGELOG.md
Reconciled: applied — plan entry, presentation, replanning feedback and native approval all resolve the collaboration mode from one exact-turn compatibility adapter.
Source: three blocked native Plan Mode turns in the Codex 0.146.0 rollout `019fcda1-996b-7372-aa97-d20932088948`, the tagged 0.146.0 hook schema and `hook_runtime.rs` implementation, and the operator's 2026-08-04 compatibility decision

## Decision

Oso does not equate Codex's hook `permission_mode` field with native collaboration mode. Codex 0.146.0 documents `plan` as a valid hook value but its runtime derives that field only from `AskForApproval`; an `on-request` turn therefore reaches both `UserPromptSubmit` and `Stop` as `default` even when the turn's native collaboration mode is Plan. Current upstream retains the same mapping.

One shared resolver attests the mode for the exact hook turn. It accepts only a readable regular non-symlinked `transcript_path`, requires the transcript's `session_meta.session_id` to equal the hook session, requires exactly one host-generated `task_started` event carrying the hook's exact `turn_id`, and accepts only `collaboration_mode_kind=plan|default`. Fixed-string host-field probes exclude lookalikes inside JSON-escaped user or assistant text. If that narrow rollout shape is unavailable, the resolver falls back to the documented `permission_mode`: `plan` remains Plan and the four documented non-Plan permission values remain non-Plan.

The resolver is the only mode authority used by the Codex approval hooks. It guards `$oso-code:plan` entry, marker-bearing `Stop` capture, ordinary Plan feedback that invalidates a pending document, exact native approval after the mode transition, and explicit cancellation. Ordinary non-harness prompts and markerless responses stay invisible. Harness-owned traffic whose mode cannot be attested fails closed rather than weakening the approval rail.

Regression fixtures reproduce the real Codex 0.146 payload — `permission_mode=default` plus an exact-turn Plan event — through both the optional `jq` reader and the pure-Bash fallback. Synthetic `permission_mode=plan` fixtures remain only as forward-compatibility coverage, never as the sole evidence for native Plan Mode.

## Consequences

- The operator can enter native Plan Mode and start Oso without being rejected by Codex's incorrect hook field.
- The hard gate stays mechanical; it does not devolve into prompt guidance alone.
- Rollout JSONL is explicitly an unstable Codex interface, so its parser remains isolated, exact-turn-bound and narrower than a general transcript reader. A truthful future `permission_mode=plan` survives a rollout-shape change through the documented fallback.
- A Codex surface that supplies neither a usable exact-turn transcript nor a truthful mode field cannot run the marker-bearing approval rail and fails closed with no partial approval state.
