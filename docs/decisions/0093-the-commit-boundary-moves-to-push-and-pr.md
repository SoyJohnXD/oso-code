# 0093 — The commit boundary moves to push and PR

Date: 2026-08-02
Status: accepted
Supersedes: ADR-0085 (its "always, with no operator question about it" clause — per-slice commits are ON by default and off where the ledger's §3 Verification row says so)
Implemented-in: plugin/skills/_shared/bodies/plan.md, plugin/skills/_shared/bodies/quick.md, plugin/skills/_shared/bodies/debug.md, bootstrap/claude-global.md
Reconciled: applied — Mode 1 phase 7 and Mode 3 phase 5 read push and PR as the only two the operator is asked for.
Source: this change (parallel wave execution); recorded with the change that made it

## Decision

A COMMIT is part of the flow and is never asked for: `/plan` lands one per slice in both execution modes (ADR-0085), and its close commits what the close itself landed — the sweep's fixes, the design audit's, an accepted security fix. PUSH and a PR are the two operations that still require the operator to ask, and neither happens without it. This amends the standing rule where it was written — `plugin/skills/plan/SKILL.md` §7 step 8 and `bootstrap/claude-global.md`, both of which read "commit, push, or open a PR only if the user asks". Per-slice commits are ON by DEFAULT from this version; a project turns them off in the ledger's §3 Verification row — the row that already settles the base ref and the concurrency question — and off there costs the same mode a base ref of `none` costs, since a wave is integrated from the commits its slices land. `/quick` and `/debug` have no slices and so land no commit of their own; what changes for them is the boundary they state, nothing else.

## Context

ADR-0085 decided the per-slice commit for both modes and only the wave path implemented it, which left the harness in the position the debt sweep found: the integrator merges into the MAIN CHECKOUT without being asked, so unasked commits were already reaching the operator's real branch while two surfaces went on promising they never would. One of the two had to move. A commit is local and reversible, the verifier's `pass` already gates it, and it is what makes a slice mergeable, re-verifiable at the integration gate and undoable one slice at a time; a push and a PR leave the machine and reach other people, which is where asking earns its cost. So the boundary moves down to those two rather than the operator being asked once per slice for the length of a change. The default is ON because that is what a `/plan` change wants, and the opt-out rides the §3 row rather than a new store: it is a fact about the change and not a preference about the operator, and that row already carries the two facts of the same kind — the base ref, and ADR-0091's concurrency question.
