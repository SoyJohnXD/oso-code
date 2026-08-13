# 0147 — The AUTO ceiling: local and staging, the PR finish, production never

Date: 2026-08-13
Status: accepted
Supersedes: ADR-0136 (its "fixed at four" count and the scope of its first item — the list grows to FIVE under that decision's own growth clause, and "a push, a PR, or a release" is re-scoped to a push onto a SHARED branch, the PR MERGE and a release; the three tiers, the irreversibility bar, the two outcomes and the four other refusals stand unchanged), ADR-0093 (its "push and PR are the two the operator asks for" clause, which now holds for a run with an operator at it and becomes the FINISH for one without; the commit boundary itself, the per-slice commit and the ledger's Verification row all stand), ADR-0137 (its Part 3 clause "the push, the PR and an accepted security residual stay the operator's on both routes", for the push and the PR alone — under an unattended run they are that run's own finish, while the PR MERGE, a release, a production deploy and an accepted security residual stay the operator's on every route; the machine entry condition, the chain's two words, the four exits and the set-aside all stand)
Reconciled: applied — `docs/blueprint.md`'s Mode 1 phase 7 states the push and the PR as the operator's while they are here and the run's own finish where they are not, and its Mode 4 phase 2 states the five the policy never takes with the production deploy among them. The ceiling itself is declared in `plugin/skills/_shared/bodies/plan.md`'s AUTO ground rules — the reach, the `oso-run/<change>` branch cut at §5's initialize beside the marker, the three project facts it rests on, the deny-pattern mirror and the no-record refusal — with §5's initialize cutting the branch, §6 step 4's commit landing on it, and §7 step 8 spelling the push, the PR and the pending it parks on. `plugin/skills/_shared/bodies/roadmap.md` §2 carries the five-item never-solo list and the standard-practice tier's citation duty. The rail is `plugin/hooks/block-prod-deploy.sh`, wired on `PreToolUse` in both `plugin/hooks/hooks.json` and `codex/hooks/hooks.json`, recorded in `tools/hook-gates.txt` as wired on both hosts and published in `bootstrap/hook-hashes.txt`. `bootstrap/claude-global.md`, `bootstrap/codex-global.md` and `plugin/output-styles/oso.md` carry the same boundary. `tests/plugin-lint.sh`'s `check_auto_ceiling_holds_the_finish_and_the_evidence` holds the re-scoped list, the finish, the citation duty and the blocked exit's marker write.
Source: this change (auto-continuity), decisions D3, D14 and D16; the question ADR-0144 left open by naming a run the operator can walk away from without ever saying how far it walks

## Decision

**An unattended run reaches this machine, the environments its own verification bar reaches from it, its own branch and the pull request that finishes it — and stops there.** The ceiling is CONTRACT rather than improvisation, because a run whose reach is inferred from what a tier felt able to do has no reach at all.

### Part 1 — the reach, stated as three things and not as a prohibition list

- **This machine and the environments the change's own bar names** — local, and STAGING where the project has one. A verification bar that reaches staging is a bar the operator wrote; a run honoring it is running their checks, not choosing an environment.
- **Its own branch.** A run under AUTO works on `oso-run/<change>`, cut at §5's initialize in the same breath as the marker write, from wherever the checkout stands — the DEFAULT branch being the case that cut exists for. On a RESUME nothing is cut: `git rev-parse --abbrev-ref HEAD` already reads that name, because this run cut it before.
- **The pull request that finishes it.** §7 step 8 pushes the branch and opens the PR, and the reach ends at that PR rather than at its merge.

The branch name sits deliberately OUTSIDE the slice namespace `oso/<change>/<slice>`, and the reason is git's rather than taste: a ref cannot be `oso/<change>` while `oso/<change>/<slice>` is a directory of refs, so a run branch named inside that namespace collides with the first parallel wave the change cuts. Cutting from wherever the checkout stands rather than from a named base is the other half — the run has one branch for its whole length, and a cut that demanded a particular starting point would fail on the operator's own working branch for no benefit the run can use.

The branch is RECORDED in the change's ledger at the cut, because the close pushes a recorded name rather than whatever the checkout happens to say by the time it gets there.

### Part 2 — the finish, and the pending it parks on

With the operator present, the push and the PR are still theirs to ask for and neither happens without it (ADR-0093). Under an unattended run they are the FINISH — the thing the plan approval that armed the run chartered — and it runs after step 7's green: push the recorded branch with `push -u origin oso-run/<change>`, open the PR against the base the per-project record holds for this repository (ADR-0149), and record the branch, the PR and its base in the run journal and in the final report.

Where the repository has no remote, or the push or the PR call fails, the finish is PARKED as a NAMED PENDING in that final report — the branch, its commits, and what stopped them — never a silent skip and never a retry loop. The close still disarms and delivers exactly as it otherwise would. A retry loop is the one shape explicitly refused: nobody is there to watch it, and a run that spends its remaining turns retrying a network call has traded an account the operator can act on for an outcome they cannot read.

### Part 3 — the never-solo list grows to five, under ADR-0136's own clause

ADR-0136 fixed the list at four and wrote the condition for its own growth: if a fifth such refusal is ever added to a flow, this list has to grow with it or a declared policy starts looking like a licence. This change adds one and the list grows.

- **A push to a SHARED branch, a PR MERGE, or a release** — the first item RE-SCOPED rather than replaced. What an unattended run does with its own work was never what that item refused: the change branch leaves the machine once, at the close, which is what the approval bought. The refusal starts one step past it, where a push lands a commit nobody reviewed in front of work other people build on, and a merge makes the change everybody's rather than a diff somebody reads.
- **A production deploy** — the fifth item, entering explicitly. It is the step that puts the change in front of the people using the system, and no tier's confidence is an undo for that.
- **A ledger amendment**, **accepting a security residual** and **a forced deletion** stand exactly as ADR-0136 records them.

The re-scoping is net GROWTH and not a trade. The old item's plain reading forbade the finish this decision charters, so leaving it unread would have made §7 step 8 a violation of the policy the same run is bound by.

### Part 4 — a deny-only rail, on both hosts

`block-prod-deploy.sh` is a `PreToolUse` gate that arms ONLY while this session's own run reads `auto=running`; an unmarked repository exits before the payload is parsed at all. It is DENY-ONLY: it emits a denial or nothing, never an allow and never an ask, so it can subtract from what a run may do and can never add to it.

It refuses three things and each is bounded by what it can actually read:

- **A production deploy it recognizes built in** — `vercel` targeting production, `netlify deploy --prod`, `firebase deploy` — resolved through the package runners that front them, so `npx vercel --prod` is the same command as `vercel --prod`.
- **Whatever THIS repository names** — one ERE per line in `$OSO_STATE_DIR/deploy-deny/<digest>.patterns`, the mirror ADR-0149's ceiling ask writes, checked before the built-ins. A project's own deploy route is a project fact and no built-in list will ever hold it.
- **A push that does not name the run's own branch**, which is the ceiling's branch clause read at the rail instead of only in the prose.

A state file that exists but does not read as state records is UNCERTAIN and denies, rather than passing for unmarked. That is the harness's standing rule for an armed gate (ADR-0095) and it is the one place this rail is not fail-open: a run whose state cannot be read is exactly the run whose ceiling cannot be checked.

Every denial names the same recovery, because a rail with no way out is a rail the operator fights: take the run back with `auto=done`, and run the command from a terminal the gate does not arm in.

### Part 5 — a delegated answer carries its basis, never the word "standard"

The ceiling bounds what a tier may TAKE; this clause bounds what a tier may REST ON, and the two ship together because a policy answering in an absent operator's place is auditable only if both hold.

ADR-0136's second tier decides by what current practice standardizes. What it may never do is answer on its own NAME. It consults a current source wherever one is reachable — the docs route for a library, a framework or an API, the official documentation for everything else — and CITES it in the delegated record; where no source is reachable at all, it writes the argument out instead, marked UNSOURCED. The delegated mark gains the BASIS as a field of the rationale it already carries, so no second shape for recording a decision is introduced.

"It is the standard practice" with nothing behind it is unfalsifiable at exactly the moment nobody can question it. Marking an unsourced argument as unsourced is what keeps the tier usable where no source exists without letting the tier's own confidence pass for evidence.

## Context

ADR-0144 gave a plan run the walk-away property and deliberately said nothing about reach, because reach is not what a disposition is. That silence was survivable only until the first run actually ran: with the policy answering and the flow committing, the question "how far does this go without another person" had no answer in any text, and the honest default — everything the operator's own credentials can reach — is a run that can deploy a change nobody read.

The three facts the ceiling rests on are the PROJECT's and not the run's — where staging is, what production is and is therefore never touched, and the branch a pull request opens against — which is why they live in the per-project record and are asked at the first arming rather than at the first plan (ADR-0149). A project that never runs unattended is never asked for its production route.

Two alternatives were rejected.

**A prohibition list without a stated reach** was rejected as the shape that fails silently. Every list of dangerous operations is a list somebody has to keep current, and the first operation it misses is taken by a tier that never noticed the list was short — ADR-0136's own reasoning for preferring one question to a taxonomy. Stating the reach positively means an operation nobody enumerated is outside it by default.

**Prose alone, with no rail** was rejected because the run's whole premise is that nobody is reading. The gate's built-in refusals are narrow on purpose — three vendor CLIs — and the per-repository mirror is what makes them this project's; the prose is what the flow follows and the rail is what holds when it does not.

## The ledger of what the rule cannot check

`check_auto_ceiling_holds_the_finish_and_the_evidence` holds the re-scoped list and the citation duty in the roadmap body, the finish and its pending in the plan body's close, and the blocked exit's `auto=parked` write. Three clauses carry no marker:

- **The branch's ref-conflict reason.** The rule reads that the finish pushes; nothing holds WHY the name sits outside `oso/<change>/`, and a change that moved it inside would pass every rule here and fail at the first parallel wave.
- **The rail's deny-only shape.** No lint rule reads that hook's shell, so a version that learned to ALLOW would satisfy every text this rule checks.
- **The mirror being written before the first child arms.** The rule holds that the ask writes it; the ORDER — record and mirror before arming, never after — is held by review alone.

## Consequences

- An unattended run's output is a branch and a pull request somebody reads. That is the whole of what the approval bought, and it is deliberately less than what the machine could do: the merge, the release and the deploy each need a person, and each of the three is where the change stops being a diff.
- The never-solo list is five and the growth clause has now fired once. It stays a reading aid rather than the enforcement — each item is refused where it lives — and the precedent set here is that adding a refusal to a flow means adding it to this list in the same change.
- The production rail is the first gate this harness wires on BOTH hosts for an unattended run, and the only piece of the unattended machinery Codex has. That asymmetry is recorded in `docs/parity-codex.md` rather than left to the gate table.
- Three project facts now gate arming. A run resumed on a machine whose record was never filled arms no AUTO at all — the run proceeds attended-shaped, or parks its finish as the named pending step 8 defines — which trades an occasional refusal to arm for never guessing where production is.
- A delegated decision is now auditable in one read: the tier that answered, why that tier was reached, and the source it stands on or the argument it wrote in a source's place. What that costs is the tier's speed on a question no doc covers, and what it buys is that "standard practice" stops being a claim nobody can check after the fact.
