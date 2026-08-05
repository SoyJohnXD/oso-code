# 0102 — Codex post-install repair is bounded and explicit profile launches are fresh

Date: 2026-08-04
Status: accepted
Amends: ADR-0097 (installed verification now covers the explicit-profile launch constraint and cleans its own project registration), ADR-0098 (Engram's root keys compose with Oso's managed region), ADR-0100 (the integrator smoke must launch the selected profile without a full-history fork)
Superseded-by: ADR-0105 — retires only the `fork_context=false` spelling, which the installed MultiAgentV2 host rejects in favor of `fork_turns="none"`; the fresh explicit-role launch with a complete payload still stands
Implemented-in: bootstrap/install-codex.sh, bootstrap/repair-engram-codex.sh, bootstrap/verify-codex.sh, bootstrap/lib/engram-codex-pointers.sh, bootstrap/lib/toml-regions.awk, plugin/skills/_shared/platform/codex/subagents.md, tests/hooks-test.sh, docs/blueprint.md, docs/parity-codex.md, README.md, CHANGELOG.md
Reconciled: applied — the installer repairs only exact Engram state under rollback, explicit Codex roles start fresh with complete payloads, and the verifier removes only its own temporary project table.
Source: the operator's real 0.18.3 install and authenticated `bootstrap/verify-codex.sh` run on 2026-08-04

## Decision

After `engram setup codex`, the installer normalizes Engram's exact `model_instructions_file` and `experimental_compact_prompt_file` root keys before replacing Oso's managed TOML region. The shared TOML-aware normalizer ignores marker-looking multiline data, rejects duplicate or unexpected pointers, and leaves an installation with no prior Oso region unchanged. The existing repair utility uses the same implementation with an existing region required. A candidate that changed is accepted only after Codex validates it, and the original config remains in the installation transaction.

Codex may retain `~/.codex/.tmp/marketplaces/engram` while no marketplace named `engram` is registered. Oso may ask Codex to remove that orphan only when the path is a non-symlinked Git root with one `origin`, the exact official Engram remote, `HEAD` equal to the recorded official remote head, a clean tracked and untracked status, and the exact Engram catalog/plugin identities. The cache, Codex plugin state and config are backed up before inspection. Registered ownership is untouched; a local commit, modified checkout, unknown remote, malformed manifest, symlink or removal mismatch fails closed and is restored by the same rollback as every other installer artifact.

Every Codex launch that selects an explicit custom or built-in `agent_type` sets `fork_context=false`. A full-history fork inherits the parent profile and Codex rejects combining it with another explicit role. Fresh launches therefore receive complete payloads: paths, refs, assignments, skill routes, handoff coordinates and settled decisions rather than relying on parent conversation history. The authenticated smoke names this launch constraint explicitly.

`codex exec --ephemeral` may still add a `[projects."<temporary main checkout>"]` table to the user's config. After the process ends, the verifier removes zero or one exact table for that run from the latest config using the shared TOML parser. It preserves multiline decoys and every unrelated table, retries when the config changed while it prepared the candidate, and never restores a pre-smoke whole-file snapshot.

## Consequences

- A normal reinstall no longer deletes Engram's root instruction pointers.
- Automatic cleanup is deliberately narrower than ownership inference: ambiguous user state survives and blocks with an actionable error.
- Custom-role delegation no longer depends on the model avoiding an invalid fork/profile combination by chance.
- Authenticated verification leaves no project registration for the temporary smoke repository and cannot erase unrelated project entries by snapshot restoration.
- Claude Code's native plan and delegated-agent behavior is unchanged; the unified manifest version still advances because both host packages share one release number.
