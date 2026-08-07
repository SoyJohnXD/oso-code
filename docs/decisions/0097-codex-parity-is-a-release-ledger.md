# 0097 — Codex parity is a release ledger

Date: 2026-08-03
Status: accepted
Reconciled: applied — the blueprint assigns host spellings and assurance differences to the mandatory ledger in `docs/parity-codex.md`, and that ledger carries every frozen degradation.
Source: this change (Codex port), ledger decision D17; recorded with the release that made Codex a first-class host

## Decision

`docs/parity-codex.md` is a release artifact, not migration notes. Every release that touches the Claude or Codex tree reviews it and records the current answer for both hosts. A difference is classified as an equivalent host spelling, a deliberate degradation, or a missing counterpart; an unverified answer is explicit and cannot ship as a silent claim of parity.

The ledger must keep these five degradations visible until evidence removes them:

1. Codex plan approval composes its native UI signal with a local digest, artifact and `PreToolUse` rail (ADR-0101). Hosted tools, specialized paths and `write_stdin` on an existing process do not cross that pending boundary.
2. Claude applies Oso's voice as an output style. Codex receives it as global `AGENTS.md` guidance, which context compaction may weaken.
3. Codex security review uses `codex review` under the dedicated security subagent, not Anthropic's native `security-review` skill.
4. Runtime state is keyed by repository, so two agent sessions in one repository share it.
5. The authenticated Codex smoke cannot run in ordinary CI; `bootstrap/verify-codex.sh` runs it locally when authentication is available.

An implementation workaround does not erase a loss. Reusing Codex's native approval interaction removes the duplicate UX but does not give hosted or specialized tools the local hook rail; installing user hooks restores the runtime behavior but does not make hooks part of the plugin package. The ledger states the boundary after mitigation.

## Release rule

A release is incomplete when the parity document omits a frozen degradation, carries a placeholder for a now-known host fact, or describes a future verifier as though it had run. The release may still contain a deliberate degradation; it may not hide one.
