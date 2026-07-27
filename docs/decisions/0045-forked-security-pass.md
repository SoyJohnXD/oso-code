# 0045 — The security review runs in a fork, never inline

Date: 2026-07-24
Status: accepted
Supersedes: ADR-0044 (the inline Skill-tool invocation)
Superseded-by: ADR-0061 — writes this skill's fallback review surface and verdict line to what it does
Implemented-in: plugin/skills/quick/SKILL.md, plugin/skills/debug/SKILL.md
Reconciled: applied — Mode 1 §7, Mode 2 and Mode 3 §5 read the forked skill.
Source: docs/blueprint.md amendment of 2026-07-24 (secfork-impeccable-pocock), joint marker (D1/D7), deciding commit 7d52356

## Decision

A new forked `security-pass` skill (`context: fork`, agent general-purpose, model opus — the debt-sweep mechanism) invokes the native `security-review` INSIDE the fork, so Anthropic's review prompt injects there and never into the orchestrator; when that skill is not listed in the fork it reviews with condensed native-derived criteria (>80% exploitability confidence, the native exclusions, a markdown finding shape). The report opens with the path that ran, `native` or `fallback`. All three modes rewire their pre-commit offer to it: on acceptance invoke `oso-code:security-pass`, relay the report verbatim, route accepted fixes through `oso-applier`, and re-run until it returns `Security Pass: clean` or the operator explicitly accepts the residual.

## Context

Filed under one marker covering two numbers, and the entry never separates them: the fork and the rewiring of the three call sites are one decision about where the review runs.

`/plan`'s call site cited its own per-change engram ledger beside this one — a reference that resolved on one machine only; it now cites ADR-0061, which records that same decision in-repo.
