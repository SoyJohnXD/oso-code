# 0105 — An explicit Codex role launches fresh through MultiAgentV2's `fork_turns`

Date: 2026-08-05
Status: accepted
Supersedes: ADR-0102 (its `fork_context=false` spelling, which the installed MultiAgentV2 host rejects outright)
Reconciled: applied — the shared delegation protocol, the authenticated integrator smoke and the three parity rows spell the freshness constraint the way the installed host accepts it.
Source: literal strings in the installed `codex-cli 0.146.0` binary resolved from `command -v codex`, plus an external audit run on this machine whose four subagents had to be launched with `fork_turns:"none"`

## Decision

The installed host serves `codex.multi_agent.spawn` at `version` `v2`. Its V2 `SpawnAgentArgs` carries `task_name` and `fork_turns`; the V1 struct that carried `agent_type` and `fork_context` still exists in the binary but no longer backs the tool. The host rejects the V1 parameter by name — `fork_context is not supported in MultiAgentV2; use fork_turns instead` — and constrains the replacement in the same voice: ``fork_turns must be `none`, `all`, or a positive integer string``.

Every Oso launch that selects an explicit custom or built-in `agent_type` therefore sets `fork_turns="none"` and names the child through `task_name`. Omission is not neutral: the host reads an absent `fork_turns` as a full-history fork exactly as `"all"` does, so the parameter is written at every launch site rather than left to a default.

## Context

ADR-0102 decided that explicit-role launches start fresh with complete payloads and never a full-history fork, and the harness asserted that decision as the literal `fork_context=false` at six sites — the shared delegation protocol, the authenticated integrator smoke, ADR-0102's own decision paragraph, three parity rows and two regression assertions pinning the first two. That decision is unchanged and still correct. Only the parameter name and its value shape were wrong, and every one of those sites would have made the installed host refuse the spawn.

The correction is filed as its own decision rather than an in-place edit of ADR-0102, so a later reader can tell a corrected claim from an original one. ADR-0102's decision paragraph keeps its original words and its header names this file as the partial supersession.

## Consequences

- A delegated launch reaches the host in the shape the host validates, instead of failing on an unsupported argument the harness itself prescribed.
- The freshness contract is now stated against verified binary evidence rather than against an inherited spelling.
- `fork_turns` is explicit at every launch site because its absence means the fork the decision forbids.
- Claude Code's delegation is untouched: the parameter belongs to Codex's multi-agent tool alone.
