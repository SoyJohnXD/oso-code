# Plan mode — Claude Code

## The delivery contract — anti-swallow

The Claude Code TUI drops assistant text that precedes a tool call in the same turn. So operator-facing content — the intent presentation, the surface-map presentation, any narrative the operator must read — must END the turn as plain text, with the tool call (`AskUserQuestion`, `ExitPlanMode`) in a LATER turn. Context a question round needs travels INSIDE the `AskUserQuestion` fields (question text, option descriptions), never as prose before the call.

One exception stands and `reporting.md` beside this file states it whole rather than this section restating it: while this repository's state carries `auto=running`, the run is UNATTENDED and its milestone text rides the stream instead of ending the turn, journaled full-text in its place, with the park and the final report still ending it. Nothing here changes for a run with no such marker — and phases 1–5 always run with the operator, so no exception reaches this file's own gates.

## Question rounds

The tool is `AskUserQuestion`, and one round holds 4 questions maximum — its platform cap. §2 step 5 feeds Decision rounds at that same number.

## The approval gate

`ExitPlanMode` is the single approval gate, and the plan document §5 builds is its `plan` argument — repaso-first, full-detail-after. Its native approval UI is what renders that document, and the operator's approval there is what starts execution. On approval, exit Plan Mode.

Where this change is running as a child of the ROADMAP mode's chain, this gate is not its to reach: `roadmap.md` beside this file states what stands in its place — the one approval that mode's §3 took, and the plain-text delivery §5's document rides instead of the `plan` argument above. Read it there before phase 1, and present no gate the roadmap already passed.

## Making a launch wait

This host offers no foreground flag on a launch — the flag this section claimed until now is retired, because the `Agent` tool's schema never carried it. That tool always launches in the BACKGROUND and returns at once, with the agent id and nothing about the work.

The delegation's report therefore arrives in a LATER turn, as a completion notification that re-enters the conversation. That notification IS the resume. The turn that launched ends there, and ending it is correct rather than a stall.

**Nothing may act on a report it has not read.** A step taken before the notification arrives is a step taken on a verdict nobody has, which is the whole reason the neutral body requires the read at all. So never predict, assume or report a delegation's result before its notification, and never relaunch a delegation that is in flight — the notification is what resumes it, and a second launch over the same tree is two writers in one slice.

**The marker.** Before any launch whose result arrives in a later turn, arm `"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" set auto_wait=<label>` — the label being the slice number or `wave-<n>`, matching `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$` — and return it to `auto_wait=none` the same way once every report for that label has been read. Under an unattended run this is what stops the `Stop` net counting a delegation's turn-end as a stall; the net believes a mark for 45 minutes and then stops believing it, so a mark left armed EXPIRES rather than disarming the net for good. Arm it on EVERY delegation and not only under `auto=running`: one unconditional rule survives a compaction where a conditional the orchestrator must re-derive does not, and nothing reads the key without the marker, so an attended run pays only the write.

This governs every launch made through the Agent tool, named by that property rather than by a list the next tool change would falsify — §6's applier, verifier and integrator, §2's exploration subagents, the integration gate's verifier, a red slice's relaunched applier, §7's debt-cleanup applier. N launches in one message all end the same turn and each returns its own notification; the wave loop reads every report before anything moves.

## The explorer

§2 step 1's exploration subagents are the built-in `Explore` agent.

## Shared-file paths

Wherever the neutral body names a file as `_shared/<file>.md`, it is spelled `${CLAUDE_SKILL_DIR}/../_shared/<file>.md` here. That interpolation resolves to an absolute path, which is what the applier and verifier payloads need — they are handed the rubric as a path they open themselves.

## The state command

Every `oso-state <verb> …` the neutral body instructs runs as:

`"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" <verb> …`

so `oso-state set mode=plan active_slice=<n> verify_green=false` is run as `"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" set mode=plan active_slice=<n> verify_green=false`, and `oso-state show`, `oso-state clear` and `oso-state event <verb> "<value>"` take the same prefix. The state itself is the repository's, not the session's — the session id is what the audit trail records each line under and what the teardown reads back — and a write spelled without it does not run at all.

## The runtime gates, and the two layers of the commit rail

The gates are this plugin's own hooks: they deny `git commit` while `verify_green` is false and deny file edits while no slice is active. The `pre-commit` hook arms on `CLAUDE_CODE_SESSION_ID`, which the client puts in every process the Bash tool starts and no operator's own terminal carries — so an operator committing in this repo themselves never meets it.

The commit rail has two layers and the wave loop's green window (§6) exists because neither can see which worktree a commit comes from:

- the git `pre-commit` hook, because `core.hooksPath` is an absolute path every linked worktree inherits and the state it reads is the repository's, not the tree it fired in;
- the `PreToolUse` matcher, because it reads the command line and nothing else.

The teardown §6 arms `repo_path` for is the `SessionEnd` hook, which runs `git worktree remove` and `git worktree prune` in the repo named there.

## What the unattended marker arms on this host

Three of this plugin's hooks read the `auto` marker the AUTO disposition writes, and they are what "unattended" costs and buys here:

- `auto-continue.sh` — the `Stop` net. It reads `auto=running` and pushes the run on when a turn ends without parking or closing it, capped at a fixed number of pushes that moved the journal nowhere. `reporting.md` beside this file owns the delivery carve-out this net stands behind.
- `reanchor-after-compact.sh` — `SessionStart` with `source=compact`. A compaction takes the window and not the position: this hook hands the fresh context the three places the position actually lives — the `oso/index` row's `NEXT:` line, `oso-state show`, and the run journal. How much window the client holds before compacting is the `autoCompactWindow` setting, which the harness can ask for and never guarantee, so this re-anchor is the floor under an unattended run rather than the window being one.
- `block-prod-deploy.sh` — a `PreToolUse` rail armed only while the marker is running: a production deploy, and a push off the run's own branch, are denied to a run nobody is watching. Taking the run back (`auto=done`) is what disarms it.

The marker is the flow's to write, never a hook's: `oso-state set auto=running auto_change=<change-slug>`, `auto=parked`, `auto=done`, exactly where the neutral body's own ground rules put each flip.

## The worktree root

`<worktree root>` in §6 is `~/.local/state/oso-code/worktrees/<sanitized session>`, where sanitized is `${CLAUDE_CODE_SESSION_ID}` with everything outside `a-zA-Z0-9-` stripped — which is what the hooks do to it before they look, so a path spelled any other way is a path the teardown never finds.

## Naming and invoking the harness's own skills

The neutral body names each one by role; here they carry the plugin prefix, and each is reached through the Skill tool:

| The body says | Here it is | Reached by |
| --- | --- | --- |
| the QUICK mode | `oso-code:quick` | the operator invokes it — a mode is never model-invoked |
| the DEBUG mode | `oso-code:debug` | the operator invokes it — a mode is never model-invoked |
| the doubt-pass judge | `oso-code:doubt-pass` | the Skill tool; its frontmatter is what forks it |
| the debt-sweep judge | `oso-code:debt-sweep` | the Skill tool; its frontmatter is what forks it |
| the triage judge | `oso-code:triage` | the Skill tool; its frontmatter is what forks it |
| the security-pass judge | `oso-code:security-pass` | the Skill tool; its frontmatter is what forks it |

The three delegates the body names — `oso-applier`, `oso-verifier`, `oso-integrator` — are agents, not skills: reach them with the Agent tool, under the wait rule above. An applier has no Skill tool of its own, which is why §6 step 2 hands it Impeccable's files as PATHS to read rather than a skill to invoke.

## Front-surface binding

When `../../front-surface.md`'s trigger fires, READ `front-surface.md` beside this file NOW. It is the single Claude Code binding for Impeccable's invocation, package-version record, agent route and absence remedy; this mode supplies only the PLAN wiring indexed by the neutral matrix.

## Reporting binding

READ `reporting.md` beside this file NOW. It is the single Claude Code binding for what this host's own UI shows, and does not show, when the milestone contract at `../../reporting.md` fires.
