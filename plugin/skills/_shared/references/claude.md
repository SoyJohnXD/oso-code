# Shared layer — Claude Code

Host binding for the shared concerns no single wrapper binds: how a delegation's report arrives on this host, `../front-surface.md`'s wiring, and `../reporting.md`'s delivery. Every skill file that reaches one of them points here rather than restating it.

## Making a launch wait

The `Agent` tool always launches in the BACKGROUND and returns at once, with the agent id and nothing about the work — this host offers no foreground flag. The delegation's report therefore arrives in a LATER turn, as a completion notification that re-enters the conversation; that notification IS the resume, and the turn that launched it ends there — correctly, not a stall. N delegations in one message each return their own notification; read every report before anything moves.

**Nothing may act on a report it has not read.** Never predict, assume or report a delegation's result before its notification, and never relaunch a delegation still in flight — the notification is what resumes it, and a second launch over the same tree is two writers in one slice.

**The marker.** Before any launch whose result arrives in a later turn, arm `"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" set auto_wait=<label>` (the slice number or `wave-<n>`, matching `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`), and return it to `auto_wait=none` once every report for that label is read. Under an unattended run this is what stops the `Stop` net counting a delegation's turn-end as a stall: a mark holds for 45 minutes, renewed by a journaled milestone up to 3 times, then expires rather than holding forever. The whole bound is scoped to ONE label under ONE session — a new label, a return to `auto_wait=none`, or any rewrite of the mark starts it over — so it bounds a single delegation's hold and guarantees nothing about a run as a whole. Arm it on EVERY delegation, not only under `auto=running` — one unconditional rule survives a compaction where a conditional does not, and an attended run pays only the write.

This governs every launch made through the Agent tool.

## Front-surface binding

This binds the platform-shaped edges of `../front-surface.md`; it does not restate that file's trigger, pin recipe, audit exit bar or absence policy.

- The mode labels are `/plan`, `/quick` and `/debug`.
- Invoke the installed `impeccable:impeccable` skill through the Skill tool, passing `init`, `document` or `audit <touched surfaces>` as the explicit argument.
- The filesystem payload to an applier uses the installed Impeccable skill's `SKILL.md` and `reference/` playbook directory — read, never invoked.
- Record the independent installed-plugin numeral from `claude plugin list`; the npm CLI numeral comes from the neutral pin recipe.
- Route design findings to the `oso-applier` agent through the Agent tool in fresh context, under the **Making a launch wait** rule above.
- When Impeccable is absent, give the two-step remedy `/plugin marketplace add pbakaus/impeccable` then `/plugin install impeccable@impeccable`, continue without the design bar, and record the gap where the invoking mode requires.

## The native card is not the report

Launching a delegation, or forking a judge, draws this client's own native subagent card — a UI element the harness cannot suppress, showing only that something ran, with no role name, assignment, tree, or verdict. The milestone text `../reporting.md` requires is never skipped because a card is on screen and never folded into its caption: it is delivered exactly as every other operator-facing content on this host, ending the turn as plain text with the tool call in a later turn — except under the carve-out below.

## The unattended run — the carve-out, and the record that pays for it

An UNATTENDED RUN is this repository's runtime state carrying `auto=running` for this session. While it stands, operator-facing MILESTONE text does NOT end the turn — it rides the stream as the work happens, with the next tool call in the same turn — because ending the turn at every milestone stalls with nobody there to say "continue." Everything else this host delivers — a question round, a plan document, an approval gate — still ends the turn; none of them belongs to a run nobody is watching.

The cost is accepted rather than denied: this TUI drops text before a same-turn tool call, so a streamed milestone may never reach the screen. Every milestone `../reporting.md` fires is ALSO appended full-text with `oso-state journal "<the milestone exactly as written>"` — one journal per change, named by `auto_change` — which the operator reads on return, survives a compaction, and makes a swallowed line cosmetic rather than lost.

Two deliveries still END THE TURN under the marker, and the list is closed: the PARK, and the final report of the run the operator armed — a plain-AUTO change's own close, or a chain's report over the whole queue. Each hands the run back rather than reporting a milestone. The close is SEQUENCED for that reason — disarm first (`auto=done`, a tool call), the report after as the same turn's trailing text, since text following a tool call delivers where text preceding one may not. A roadmap CHILD's own close is neither of the two: the chain arms the next child in the same turn, so that close rides the stream and the journal like any milestone. A turn ended by a LAUNCH is no delivery at all: the completion notification resumes the run, per **Making a launch wait** above.

`auto-continue.sh` is the mechanical net behind all of it, never a substitute: it reads `auto=running`, pushes an unattended run on when a turn ends without parking or closing it, and gives up after a fixed number of pushes that made no journal progress. A turn ended by a launch still in flight is not that case — the `auto_wait` marker is what the net reads there, and it holds instead of pushing until that mark expires.
