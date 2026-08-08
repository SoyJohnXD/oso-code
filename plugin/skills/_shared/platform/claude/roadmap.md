# Roadmap mode — Claude Code

## The delivery contract — anti-swallow

The Claude Code TUI drops assistant text that precedes a tool call in the same turn. So operator-facing content — the queue as it is planned, the approval document, the presence phase, every milestone report the chain makes while the operator is away — must END the turn as plain text, with the tool call in a LATER turn. Context a question round needs travels INSIDE the `AskUserQuestion` fields (question text, option descriptions), never as prose before the call.

## Question rounds

The tool is `AskUserQuestion`, and one round holds 4 questions maximum — its platform cap. §1 plans the queue with the operator at that same number.

## How far the chain runs unattended

All of it. §3's approval is the only one this host asks the operator for: §4 runs every child from its planning through its close without returning to them, and §5 is where everything §2 queued arrives. A decision §2's policy cannot resolve is queued rather than asked, so nothing between §3 and §5 waits on a human being present.

## Shared-file paths

Wherever the neutral body names a file as `_shared/<file>.md`, it is spelled `${CLAUDE_SKILL_DIR}/../_shared/<file>.md` here. That interpolation resolves to an absolute path, which is what a payload handed to another context needs.

## Reporting binding

READ `reporting.md` beside this file NOW. It is the single Claude Code binding for what this host's own UI shows, and does not show, when the milestone contract at `../../reporting.md` fires.
