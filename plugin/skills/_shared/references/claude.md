# Shared layer — Claude Code

Host binding for the shared concerns no single wrapper binds: how a delegation's report arrives on this host, `../front-surface.md`'s wiring, and `../reporting.md`'s delivery.

## Making a launch wait

The `Agent` tool always launches in the BACKGROUND and returns at once, with the agent id and nothing about the work — this host offers no foreground flag. The delegation's report therefore arrives in a LATER turn, as a completion notification that re-enters the conversation; that notification IS the resume, and the turn that launched it ends there — correctly, not a stall. N delegations in one message each return their own notification; read every report before anything moves.

**Nothing may act on a report it has not read.** Never predict, assume or report a delegation's result before its notification, and never relaunch a delegation still in flight — the notification is what resumes it, and a second launch over the same tree is two writers in one slice.

**The watchdog.** Under an unattended run, the `Stop` net asks once for a watchdog while delegations are in flight and none is live for this session. When it asks, start `"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" watch` as a BACKGROUND Bash task (`run_in_background`) and end the turn. Its exit re-invokes the run by itself, so nothing is armed before a launch.

**Reading the watch's exit.** Exit 0 means every delegation ended: continue normally, because the completion notifications carry the reports. Exit 3 prints one line per delegation it names — `stuck: <id> (<type>) silent <N> min`, `long-running: <id> (<type>) in flight <N> min`, or `ended-without-notice: <id> (<type>)`. Journal each line with `oso-state journal` and say it in the stream, naming the id, the silence or duration, and the agent_type. Then follow the flow's own route: keep waiting on a delegation still in the in-flight set, or treat one gone from it as a blocked delegation and relaunch it fresh. Never call a delegation lost.

This governs every launch made through the Agent tool.

## The model a launch carries

The `Agent` tool takes a `model` parameter per launch, and it is what overrides the launched agent's own frontmatter for that one launch. Pass what the operator record's profile holds for the role being launched, spelled in this host's own aliases: a `default` tier is `sonnet` here and a `strong` tier is `opus`, while a role the profile names a model of its own for passes that name as written instead.

A record carrying no profile, or a profile leaving the launched role unnamed, passes no `model` at all and leaves the agent's frontmatter standing — the behaviour every launch had before a profile existed. The Launching milestone that `../reporting.md` requires names whichever of the two the launch ran on, and never a model nobody chose.

## Front-surface binding

- The mode labels are `/plan`, `/quick` and `/debug`.
- Invoke the installed `impeccable:impeccable` skill through the Skill tool, passing `init`, `document` or `audit <touched surfaces>` as the explicit argument.
- The filesystem payload to an applier uses the installed Impeccable skill's `SKILL.md` and `reference/` playbook directory — read, never invoked.
- Record the independent installed-plugin numeral from `claude plugin list`.
- Route design findings to the `oso-applier` agent through the Agent tool in fresh context, under the **Making a launch wait** rule above.
- When Impeccable is absent, give the two-step remedy `/plugin marketplace add pbakaus/impeccable` then `/plugin install impeccable@impeccable`.

## The native card is not the report

Launching a delegation, or forking a judge, draws this client's own native subagent card — a UI element the harness cannot suppress, showing only that something ran, with no role name, assignment, tree, or verdict. The milestone text `../reporting.md` requires is never skipped because a card is on screen and never folded into its caption: it is delivered exactly as every other operator-facing content on this host — except under the carve-out below.

## The unattended run — the carve-out, and the record that pays for it

An UNATTENDED RUN is this repository's runtime state carrying `auto=running` for this session. While it stands, operator-facing MILESTONE text does NOT end the turn — it rides the stream as the work happens, with the next tool call in the same turn — because ending the turn at every milestone stalls with nobody there to say "continue." Everything else this host delivers — a question round, a plan document, an approval gate — still ends the turn; none of them belongs to a run nobody is watching.

The cost is accepted rather than denied: this TUI drops text before a same-turn tool call, so a streamed milestone may never reach the screen. Every milestone `../reporting.md` fires is ALSO appended full-text with `oso-state journal "<the milestone exactly as written>"` — one journal per change, named by `auto_change` — which the operator reads on return, survives a compaction, and makes a swallowed line cosmetic rather than lost.

Two deliveries still END THE TURN under the marker, and the list is closed: the PARK, and the final report of the run the operator armed — a plain-AUTO change's own close, or a chain's report over the whole queue. Each hands the run back rather than reporting a milestone. The close is SEQUENCED for that reason — disarm first (`auto=done`, a tool call), the report after as the same turn's trailing text, since text following a tool call delivers where text preceding one may not. A roadmap CHILD's own close is neither of the two: the chain arms the next child in the same turn, so that close rides the stream and the journal like any milestone. A turn ended by a LAUNCH is no delivery at all: the completion notification resumes the run, per **Making a launch wait** above.

The autocontinue gate in `dist/gate.js` is the mechanical net behind all of it, never a substitute. It reads `auto=running` and holds while subagents are in flight, asking once for the watchdog of **Making a launch wait** when none is live. A turn that ends with nothing in flight, without parking or closing the run, is pushed on. The pushes stop after 3 without progress, where progress is a commit on any local branch, a flow state transition, or a subagent completion.
