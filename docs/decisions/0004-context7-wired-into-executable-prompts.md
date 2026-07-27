# 0004 — context7 is wired into executable prompts, not fenced off

Date: 2026-07-11
Status: accepted
Reconciled: applied — the Tool policy context7 row reads the trigger points this corrected to.
Source: docs/blueprint.md amendment of 2026-07-11 (harness audit, 5-judge review), correction (b), deciding commit 8b8456e

## Decision

The Tool policy table's "Never: By default" fence on context7 is replaced by concrete trigger points: the `oso-applier` carries context7 in its frontmatter tools plus a never-guess-a-signature contract, and the `/plan` decision rounds and `/quick` iterate steps verify library-dependent decisions against current docs before recommending.

## Context

One of four frozen-section corrections a five-judge audit produced.
