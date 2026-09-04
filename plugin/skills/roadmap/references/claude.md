# Roadmap mode — Claude Code

## The delivery contract — anti-swallow

The Claude Code TUI drops assistant text that precedes a tool call in the same turn. Operator-facing content — the queue as it is planned, the approval document, the presence phase — must END the turn as plain text, with the tool call in a LATER turn. Context a question round needs travels INSIDE the `AskUserQuestion` fields, never as prose before the call.

One exception stands, and `${CLAUDE_SKILL_DIR}/../_shared/references/claude.md`'s **The unattended run** section states it whole: §5's three stopping moments still end the turn regardless.

## Question rounds

The tool is `AskUserQuestion`, and one round holds 4 questions maximum — its platform cap. §1 plans the queue with the operator at that same number.

## The approval gate

`ExitPlanMode` is the gate, and §3's one document — §1's queue with §2's policy after it — is its `plan` argument, the same way `${CLAUDE_SKILL_DIR}/../plan/references/claude.md` hands it a change's own plan. §1 through §3 run inside Plan Mode: enter it before §1, stay until the document is delivered, and the operator's approval at that gate is what starts the chain.

## How far the chain runs unattended

All of it. §3's approval is the only one this host asks the operator for — everything after runs the way the flow's own §3 through §5 already state.

**So a child plans OUTSIDE native Plan Mode here, and that is what one approval costs.** The gate above is the transition out of that mode as much as it is the approval, and the way back out of it is another `ExitPlanMode` — a second approval, which is exactly what §3's one was given in place of. A child therefore enters it nowhere: the phases `${CLAUDE_SKILL_DIR}/../plan/references/claude.md` spells run with the host outside Plan Mode, and the Repaso-headed document that mode's §5 builds is delivered as plain text under the delivery contract above rather than as this gate's `plan` argument — the case the flow's own §3 calls the host asking for none. What keeps those phases read-only is the PLAN flow's own rule — nothing before its §6 writes code — rather than the host: the edit gate `${CLAUDE_SKILL_DIR}/../plan/references/claude.md` records arms on runtime state a child's planning does not write until §5's approval, so it stands armed for a child behind one that closed or was set aside and not for the first child of a fresh roadmap.

## Shared-file paths

Wherever the flow names a file as `_shared/<file>.md`, it is spelled `${CLAUDE_SKILL_DIR}/../_shared/<file>.md` here, resolved to an absolute path — what a payload handed to another context needs.

## The state command and the unattended rails — routed to `plan.md`, not restated here

§4 reaches for two host spellings, and both are already written in `${CLAUDE_SKILL_DIR}/../plan/references/claude.md`, where the child itself reads them. This file ROUTES to them and restates neither, so one spelling per host cannot drift into two:

- **The state command** — every `oso-state <verb> …` §4 instructs, its `set roadmap={roadmap}`, its `set roadmap=none` and the `show` that reads either back included, runs under the prefix that file's own **The state command** section spells. Spelled bare, without that prefix, the command exits on its usage message and writes nothing at all.
- **The unattended rails** — the three hooks §4's `auto=running` arms on this host, named one by one in that file's own **What the unattended marker arms on this host** section: the `Stop` net that pushes the chain on, the `SessionStart` re-anchor after a compaction, and the production-boundary rail that stands while the marker does.

READ both sections there before §4 arms its first child.

## Reporting binding

READ `${CLAUDE_SKILL_DIR}/../_shared/references/claude.md` NOW. Its **The native card is not the report** and **The unattended run** sections are the single Claude Code binding for what this host's own UI shows, and does not show, when the milestone contract at `${CLAUDE_SKILL_DIR}/../_shared/reporting.md` fires.
