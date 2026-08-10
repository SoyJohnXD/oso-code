# Roadmap mode — Claude Code

## The delivery contract — anti-swallow

The Claude Code TUI drops assistant text that precedes a tool call in the same turn. So operator-facing content — the queue as it is planned, the approval document, the presence phase, every milestone report the chain makes while the operator is away — must END the turn as plain text, with the tool call in a LATER turn. Context a question round needs travels INSIDE the `AskUserQuestion` fields (question text, option descriptions), never as prose before the call.

## Question rounds

The tool is `AskUserQuestion`, and one round holds 4 questions maximum — its platform cap. §1 plans the queue with the operator at that same number.

## The approval gate

`ExitPlanMode` is the gate, and §3's one document — §1's queue with §2's policy after it — is its `plan` argument, the same way `plan.md` beside this file hands it a change's own plan. §1 through §3 are the read-only exchange, so they run inside Plan Mode, mirroring the boundary the PLAN mode's own ground rules draw around its phases 1–5: enter it before §1, stay until the document is delivered, and the operator's approval at that gate is what starts the chain.

## How far the chain runs unattended

All of it. §3's approval is the only one this host asks the operator for: §4 runs every child from its planning to its close — or to the set-aside §3's last bullet describes, where a queued decision leaves that child no further to go — without returning to them, and §5 is where everything §2 queued arrives. A decision §2's policy cannot resolve is queued rather than asked, so nothing between §3 and §5 waits on a human being present; a child left set aside is what that can cost, and it is never a stall in front of one.

**So a child plans OUTSIDE native Plan Mode here, and that is what one approval costs.** The gate above is the transition out of that mode as much as it is the approval, and the way back out of it is another `ExitPlanMode` — a second approval, which is exactly what §3's one was given in place of. A child therefore enters it nowhere: the phases `plan.md` beside this file spells run with the host outside Plan Mode, and the Repaso-headed document that mode's §5 builds is delivered as plain text under the delivery contract above rather than as this gate's `plan` argument — the case the neutral body's §3 calls the host asking for none, so §3's approval is what covers it. What keeps those phases read-only is the PLAN flow's own rule — nothing before its §6 writes code — rather than the host: the edit gate `plan.md` beside this file records arms on runtime state a child's planning does not write until §5's approval, so it stands armed for a child behind one that closed or was set aside and not for the first child of a fresh roadmap.

## Shared-file paths

Wherever the neutral body names a file as `_shared/<file>.md`, it is spelled `${CLAUDE_SKILL_DIR}/../_shared/<file>.md` here. That interpolation resolves to an absolute path, which is what a payload handed to another context needs.

## The state command and the worktree root — routed to `plan.md`, not restated here

§4 reaches for two host spellings, and both are already written in `plan.md` beside this file, where the child itself reads them. This file ROUTES to them and restates neither, so one spelling per host cannot drift into two:

- **The state command** — every `oso-state <verb> …` §4 instructs, its `set roadmap={roadmap}`, its `set roadmap=none` and the `show` that reads either back included, runs under the prefix that file's own **The state command** section spells. Spelled bare, without that prefix, the command exits on its usage message and writes nothing at all, so following this route is not optional.
- **The worktree root** — `<worktree root>`, the SECOND place §4's bar reads before every arming, is the path that file's own **The worktree root** section spells.

READ both sections there before §4 arms its first child.

## Reporting binding

READ `reporting.md` beside this file NOW. It is the single Claude Code binding for what this host's own UI shows, and does not show, when the milestone contract at `../../reporting.md` fires.
