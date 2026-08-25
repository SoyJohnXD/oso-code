# Roadmap mode — OpenCode

## The delivery contract

The adapter makes no claim about whether OpenCode preserves operator-facing text before a same-turn tool call, and the harness depends on no such behavior. It applies the conservative host-independent policy `plan.md` beside this file states: operator-facing content — the queue as it is planned, the approval document, the presence phase, and every milestone report the chain and its children make while the operator is away — ENDS the turn as plain text, with any tool call in a LATER turn.

This host carves NO unattended run out of that rule, so the second of the two branches the neutral body's §5 writes is the one that governs here: a child's close report ends the turn and the next child's arming follows in the next one. That costs the chain a turn per child and stops it at none of them, because what carries it across each of those turn ends is the continuation rail `plan.md` names — the same rail the AUTO disposition arms, which POSTS a turn back into the session rather than refusing one. Every milestone is also appended full-text with `oso-state journal`, and that growth is what keeps the rail's turn bound from ever reading a chain in motion as a run that went nowhere.

## Question rounds

The tool is `question`, and §1 plans the queue with the operator at 3 per round — the cap `plan.md` beside this file spells for a decision round, and the cap §4's first-arming round for the `oso/preferences` ceiling fields runs inside as well. A fourth question starts the next round; it never rides an invalid call and never gets dropped. It reaches the operator only while they are watching the TUI, because a headless session denies `question` by default (ADR-0151 part 5) — no loss to this mode, whose one exchange with them is §1 through §3 and who is in it.

## The agent every phase runs on

`/oso-roadmap` routes to this host's own `build` primary agent, and the whole mode runs there: §1 through §3's exchange, §4's chain, each child's own PLAN-mode phases, and §5. Every mode on this host routes to that same agent, the phases 1–5 `plan.md` beside this file spells included, and for the reason that file states: a command's frontmatter names one agent and this mode hands its conversation to no other, so §4's own writes — `oso-state set roadmap={roadmap}`, cutting a worktree, committing a child's slice — land on whatever agent §1 started on. The roster under `opencode/agents/` names no primary to run the mode on instead: all seven declare `mode: subagent`, the delegated roles §4 reaches through `task`. `build` resolves `question` to allow and both grant-bound tools to ask, which is exactly the pair §3 and the valve below need.

What no agent permission puts under a child's planning phases is a read-only floor — and none puts one under a plain change's phases 1–5 either. Nothing is lost against the neutral body, which asks the FLOW for that property and never the host — nothing before a child's §6 writes code — and the `edits` gate on `tool.execute.before` stands behind the flow: while `mode=plan` names no active slice, an edit is denied whichever agent asks for it. `docs/parity-opencode.md` carries the row.

## The approval gate

The gate is `oso_plan_approve`, the same grant-bound tool `plan.md` beside this file spells for a change's own plan, and §3's one document — §1's queue with §2's policy after it — is its `plan` argument. Deliver that document as turn-ending plain text, then call the tool in a LATER turn carrying those exact bytes: the operator's answer to the host's authorization prompt is the whole of the approval, and the digest it binds is the digest of the bytes you passed. The tool's own description names the PLAN mode's §5 document because that is the flow it was written for; what it binds is whatever it was handed, and under this mode that is §3's.

The grant publishes this repository's plan approval — `mode=plan`, `plan_approval=approved`, the digest, the owner and the two artifact paths — and that state is what the edit and commit gates read for EVERY child of the chain. One approval arms them once, and no child re-arms them.

## How far the chain runs unattended — all of it

§3's approval is the only one this host asks the operator for. §4 runs every child from its planning to its close — or to the set-aside §3's last bullet describes, where a queued decision leaves that child no further to go — without returning to them, and §5 is where everything §2 queued arrives. A decision §2's policy cannot resolve is queued rather than asked, so nothing between §3 and §5 waits on a human being present; a child left set aside is what that can cost, and it is never a stall in front of one.

**A child crosses no approval gate here at all.** It never calls `oso_plan_approve`, and the Repaso-headed plan document the PLAN mode's §5 builds — which it still builds and still delivers, as turn-ending plain text under the delivery contract above — is exactly the case the neutral body's §3 calls the host asking for none, so §3's approval is what covers it. Under the plain AUTO disposition that gate is crossed with the operator present before the marker arms; under this mode it is crossed once, for the queue. The floor under that instruction is the host's own permission resolution rather than this file's word for it, measured on the pinned binary: the seven subagents under `opencode/agents/` resolve both grant-bound tools to `deny`, so a forked applier, verifier or judge cannot call either at all, while `build`, the one primary every mode here runs on, declares no rule for the pair and takes the installed config's own `permission.oso_plan_approve: ask`. That entry is the whole of the `ask` and it is load-bearing rather than a host default: `docs/parity-opencode.md`'s approval-rail row measures the case with it removed, where the base ruleset's `"*": "allow"` carries the same call through with no prompt at all. With it in place — the installer owns the key — no agent in the roster resolves either one to allow, so there is no path to an approval the operator did not answer.

## The valve while the chain runs, and a queue that changes after presentation

With the chain unattended, these two are what an operator has when a child derails, and both are lanes `plan.md` beside this file already spells:

- **`oso_plan_cancel`** raises its own authorization prompt and, on the grant, writes `plan_approval=cancelled` beside `mode=plan active_slice=none verify_green=false`. That closes the edit and commit gates in front of every child still to come, while leaving the run's own markers — `auto`, `auto_change` and this mode's `roadmap` key — exactly as they stand, so the record a resumed session picks the queue up from survives the abandonment. What the chain meets after it is a denied tool call and never a decision, which is §5's BLOCKED moment: say what stopped and where, flip the child's marker to `auto=parked`, and stop there.
- **A materially changed queue** — a child added, an intent redrawn, a global entry reopened — invalidates §3's approval the way §3 states. Re-present the whole document as turn-ending plain text and call `oso_plan_approve` again in a later turn; that second call binds a FRESH digest and raises the prompt again, and the operator's answer to it is the whole of the re-approval. Nothing in the lane stands in for it: `amend-plan` moves `plan_revision` and `verify_green` and touches no approval key, and the `approve-plan` verb can never fire on this host at all, because it requires a PENDING state nothing here ever arms.

## Shared-file paths

Wherever the neutral body names a file as `_shared/<file>.md`, it is spelled `../_shared/<file>.md` here, resolved against the directory holding the `SKILL.md` you were routed through — the resolution rule OpenCode states for every relative path a skill writes. Expand it to an absolute path before putting it in a payload another context reads.

## The state command and the worktree root — with the unattended rails, routed to `plan.md`, not restated here

§4 reaches for three host spellings, and all three are already written in `plan.md` beside this file, where the child itself reads them. This file ROUTES to them and restates none, so one spelling per host cannot drift into two:

- **The state command** — every `oso-state <verb> …` §4 instructs, its `set roadmap={roadmap}`, its `set roadmap=none` and the `show` that reads either back included, runs under the binary and the identity that file's own **The state command** section spells. Spelled bare, without them, the command exits on its usage message and writes nothing at all, so following this route is not optional.
- **The worktree root** — `<worktree root>`, the SECOND place §4's bar reads before every arming, is the path that file's own **The worktree root** section spells.
- **The unattended rails** — the three rails §4's `auto=running` arms on this host, named one by one in that file's own **What the unattended marker arms on this host** section: the continuation rail that posts the chain on, the re-anchor rail after a compaction, and the production boundary that stands while the marker does. The middle one is the survivability floor §4 asks this file for: it hands the fresh context the `oso/index` row's `NEXT:` line, `oso-state show` and the run journal, which is exactly where the chain's position is written down.

READ all three sections there before §4 arms its first child.

## Reporting binding

READ `reporting.md` beside this file NOW. It is the single OpenCode binding for what this host's own UI shows, and does not show, when the milestone contract at `../../reporting.md` fires.
