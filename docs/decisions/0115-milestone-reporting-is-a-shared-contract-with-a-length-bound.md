# 0115 — Milestone reporting is a shared contract with required facts, a length bound, and one platform file per host

Date: 2026-08-05
Status: accepted
Reconciled: applied — the neutral contract lives once at `_shared/reporting.md`, each flow body points at it from the moment it arms or launches, the two platform files carry the one host-specific fact each host needs, and `tests/plugin-lint.sh` gained the two rules (14, 15) that keep all of that true.
Source: the operator's own words — "el orquestador ... no me dice casi nada de los apply, debt y estas cosas" — traced to a harness gap: a grep for reporting language across the bodies found four incidental mentions (`bodies/plan.md:193` "report the result to the user", `:223` "report the wave to the operator", and two "relay the returned markdown report verbatim" in the security offers) and nothing that says what a report CONTAINS. Claude's own native subagent cards mask the gap on that host; Codex draws no card at all, which is why the operator saw only tool calls there.

## Decision

**A milestone-reporting contract lives once in `plugin/skills/_shared/reporting.md`, referenced from every flow body that arms a slice or launches a delegation, with the one real host difference bound to exactly one platform file per host.**

- Five milestones — arming, launching, reading a verdict, a judge's outcome, closing — each with its own required facts, so a report cannot satisfy the contract by naming the milestone alone (the exact trap this decision closes: "report the result" already existed as prose and already produced the complaint).
- A length bound — at most 3 lines per milestone, plain text, no restated tool call, no paraphrased judge report — because the operator asked for visibility, not narration, and this harness's own register is already terse.
- Delivery rides the anti-swallow rule each platform file already states: a milestone report is operator-facing content, so it ends the turn as plain text before the next tool call, never in front of one.
- `bodies/plan.md`, `bodies/quick.md`, `bodies/debug.md` each carry their own pointer to `_shared/reporting.md` at the point they arm or launch — a lint rule checks this PER BODY, never once globally, so a body that stops pointing at the contract is named by file, not lost inside a whole-repo pass.
- The TUI-card difference (the accepted cost recorded at freeze — this touches the Claude path for a gap that is not Codex-specific) is real and is written exactly once per host: `platform/claude/reporting.md` says the native subagent card is not the report and is never a reason to skip the milestone text; `platform/codex/reporting.md` says this host draws no card at all, so the milestone text is its whole visibility layer. Both are referenced by a short "Reporting binding" pointer from each of that host's three mode-platform files — the same shape `subagents.md` already uses on Codex — never restated inline in any of them.

## What the linter checks (`tests/plugin-lint.sh`, rules 14-15)

| Rule | Checks | Fails on |
|---|---|---|
| 14 — `check_milestone_reporting_contract_is_complete` | Each of the five milestone bullets in `_shared/reporting.md` carries its required-fact markers on its own line; the file states a numeric length bound; every operator-only mode's body (discovered from `disable-model-invocation: true` frontmatter, the same discovery rule 7 already uses) points at the contract | A milestone reduced to "report the result"; a missing length bound; a body that stopped referencing `_shared/reporting.md` |
| 15 — `check_reporting_host_difference_is_single_sourced` | The Claude-card and Codex-no-card facts each appear in exactly one file under their host's `platform/` tree, and in neither the neutral bodies/contract nor the other host's tree | The fact duplicated across two files on one host; the fact leaked into a neutral file; the fact crossed into the other host's tree |

`README.md`'s linter row and `tests/plugin-lint.sh`'s own header move from thirteen rules to fifteen; `check_present_tense_prose_names_the_rule_count` (rule 12) is what keeps that number honest, and its existing fixture mutation moved from `sed 's/thirteen rules/twelve rules/'` to `fifteen rules` → `fourteen rules` since the old substitution target no longer exists in the file it mutates.

## Verification

`tests/hooks-test.sh` gained four named cases, each proved red against `610aaf9` on a `cp -a` scratch copy before this change landed (never `git stash`, the shared working tree untouched):

- a body missing the contract reference fails lint BY NAME (`skills/_shared/bodies/debug.md arms or launches without referencing the milestone contract`);
- a milestone reduced to "report the result" fails on its missing required facts;
- a contract with no length-bound sentence fails;
- the Claude-card fact duplicated into a second `platform/claude/` file fails on the file count, not just its presence.

On the scratch copy at `610aaf9` (pristine `git reset --hard` + `git clean -fd`, then this change's two test files overlaid on top), the suite reports 5 failures: the generic "plugin lint clean" case plus all four named cases — proving none of them is vacuous. At this change's HEAD the suite is clean: native 1156/0/0 (baseline 1152 + 4), the `bash:3.2` container 1074/0/9 (baseline 1070/0/9 + 4, same 9 skips).

## Consequences

- The operator now reads what got armed, what got launched and on what assignment, what a verdict decided, what a judge returned, and what a slice or wave closed as — five short facts instead of a bare tool-call stream, on both hosts.
- A future model reading these bodies cannot satisfy the milestone requirement with a bare "done" sentence without failing `tests/plugin-lint.sh` rule 14 first.
- A future edit that copies the Claude-card or Codex-no-card sentence into a second file, or lets either leak into a neutral body, fails rule 15 by name rather than shipping silently.
- `docs/blueprint.md`'s index gains this decision under the existing 2026-08-05 — codex-fluidity heading.
