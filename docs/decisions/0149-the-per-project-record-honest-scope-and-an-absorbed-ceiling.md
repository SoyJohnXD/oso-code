# 0149 — The per-project record: the scope it can actually be retrieved at, and the ceiling it absorbs

Date: 2026-08-13
Status: accepted
Supersedes: ADR-0007 (its `scope: personal` field and the "honest per-machine: `$HOME`, not per-person" gloss on it — the store, its topic key, its single upserted observation, its `type: preference` and its read/upsert discipline all stand), ADR-0025 (only the per-machine framing its context rests on; the decision itself — a teaching preference is engram data and never a repo default — stands entire and is strengthened by a scope that is narrower still), ADR-0030 (only its "asked once, never re-asked" reading of the record as a whole; the round it defines is unchanged at two questions, and a SECOND ask on a different trigger now fills the same record)
Reconciled: applied — `docs/blueprint.md`'s tool-policy row for `oso/preferences` states the one record per project, the retrieval fact behind it, the two moments that fill it, the mirror and the migration, and its Mode 1 phase 0 states both asks rather than one. The record is read and self-healed in `plugin/skills/_shared/bodies/plan.md` §0, whose behavior bullet keeps ADR-0030's round and whose ceiling bullet defines the second ask; the AUTO ground rules' ceiling bullet owns that ask and the deny-pattern mirror beside it, §4's round routes an AUTO answer to it, and `bodies/roadmap.md` §4 reaches the same ask once per project before its first child arms. The mirror is the file `plugin/hooks/block-prod-deploy.sh` reads per repository. `tests/plugin-lint.sh`'s `check_the_project_record_is_honest_about_its_scope` holds the scope statement, both self-heals, both asks and the mirror, and flags the retired per-machine claim by its own words.
Source: this change (auto-continuity), decisions D5 and D12 as the operator amended them; the ceiling in ADR-0147, which rests on three facts that are the project's and had no home

## Decision

**There is ONE `oso/preferences` record PER PROJECT, at engram's own default scope, and it now carries the ceiling as well as the behavior.** The scope is not a policy choice — it is the only scope the memory layer can retrieve at.

### Part 1 — the retrieval fact, and why it settles the scope

`mem_search` resolves the project from the working directory and filters by it UNCONDITIONALLY. A `scope` argument only ADDS a filter on top of that one; it never widens the search past the resolved project. So a record saved in another project is unreachable from this one whatever scope it was saved under, and `scope: personal` never bought the per-machine reach ADR-0007 claimed for it — the field narrowed a search that was already narrowed.

Per-project is therefore the design and not a failure to remember: a project reached for the first time is asked once, because there was never a machine-wide answer to find. Stating it that way is what stops the next reader from trying to "fix" the re-ask with a scope argument that cannot work.

The record is saved with NO `scope` argument at all — project is engram's own default and the only scope its search serves here — and every later change goes through `mem_update`, merging and never overwriting, the same discipline `oso/index` takes.

### Part 2 — two ask moments, one record, and neither asks the other's questions

- **Behavior — at the FIRST PLAN in this project.** One round of two questions before phase 1: explanation depth and adaptive teaching. This is ADR-0030's round unchanged, on ADR-0007's topic key, and `/quick` still consumes the record and asks nothing.
- **Ceiling — at the FIRST AUTO OR ROADMAP ARMING in this project.** The staging route, the production route and the PR base branch (ADR-0147). Where the record already carries them they are read silently; where it does not, this is its OWN round after the disposition question and never two more questions bolted onto that one, since the per-round cap the platform file names is a cap.

The split is deliberate and it is the reason the ceiling did not simply join the first round. **A project that never runs unattended is never asked for its production route.** Asking all five at the first plan would charge every project in the harness for a property most of them will not use, and would ask the most consequential question at the moment the operator knows least about what the run will do.

Two ask moments, one record: the second `mem_update` merges into the observation the first created, and a project that arms AUTO before it ever ran a plan fills both in the order it reaches them.

### Part 3 — the migration is a self-heal, never a re-ask

A legacy record found in THIS project under `scope: personal` migrates in place through `mem_update`: scope becomes project, every value it holds is kept, and the flow continues without asking anything. It sits beside the self-heal ADR-0030 already defined — a record still carrying the retired third behavior field drops it — and both are silent.

A legacy copy that already answers the questions is never a reason to ask them again. The alternative, treating the old scope as a miss, would have re-asked every operator whose record predates this change for answers already sitting in it.

### Part 4 — the mirror, because a record only the flow reads stops nothing

The production answer is distilled into deny patterns, ONE ERE PER LINE, appended to `$OSO_STATE_DIR/deploy-deny/<digest>.patterns`, where `<digest>` names this repository exactly as its own `<digest>.state` file already does. It is written through SHELL — the flow's own hands, creating the directory first — because no `oso-state` verb writes that file and none is added for it.

A patterns file that cannot be written is REPORTED, with what could not be written and where, never skipped in silence. The gate's own built-in refusals stand either way; what the mirror adds is this project's routes on top of them, so a silent failure would leave the operator believing their own route was covered when only three vendor CLIs were.

Where there is no record and nobody to ask — a run resumed on a machine where those fields were never filled — no AUTO is armed at all. The run proceeds attended-shaped, or parks its finish as the named pending ADR-0147 defines.

## Context

The ceiling needed a home for three facts that are the project's and not the run's, and the record was the only per-project store this harness has. What made putting them there awkward was that the record's own scope claim was wrong: ADR-0007 recorded `scope: personal` as "honest per-machine", ADR-0025's reasoning rested on the same framing, and both were written before anyone measured what `mem_search` actually filters by. Adding a production route to a store that was describing itself incorrectly would have shipped the ceiling on a claim that could not be checked.

So the scope was re-grounded first, and the ceiling absorbed second. Neither ADR-0007 nor ADR-0025 is retired for its conclusion — the store is still one upserted observation under one topic key, and a teaching preference is still engram data rather than a repo default. What is retired is the reach each described, and ADR-0025's decision is strictly safer under the narrower one: a preference that cannot escape its project cannot ship one operator's choice to the team.

One alternative was rejected. **A second store, per project, beside the personal one** would have preserved both claims by splitting them. It was rejected because it doubles the number of records to keep honest for a distinction the retrieval layer does not implement: both stores would be filtered by the resolved project, so the "personal" one would be a per-project record wearing a name that says otherwise — which is the defect being fixed, filed under a new topic key.

## Consequences

- The record now says what it is. A reader who asks why they were asked twice in two projects gets the mechanism instead of a reassurance, and the linter flags the per-machine claim by its own words if it comes back.
- The blast radius of a wrong production answer is one project, which is the right size for it. It is also the reason the mirror is keyed by the repository digest rather than by anything the operator types: the gate reads the file for the repository it fired in, and no record from another project can reach it.
- Two triggers now write one observation, so the record's shape is no longer "the first-run round's output". Any future field has to name WHICH moment fills it, or it will be asked at whichever one a reader assumes.
- ADR-0030's round is untouched at two questions, and this is the second time that number has been defended rather than grown. The pressure this change put on it — five fields wanting one round — was answered with a second trigger instead of a wider round, because the platform cap is a cap and a five-question round exists on neither host.
