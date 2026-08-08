# Roadmap mode — Codex

## The delivery contract

The adapter makes no claim about whether Codex preserves operator-facing text before a same-turn tool call, and the harness depends on no such behavior. It applies the conservative host-independent policy: operator-facing content — the queue as it is planned, the approval document, the presence phase, every milestone report the chain makes — ENDS the turn as plain text, with any tool call in a LATER turn.

## Question rounds

The tool is `request_user_input`, and it exists ONLY inside Plan Mode on this host — which is where this mode starts. The operator enters native Plan Mode before invoking, exactly as they do for `$oso-code:plan`, and the wrapper refuses to begin §1 in Default mode. Its schema accepts a maximum of 3 questions in one call, so §1 plans the queue with the operator at 3 per round. A fourth question starts the next round; it never rides an invalid call and never gets dropped.

## The approval gate

There is no roadmap-shaped gate on this host. §3's one document — §1's queue with §2's policy after it — is presented under the delivery contract above and rides the same native plan-approval rail `plan.md` beside this file spells, marker, pending digest and promotion alike, passing on the same byte-exact operator prompt and on nothing else. The roadmap's approval is one pass of that rail; the per-child stops the section below records are later passes of the same one, never a second kind of gate. What a later pass COSTS the operator is not the same, though. A pass can only BEGIN inside native Plan Mode — that is where the phases `plan.md` spells build the document, and where its `Stop` capture attests before binding a digest — and can only CLOSE outside it, because the native control that approves is the same one that changes the mode; and no model may enter that mode or imitate the transition. The operator was already in Plan Mode to invoke this skill at all, so §3's own pass asks them for the approval alone, while every later pass asks them for TWO actions: re-entering native Plan Mode so that child's document can be presented, then approving it.

## How far the chain runs unattended — everything except each child's own stop

This host CHAINS the roadmap; it does not run it unattended. Every child is planned, executed and closed in order — or set aside where a queued decision leaves it, the way the neutral body's §3 and §4 describe — and the next one follows without the operator arranging it, but each child still stops at the plan approval this host's rail enforces, and that rail passes only on the byte-exact operator prompt `plan.md` beside this file spells. No model may produce that prompt on the operator's behalf: a harness that types its own approval has approved nothing. So §3's one approval covers the roadmap, and each child asks the operator for both actions of the pass above — the re-entry into native Plan Mode that lets its document be presented, then the approval that releases it.

That is a DEGRADATION against the flow the neutral body describes, not a local variant of it, and it ships recorded rather than hidden: `docs/parity-codex.md` carries the row, with the mitigation beside the boundary it cannot remove. What this host still gives is everything either side of that stop — one planning exchange, one global ledger, the autonomy policy answering what surfaces mid-child and queuing for the end what it cannot, the queue advancing on its own, and the presence phase at the end. What it does not give is walking away.

## Shared-file paths

Wherever the neutral body names a file as `_shared/<file>.md`, it is spelled `../_shared/<file>.md` here, resolved against the directory holding the `SKILL.md` you were routed through — the resolution rule Codex states for every relative path a skill writes. Expand it to an absolute path before putting it in a payload another context reads.

## Reporting binding

READ `reporting.md` beside this file NOW. It is the single Codex binding for what this host's own UI shows, and does not show, when the milestone contract at `../../reporting.md` fires.
