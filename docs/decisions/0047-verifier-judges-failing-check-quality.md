# 0047 — The verifier judges the failing check's quality

Date: 2026-07-24
Status: accepted
Reconciled: applied — Mode 1 §6 carries the verifier's diff reading as "neither tautological nor implementation-coupled"; the agent contract that spells the two anti-patterns out lives in plugin/agents/oso-verifier.md.
Source: docs/blueprint.md amendment of 2026-07-24 (secfork-impeccable-pocock), decision (D5), deciding commit 7d52356

## Decision

`oso-verifier` judges the failing check's QUALITY: a check whose expected value derives from the code under test (tautological assertion), or that pins internal structure instead of observable behavior (implementation coupling), is treated exactly as a missing failing check and fails the slice. `rubric.md` stays deliberately untouched — clean-code only.

## Context

Adopted from an 18-skill gap analysis of mattpocock/skills, held to the same selectivity bar as the addyosmani pass.
