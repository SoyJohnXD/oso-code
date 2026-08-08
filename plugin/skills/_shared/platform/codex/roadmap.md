# Roadmap mode — Codex

## The delivery contract

The adapter makes no claim about whether Codex preserves operator-facing text before a same-turn tool call, and the harness depends on no such behavior. It applies the conservative host-independent policy: operator-facing content — the queue as it is planned, the approval document, the presence phase, every milestone report the chain makes — ENDS the turn as plain text, with any tool call in a LATER turn.

## Question rounds

The tool is `request_user_input`, and it exists ONLY inside Plan Mode on this host — which is where this mode starts. The operator enters native Plan Mode before invoking, exactly as they do for `$oso-code:plan`, and the wrapper refuses to begin §1 in Default mode. Its schema accepts a maximum of 3 questions in one call, so §1 plans the queue with the operator at 3 per round. A fourth question starts the next round; it never rides an invalid call and never gets dropped.

## How far the chain runs unattended — everything except each child's own approval

This host CHAINS the roadmap; it does not run it unattended. Every child is planned, executed and closed in order and the next one follows without the operator arranging it, but each child still stops at the plan approval this host's rail enforces, and that rail passes only on the byte-exact operator prompt `plan.md` beside this file spells. No model may produce that prompt on the operator's behalf: a harness that types its own approval has approved nothing. So §3's one approval covers the roadmap, and each child waits for the operator to release it.

That is a DEGRADATION against the flow the neutral body describes, not a local variant of it, and it ships recorded rather than hidden: `docs/parity-codex.md` carries the row, with the mitigation beside the boundary it cannot remove. What this host still gives is everything either side of that stop — one planning exchange, one global ledger, the autonomy policy answering what surfaces mid-child, the queue advancing on its own, and the presence phase at the end. What it does not give is walking away.

## Shared-file paths

Wherever the neutral body names a file as `_shared/<file>.md`, it is spelled `../_shared/<file>.md` here, resolved against the directory holding the `SKILL.md` you were routed through — the resolution rule Codex states for every relative path a skill writes. Expand it to an absolute path before putting it in a payload another context reads.

## Reporting binding

READ `reporting.md` beside this file NOW. It is the single Codex binding for what this host's own UI shows, and does not show, when the milestone contract at `../../reporting.md` fires.
