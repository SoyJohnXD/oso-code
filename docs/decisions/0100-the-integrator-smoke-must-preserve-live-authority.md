# 0100 — The integrator smoke must preserve live authority

Date: 2026-08-03
Status: accepted
Amends: ADR-0096 (the Codex adapter's authenticated verifier must exercise the integrator's real sandbox contract), ADR-0097 (the operator-run smoke is release evidence only when its parent does not narrow the delegated role)
Implemented-in: docs/blueprint.md, docs/parity-codex.md, README.md, CHANGELOG.md, bootstrap/verify-codex.sh, tests/hooks-test.sh
Reconciled: applied — the authenticated smoke launches its disposable parent with `danger-full-access`, observes a completed subagent spawn carrying the exact fixture coordinates, and requires observable merge and teardown evidence.
Source: the authenticated 0.18.0 verifier run; Codex 0.146.0 reapplied the parent's live `--sandbox workspace-write` override to the child and correctly denied writes to the fixture's Git metadata

## Decision

The authenticated integrator smoke uses `--sandbox danger-full-access` on its outer `codex exec`. Codex reapplies a parent turn's live sandbox override when spawning a child, even when the selected custom agent file declares a different default. Launching the parent with `workspace-write` therefore does not test whether `oso-integrator` can use its declared authority; it actively removes that authority.

The broader parent sandbox is bounded by a new disposable repository below the system temporary directory, an ephemeral Codex thread, a prompt that requires exactly one delegated wave and forbids inline integration, and behavioral assertions that observe a completed subagent spawn carrying the exact main checkout, worktree and branch, the landed commit, removed worktree and deleted branch. Fixture cleanup remains mandatory. The verifier does not accept a prose success token in place of those filesystem and Git effects.

Codex 0.146.0's `--json` collaboration event does not expose the selected custom-profile name. The verifier therefore does not pretend to attest that unavailable field: a separate local check proves the installed `oso-integrator` TOML exactly, while the authenticated check proves that the requested work was delegated and that the delegated execution satisfied the role's Git contract. This is the strongest observable composition on the frozen host surface.

This does not broaden ordinary applier or verifier roles. It aligns the release smoke with the same narrow exception already recorded for the merge-only integrator: unrestricted filesystem reach, but a contract that permits only the named merge and teardown operations.

## Consequences

- The local release check measures the role Codex will actually run instead of a child narrowed by the verifier itself.
- A live operator override can still intentionally narrow a real interactive session; that is host behavior and remains visible as a blocked integrator.
- CI continues to skip authenticated execution and tests the verifier boundary through fixtures and static regression assertions.
- The five frozen parity losses in ADR-0097 are unchanged.
