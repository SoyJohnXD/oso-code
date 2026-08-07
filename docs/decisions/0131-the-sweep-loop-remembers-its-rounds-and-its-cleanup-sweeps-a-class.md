# 0131 — The debt-sweep loop remembers its rounds, and its cleanup sweeps a class inside a stated boundary

Date: 2026-08-07
Status: accepted
Reconciled: applied — the judge's own body carries a `Prior rounds` input contract and the Codex judge role names that input beside the two it already listed, `/plan` §7 step 3 and `/debug` §5 step 1 restate the prior findings' dispositions on their re-invocations and hand the cleanup a stated payload, both `oso-applier` contracts carry that payload, the class sweep and its boundary plus finding-keyed reporting, and `tests/plugin-lint.sh`'s `check_sweep_loop_remembers_its_dispositioned_findings` holds both ends of the memory contract. `docs/blueprint.md`'s Mode 1 §7 narrative needed no move: it already defers this loop's contract to the mode body, and its one sentence about the cleanup — readability and semantics only, never functionality — stands unchanged under a sweep that is still both.
Source: this change (clean-bar-convergence); the same close ADR-0130 was cut from, read for what it spent its rounds ON rather than how many it ran; ledger decisions D5, D6, D8

## Decision

ADR-0130 gave the judge → fix loop an exit. This gives it a memory, a specified handoff, and a fixer scoped to a defect class instead of a defect instance — three parts of one loop, because the accounting in the third produces the tags the first carries, and the payload in the second is what the boundary in the third is measured against.

### Part 1 — every re-invocation carries the prior rounds' dispositions, and never their reasoning

Each re-invocation of the sweep judge receives the findings the earlier rounds raised, each tagged with the disposition it took — `fixed`, `operator-dismissed`, or `accepted-residual` — plus the rule that a dispositioned finding is never raised again: it is named as settled instead, and the verdict counts only what this round raised. The tags travel BARE. What the judge learns is what each finding became, never why, which is the anti-anchoring discipline ADR-0048 already applies to the ledger on the conformance axis, applied now to the loop's own history: a judge handed the case for a dismissal reviews the case instead of the code.

A blind judge each round was rejected. It was the state of the flow, and it is what the loop's one existing memory clause was already refusing in miniature — the re-invocation restates the ledger as it stands NOW, amendments included, precisely so the finding an amendment settled cannot come back. That clause was written for exactly one finding; this is the same rule for the rest of them.

### Part 2 — the debt-cleanup assignment gets the payload spec its sibling kind already had

The handoff was one clause — findings go to the applier "with the list as a debt cleanup assignment" — while ADR-0063's judge-findings kind, which runs once, carried a stated payload. The kind that runs in a LOOP now carries one too, and the same three fields: the findings verbatim with their `file:line` and severity tier, the change-surface file list, and the rubric path. Neither kind carries a ledger, so for both the payload is the whole contract.

The applier's report gains finding-keyed accounting beside its file-keyed `files:` list — each finding `fixed`, with any extra sites of that pattern swept, or `skipped` with a reason. `files:` cannot answer whether finding #4 closed, and a caller who cannot read that answer spends a whole judge round rediscovering it.

### Part 3 — the cleanup sweeps the CLASS, inside a hard boundary

A cleanup fixes every site of a reported pattern in the same pass and reports the extras it found, so an N-site pattern costs one round rather than N — instance-only was rejected for exactly that arithmetic, since it makes the loop's length a function of how exhaustively a judge enumerated rather than of how much debt exists.

The boundary on that permission is the payload and it is hard: a file named in the findings or in the change-surface list, never one outside both, and sites past it are reported rather than touched. Two failures bound the permission from both sides and both are real: a cleanup too narrow costs a round per site, and a cleanup too broad writes damage the loop then spends its remaining rounds finding. So the permission is per PATTERN, never per FILE — the pattern's sites, never a pass over the files that hold them.

## Context

ADR-0130 measured the loop's length; this reads the same close for what the rounds contained. Three things were paying for it. The judge ran as a fresh fork every round over the whole diff and was restated two arguments — the base ref and the ledger — so it knew nothing of the rounds already run and no rule forbade re-raising: the orchestrator ended up hand-carrying a growing "do NOT re-raise" list, 2 items by round 3 and 14 by round 7, and one dismissed clone group was examined three times regardless. The cleanup applier was told "never a fix beyond a finding", which makes an N-site pattern an N-round pattern; the one time an applier read past that, it ran a formatter over documents the change had touched in a single cell, and rounds 6 and 7 found nothing but that damage. And nothing in the applier's report was keyed by finding, so a finding that never closed could only be discovered by a judge round.

The cap ADR-0130 installed changes the shape of the first defect without removing it. A loop with no memory no longer grinds visibly for seven rounds; it burns three re-arguing what the operator already settled and then hands them a choice they should not have had to make. That is why the memory contract, not the cleanup's boundary, is the clause `tests/plugin-lint.sh` holds: a cleanup that overreaches writes damage the next round finds, expensively but visibly, while a loop that forgets is invisible to everything in the harness.

## Consequences

- The sweep judge's body gains a `Prior rounds` section beside its `Scope` section, and for the same reason: scope narrows the files it may read, this narrows what it may raise. Its verdict now reads the findings the current round raises, with the settled ones named beside them — a residual is still never lost, because the mode records it where ADR-0130 put it (`/plan` the ledger, `/debug` the close's session summary) rather than in the last report.
- `/debug`'s sweep sends neither ref nor ledger, so the dispositions list is the only argument its re-invocation carries at all.
- A conformance gap the triage settled by AMENDING the ledger needs no tag: the judge reads the amended decision and has nothing left to raise.
- `oso-applier`'s "no drive-by fixes" line on both hosts now names the class sweep as the one permission a kind grants, so the two lines cannot be read against each other.
- `tests/plugin-lint.sh` holds the memory contract from both ends — the two bodies' re-invocation lines and the judge's own input section — the way its citation rule already holds both ends of a decision citation. A rule on one end alone would pass over a payload nobody reads, or a refusal about a payload nobody sends.
