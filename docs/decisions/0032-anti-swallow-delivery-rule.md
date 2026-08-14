# 0032 — Anti-swallow delivery ground rule

Date: 2026-07-21
Status: accepted
Superseded-by: ADR-0145 — retires only this rule's UNCONDITIONAL standing, and only for a MILESTONE report on a host whose platform file carves an unattended run out of it. The rule governs every other class of operator-facing content exactly as written, it governs a milestone on a host that carves out nothing, and the park and the final report stay inside it on every host
Reconciled: elsewhere — landed in the skills, plugin/output-styles/oso.md and bootstrap/claude-global.md; the frozen body never carried it.
Source: docs/blueprint.md amendment of 2026-07-21 (repaso-categories-antiswallow), decision (D5), deciding commit 4cc2020

## Decision

The Claude Code TUI drops assistant text that precedes a tool call in the same turn, so operator-facing content — intent, surface map, repaso — must end its turn as plain text before any later-turn tool call, and round context that used to precede `AskUserQuestion` travels inside its fields instead (question text, option descriptions). Global anchors land in `plugin/output-styles/oso.md` and `bootstrap/claude-global.md`, and `plugin/skills/_shared/didactic.md` is reconciled so its comprehension-check move is itself a turn-ending plain-text close.

## Context

This is the delivery bug that had been hiding the harness's own explanations, which is what made the flow read as infantil o inútil.
