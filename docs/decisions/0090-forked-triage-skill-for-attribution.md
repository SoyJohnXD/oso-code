# 0090 — A forked `triage` skill answers attribution, and only that

Date: 2026-08-02
Status: accepted
Implemented-in: plugin/skills/triage/SKILL.md, plugin/skills/plan/SKILL.md
Reconciled: applied — Mode 1 phase 6 names the forked skill as what establishes attribution before a red check is routed.
Source: this change (parallel wave execution); recorded with the change that made it

## Decision

A new forked `triage` skill (`context: fork`, `agent: general-purpose`, `background: false`, `model: opus`) answers ONE question from read-only git evidence — is this red check attributable to the change under execution, or does it predate the base ref — and ends on `Triage: attributable`, `Triage: pre-existing` or `Triage: skipped — attribution not established`. It judges only: no edit, no fix, no commit, no question back to the operator, and no root cause it cannot reach read-only. It is model-invocable; `/debug` keeps `disable-model-invocation: true`.

## Context

The split between ADR-0084's failure routing and ADR-0043's stop-the-line turns on a fact the orchestrator is the worst judge of — it wrote the plan the wave executes — so the question goes to fresh eyes, and the verdict removes the guessing without removing the operator's decision. Model-invocable because the orchestrator reaches it mid-wave through the Skill tool, which is exactly what `disable-model-invocation` forbids; `/debug` stays operator-only, so the mode boundary the linter holds over `bootstrap/claude-global.md` is untouched and `triage` is a skill rather than a fourth mode. That leaves its scope guarded by PROSE ONLY — its description and its own body name it an orchestrator instrument and never a general debugging entry point — and nothing mechanical stops a model from reaching for it outside a wave. It stops at attribution because `oso-code:debug` owns reproduce-first triage, and running that flow here would put one flow in two files and route a fix through a judge nobody authorized to write code.
