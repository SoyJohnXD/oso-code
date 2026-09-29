# Unattended execution — AUTO, its park, and its ceiling

Read only once AUTO arms — at §4's execution-disposition answer, on an operator instruction at any point, mid-execution included, or when the change runs as a child of the ROADMAP. Gathered here: the set-aside routine a ROADMAP child follows, the ground rules' AUTO bullets, the Ceiling field, and what §4, §5, §6 and §7 do under AUTO.

## Under a ROADMAP — the policy and the set-aside routine

A ROADMAP child never waits for the operator: that mode's autonomy policy answers in their place, recorded in the ledger as delegated (§3), and an OFFER nobody is there to take takes its declined route.

What that policy will not answer costs this change, never the chain: `oso-state set mode=plan active_slice=none verify_green=false` sets it ASIDE. Never `oso-state clear` here, since the chain still owns this repository and arms the next child. Each point `plan/SKILL.md` marks "under a ROADMAP" reads as follows:

- **§6 step 2, an applier's `blocked`** — the policy answers each question in the operator's place, recorded the same way; a question it will not answer sets the change aside.
- **§6 step 3, a finding grounded in one of §2 step 6's four rules** — ESCALATE is the question this routine queues, and the change is set aside on it.
- **A merge conflict** under PARALLEL — no tier picks a side; `_shared/parallel.md`'s failure routing sets the change aside on it.
- **§7's entry** — the MACHINE ENTRY CONDITION stands in for the operator's word: the change's LAST slice goes green and is committed and marked `[x]`, or under PARALLEL the last wave's integration gate passes.
- **§7 step 3, conformance triage** — amendment is never the policy's to pick: it sets the change aside. A code-diverged fix the policy can justify on the evidence proceeds.
- **§7 step 3, the exit cap** — the policy picks among the three options, recorded, an accepted residual taking the `accepted-residual` disposition. Where none is justified on the evidence, the change is set aside at the cap.

## The ground rules' own AUTO bullets

- The AUTO marker is written BESIDE the `mode`/`active_slice`/`verify_green` triple, never over it: a write naming the marker alone leaves all three keys as they stood, and every write below spells it that way.
- AUTO is a DISPOSITION of the run — never an invocation argument, never a fifth mode. It arms as the second question of the execution-mode round §4 asks, or by explicit operator instruction at any point this flow reaches, mid-execution included ("sigue en auto, voy a salir"), and disarms the same way. Every flip is recorded DATED in this change's ledger (`mem_update` — merge, never overwrite); the flip itself is the consent. Phases 1–5 always run with the operator: AUTO governs §6 and §7 alone.
- The disposition is RECORDED in that ledger and in the index row's `NEXT:` line, and ARMED on the runtime state: `oso-state set auto=running auto_change=<change-slug>` at the flip that arms it, `auto=parked` at the park below, `auto=done` at §7's close. `mode=plan` runs throughout, the same three keys §5 and §6 already write.
- A host whose delivery contract carves an unattended run out of its turn-ending rule reads that marker, and arms its rails for an unwatched run on the same value — the reference file names both.
- Every milestone this run reports under `_shared/reporting.md` is ALSO appended full-text with `oso-state journal "<the milestone as it was written>"`, the per-change journal `auto_change` names. After a compaction mid-run the position is re-read from the `oso/index` row's `NEXT:` line, from `oso-state show` and from that journal. §0's own resume path is the resume path of a parked run.
- What answers a decision in the operator's place while AUTO is on is the ROADMAP mode's own §2 autonomy policy, read at THIS change's scale — its three tiers, its irreversibility bar and its never-solo list entire. This change's own frozen ledger answers first.
- An operator MESSAGE while AUTO is on disarms nothing: an answer to a queued question is consumed as operator input, a comment is attended, and the run continues under AUTO; only an explicit resume instruction — "retomo yo" and its kin — hands the flow back.
- Wherever `plan/SKILL.md` reads "under a ROADMAP", a change executing under its own AUTO disposition reads the same way, with exactly TWO substitutions and no third. What a child queues for that mode's §5, this run queues for its OWN final report — the three parts §7 delivers at the run's end. Where the ROADMAP mode's chain arms the next child behind a set-aside one, this run PARKS.

- Parking is that same set-aside routine, with its own last step replaced: it reports BLOCKED carrying the queued question or questions, and delivers that same final report. It then writes the set-aside state over whatever the stopped slice or wave left armed, with the marker flipped beside it in that one write (`oso-state set mode=plan active_slice=none verify_green=false auto=parked`), and ends the turn there.
- That marker tells a park from a stall ON DISK: a parked run reads `auto=parked`, a run that stopped mid-milestone still reads `auto=running`, so a host's unattended rails carry the second on and let the first rest.
- The park is one of exactly two deliveries an unattended run ENDS THE TURN on, the final report §7 delivers being the other.
- `oso-state clear` is no more run here than in that routine: this run expects resumption, so its position stays durable in this change's ledger, its plan topic and its `oso/index` row.

AUTO's CEILING is how far a run reaches without another person: this machine and the environments the change's own bar reaches from it — local, and STAGING where the project has one — plus the branch the run works on and the PR that finishes it.

- The branch is cut at §5's initialize, beside the write that arms the marker: a run under AUTO works on `oso-run/<change>`, outside the slice namespace `oso/<change>/<slice>` since git cannot hold both as refs. Every commit §6 lands reaches that branch — step 4's directly, a wave's through the integrator's merge into the main checkout — and §7 step 8 pushes it and opens the PR that closes the run.
- There the reach ends: the MERGE of that PR, a release and a PRODUCTION deploy are on the never-solo list, refused however plainly a tier would have taken them.
- Three of the facts that ceiling rests on are the PROJECT's — the staging route, the production route, and the PR base branch — so they live in the per-project record §0 reads (`oso/preferences`) and are asked at the FIRST ARMING IN THIS PROJECT, never at that first plan. A record already carrying them is read silently; missing them, ask ONE round for the three through your host's question tool, inside the per-round cap the reference file names, and write the answers into that SAME record with `mem_update` (merge, never overwrite).
- Then write the MIRROR, since a record only this flow reads stops nothing a hook has to stop: the production answer distilled into deny patterns, ONE ERE PER LINE, appended to `$OSO_STATE_DIR/deploy-deny/<digest>.patterns` — `<digest>` naming this repository as its state file `~/.local/state/oso-code/<digest>.state` does. Write each pattern with `oso-state deny-pattern add <pattern>`, which creates the directory and appends that one pattern. A patterns file that cannot be written is REPORTED, with what could not be written and where, never skipped in silence; the gate's own built-in refusals stand either way.
- NO RECORD AND NOBODY TO ASK — a run resumed on a machine where those fields were never filled — arms no AUTO at all: the run proceeds attended-shaped, or parks its finish as the named pending §7 step 8 already defines.

## The Ceiling field, asked apart from Behavior at §0

- **Ceiling — asked at the FIRST AUTO OR ROADMAP ARMING in this project** and never in the round §0 asks for Behavior: the STAGING ROUTE (whether this project has one, and how it is reached), the PRODUCTION ROUTE (what an unattended run never touches), and the PR BASE BRANCH this repository's pull requests open against. A project that never runs unattended is never asked for its production route.

A ceiling field updates on the operator's natural-language request, applied with `mem_update` — merge, never overwrite — and confirmed.

## Choosing AUTO at §4's execution-disposition question

NORMAL is the default and the recommendation: AUTO buys nothing for an operator who is sitting here. Never re-ask what the ledger already answers — an operator who said auto earlier has answered this question, and it is skipped with their answer recorded as §4's execution-mode question is.

An answer of AUTO is RECORDED here and ARMED at §5: this phase writes no runtime state at all, so the marker (`auto=running auto_change=<change-slug>`) rides §5's own initialize, and a flip taken later — mid-execution, by instruction — arms it where it is taken. Where this project's `oso/preferences` record already carries the staging route, the production route and the PR base branch, they are read silently. Where it does not, that ask is its OWN round after this one, never bolted onto it, since the reference file names a per-round cap — and its answers go back into that record with the mirror the ceiling bullet requires.

## §5's own AUTO writes

The `NEXT:` line also carries `AUTO` beside the position while that change runs under the AUTO disposition, written and dropped with the flip (e.g. `NEXT: plan2-purga slice 3/6 AUTO → then roadmap Plan 3`).

At §5's initialize — `oso-state set mode=plan active_slice=none verify_green=false` — plus `auto=running auto_change=<change-slug>` in that same write where §4's disposition answer was AUTO. That answer also cuts the run its own branch here, beside the marker: `git -C <main checkout> checkout -b oso-run/<change>`, the DEFAULT branch being the case it exists for. It is what §6's commits then land on and what §7 step 8 pushes — skipped only on a RESUME, where `git -C <main checkout> rev-parse --abbrev-ref HEAD` already reads that same name because this run cut it before. A host's unattended rail on this marker denies a push of any other name while the run is in flight. Record the branch in the ledger (`mem_update` — merge, never overwrite), because the close pushes the recorded name.

## §6's own AUTO commit

Under AUTO the slice's commit lands on the `oso-run/<change>` branch §5 cut, the branch that close pushes whole.

## §7's own AUTO close

A run whose operator flipped AUTO owes them one report at its END, whichever end it reached — this close, or the park. Deliver it in the ROADMAP mode's own three parts and no fourth: what was decided for them and on what rationale, every answer naming the tier that took it; what was deferred and why, each item as the question it was; and what awaited their hand, the pendings and the named residuals nothing they answer releases.

At this close DISARM first — `oso-state set auto=done`, a tool call — and deliver the report after it, as that same turn's trailing text, since text that follows a tool call is delivered where text that precedes one may not be. It is the LAST thing this close does, after step 8.

Under an UNATTENDED run PUSH and PR are the FINISH instead — the thing the plan approval that armed it chartered. It runs after step 7's green: push the branch §5 recorded (`git -C <main checkout> push -u origin oso-run/<change>`), then open the PR against the base the per-project record (`oso/preferences`) holds for this repository, through `gh pr create` or whatever route this host has for opening one. Record the branch, the PR and its base in the run journal and in the final report above. The reach stops at that PR: its MERGE, a release and a production deploy are on the never-solo list, and no tier takes one. Where the repository has no remote, or the push or the PR call fails, the finish is PARKED as a named pending in that final report — the branch, its commits and what stopped them — never a silent skip or a retry loop; the close still disarms and delivers as above.
