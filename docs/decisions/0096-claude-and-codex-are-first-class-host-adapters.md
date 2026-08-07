# 0096 — Claude Code and Codex are first-class host adapters

Date: 2026-08-03
Status: accepted
Supersedes: the foundational Platform, Distribution and Enforcement choices in `docs/blueprint.md` — Claude Code is no longer the only current host, one Claude plugin is no longer the whole distribution, and approval hooks now inspect a bounded transport marker and token as well as state booleans
Reconciled: applied — the blueprint's foundational rows describe two first-class adapters, their split distribution and the bounded content-aware approval rail.
Source: this change (Codex port), ledger decisions D1, D3, D9, D13, D15 and D16; recorded with the release that made both hosts installable

## Decision

Claude Code and Codex are two first-class host adapters over one harness contract. The neutral bodies under `plugin/skills/_shared/bodies/` own behavior that is true on both hosts. Each platform directory owns the concrete spelling of its tools, lifecycle, paths and invocations. A wrapper binds those blocks without copying the neutral rule or leaving the other host's instructions inert in the model's context.

The release remains one version, but distribution has two shapes:

- Claude Code receives the existing plugin, including its native agents and hooks.
- Codex receives a plugin containing the eight skills through a private local marketplace. `install-codex.sh` installs the surfaces its plugin schema cannot carry safely: seven role TOMLs, release-hashed user hooks and runtime commands, bounded `config.toml` ownership blocks (narrowed to leaf ownership inside shared tables by ADR-0098), the bounded global `AGENTS.md` block, MCP wiring and the provider-correct Impeccable copy.

That split is a platform boundary, not a reduced contract. Codex's package cannot bundle agents or hooks and cannot pre-authorize user hooks, so claiming that the plugin alone installs the rail would describe a gate that does not run. The installer verifies published bytes and the operator reviews hook trust in Codex. The exact package-level difference and every behavioral degradation live in the parity ledger required by ADR-0097.

The enforcement statement narrows with the same honesty. Ordinary edit and commit gates still decide from runtime state, never model prose. Codex plan approval additionally inspects one versioned marker on `Stop` and two exact operator prompts on `UserPromptSubmit`; those values are transport for a mechanical state transition, not semantic judgment of the plan's content. Claude keeps its native `ExitPlanMode` approval UI.

## Consequences

- A shared behavioral change is written once. A host fact is written only in that host's binding and recorded in the parity ledger when it changes capability or assurance.
- Each wrapper follows its host's skill-authoring contract; shared bodies stay valid under both instead of treating one provider's format as universal.
- `claude plugin validate --strict` continues to validate a complete Claude plugin from the tracked tree; Codex installation assembles a self-contained marketplace copy with the same shared bodies beside its wrappers.
- The minimum Codex floor is ADR-0094's verified 0.146.0. Moving that floor requires new evidence before the installer pin moves.
- A release that touches either adapter checks the other adapter and updates `docs/parity-codex.md`, even when the correct result is “no parity change”.
