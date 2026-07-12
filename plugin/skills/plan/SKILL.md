---
name: plan
description: Deep mode for substantial changes. Plans in four phases — intent, surface mapping, decision rounds, slicing — inside Plan Mode, then executes slice by slice with an apply/verify loop and a zero-warnings bar. Use for features, refactors, or any change that needs architecture or contract decisions.
argument-hint: [change-name or what to build]
disable-model-invocation: true
model: opus
---

# Plan mode

Guided flow for substantial changes. The human decides; you guide, present options with tradeoffs, and never assume.

## Ground rules for the whole flow

- Phases 1–4 run inside Plan Mode (read-only). Enter it before phase 1 and stay in it until the slice plan is approved.
- Question rounds: 3–5 questions maximum per round, each with 2–4 concrete options and their tradeoffs. Put your recommendation first, say why it wins, and state whether it is current standard practice; when the choice involves an external library, framework API, or well-trodden pattern, verify against current docs (context7) before recommending.
- If phase 1 reveals the change is actually small, say so and offer `oso-code:quick`. The user decides.
- Engram gotcha: `mem_search` returns 300-char previews — always call `mem_get_observation(id)` for full content.
- Runtime gates: plugin hooks deny `git commit` while `verify_green` is false and deny file edits while no slice is active. Keep the session state honest with the `oso-state` commands below — they are what unlocks those gates.

## 0. Resume check

Search engram for existing work on this change: `mem_search(query: "oso/index")`, then `mem_get_observation(id)` for the full table, and locate the row for `{change}`. Fetch its ledger and plan by topic key (`oso/{change}/ledger`, `oso/{change}/plan`).
Fallback when the index doesn't exist yet (first-ever use): `mem_search(query: "oso/{change}/plan")` directly.
If found, retrieve it, report the recorded position (phase or slice), and continue from there. Never re-ask what the ledger already answers.

Runtime state is per session and does not survive a restart. When resuming into execution, re-arm it before touching code:
`oso-state --session "${CLAUDE_CODE_SESSION_ID}" set mode=plan active_slice=<current> verify_green=false`

Read operator preferences alongside the index: `mem_search(query: "oso/preferences")` → `mem_get_observation(id)` for full content (the 300-char preview gotcha applies). On resume (preferences exist), apply them silently — never re-ask.
First run — no `oso/preferences` observation yet (mirror "create oso/index if it doesn't exist yet"): before phase 1, ask ONE round of three preference questions:

- **E2E walkthrough before execution** — always / never / offer each time.
- **Explanation depth** — concise / standard / didactic.
- **Adaptive teaching** — auto-detect / always / off.

Then save once: `mem_save(title: "oso/preferences — operator behavior preferences", topic_key: "oso/preferences", type: "preference", capture_prompt: false, scope: personal, content: the three values + date)`. One observation, upserted — later changes go through `mem_update` (merge, never overwrite), same discipline as oso/index. Scope is honest: per-machine ($HOME), not per-person.
Natural-language updates: whenever the operator asks to change a preference ("cambia mi preferencia de walkthrough a siempre"), update oso/preferences via `mem_update` and confirm — no ceremony.

## 1. Intent

Understand WHAT the user wants, one abstraction level above code. No stack talk, no file names, no how.

Produce and show:

- **Intent** — two or three sentences.
- **In-scope / Out-of-scope** — explicit lists.
- **Visible outcome** — what exists when this is done that does not exist today.

Present at the operator's explanation-depth preference (concise / standard / didactic). When the request shows a knowledge gap — it contradicts current standard practice, or the operator can't say what their ask involves, or can't answer a decision question — briefly explain the terrain and recommend the standard path with the why before iterating, honoring the teaching preference (auto-detect / always / off). Guard: never fire when the operator demonstrates knowledge — this is teaching, not gatekeeping.

Iterate until the user approves the intent. Do not advance without approval.

## 2. Surface mapping

Goal: turn the approved intent into a map of what the change actually touches, built from evidence, not from a checklist.

1. Launch up to 3 parallel `Explore` subagents. Give each a focus derived from the intent and have it discover what the change touches: modules, contracts and their consumers, shared state, jobs, data flows.
2. Generate the surface list from what they return. A surface is generated from evidence — never recited from a fixed list.
3. Audit the map against the category table in Decision rounds: each category is either covered by a surface, marked N/A with a reason, or reveals a surface the exploration missed — add it.
4. Generate the question battery from the map. Every question must cite the code evidence that motivates it and the consequence of not deciding it. "Do we need auth?" fails the bar; "this endpoint doesn't validate tenant and the new field exposes billing data — scope by role or by tenant?" passes.
5. Prioritize the battery blocking-decisions-first. It feeds Decision rounds at the existing 3–5 questions per round.

Fallback: if exploration surfaces nothing clear, fall back to the category table as the question generator — a template question beats silence. Even a fallback question must state the consequence of leaving it undecided; only the evidence citation is waived, never the consequence.

Exit: every surface has questions in the battery, or an explicit N/A.

## 3. Decision rounds

Goal: after this phase, execution requires zero assumptions.

The question battery from Surface mapping is the source of questions here; the category table below is an audit floor, not a generator — it confirms nothing was missed, it does not originate rounds. Open the first round with the surface map and its audited N/As shown as a header; there is no separate approval gate for the map itself.

Run rounds until every category below is decided or explicitly marked not applicable with a recorded reason in the ledger:

| Category | Covers |
|---|---|
| Contracts | APIs, signatures, events, exchange schemas |
| Architecture | Where logic lives, dependency direction, patterns to follow or establish |
| Data | Model, persistence, migrations, source of truth |
| Errors | Expected failures, empty/invalid states, what the user sees when things break |
| UX behavior | Flows, loading/error states — when the change has a user surface |
| Security | Authn/authz, data exposure — when applicable |
| Verification | What proves each part works, and this project's zero-warnings bar: which of lint, type, test, build, and run checks EXIST in this project — record the exact commands and mark the rest N/A |
| Reuse | Existing code and primitives the change must use instead of recreating |

Rules:

- Enumerable choices get options with tradeoffs, never open-ended questions.
- Record every decision in the ledger: the decision, the rationale, the alternatives rejected.
- The user may delegate a decision ("you pick") — record it as delegated, with your rationale.
- Before freeze, every ledger entry cites the in-scope item or Visible-outcome element it serves; entries that serve only a future need are listed as YAGNI candidates for the user to cut or explicitly keep.
- Freeze is a reconciliation gate, not a bare exit. Before accepting "frozen", render the question battery as a reconciliation checklist: every battery question maps to a ledger decision, a delegated mark, or an N/A with a reason. Refuse the freeze while any row is unmapped ("N questions unresolved; answer, delegate, or dismiss with a reason before freezing").
- At the freeze attempt, state anything still open as an explicit assumption: "If you freeze now, I will have to assume: X → I'd pick Y because Z." The user either answers it or freezes over the named assumption — recorded in the ledger as delegated.

On freeze, save the ledger once:
`mem_save(title: "oso/{change}/ledger — {human description}", topic_key: "oso/{change}/ledger", type: "architecture", capture_prompt: false, content: intent + surface map + scope + every ledger entry)`

## 4. Slicing

Split the change into vertical slices. Each slice delivers observable progress and fits one focused apply/verify batch — never a one-line task, never half the project.

Each slice states:

- **Goal** — the observable progress it delivers.
- **Files** — expected touch points.
- **Verify** — which project checks plus what observable behavior proves it.

Order slices by dependency. Present the plan; when the user approves, exit Plan Mode and save the plan state:
`mem_save(title: "oso/{change}/plan — {human description}", topic_key: "oso/{change}/plan", type: "architecture", capture_prompt: false, content: slices with [ ] marks + current position)`

Update the index so this change surfaces on first search: create `oso/index` if it doesn't exist yet (`mem_save`, topic_key `oso/index`) or update it (`mem_update`, merge the table — never overwrite other rows), adding/updating the row `{change} — {human description} — status: executing`.

Then initialize the runtime state:
`oso-state --session "${CLAUDE_CODE_SESSION_ID}" set mode=plan verify_green=false`

## 5. Walkthrough — end-to-end, before execution

Honor the walkthrough preference: **always** → deliver it; **offer each time** → say so and offer it, the user decides; **never** → skip silently. When delivered, cover, at the operator's chosen depth:

1. **The end-to-end narrative** — how the built thing works when done: the journey of a request / data / user through the resulting system.
2. **The slice map** — which slice builds which part of that journey.
3. **Risks and the frozen ledger decisions** that shape the design.

Then answer questions until the operator says ready — execution does not start before that. The walkthrough explains; it never reopens decisions. A decision the operator wants to reopen goes through the ledger like any blocked question would.

## 6. Execution — one slice at a time, delegated

You (the orchestrator) never write code during execution. Each slice runs through fresh-context subagents; you manage the state, the ledger, and the human.

For the active slice:

1. **Activate** — `oso-state --session "${CLAUDE_CODE_SESSION_ID}" set active_slice=<n> verify_green=false`.
2. **Apply (subagent)** — launch the `oso-applier` agent with: the slice (goal, files, verify criteria), every ledger decision relevant to it, the project conventions, and the rubric path (`${CLAUDE_SKILL_DIR}/../_shared/rubric.md`).
   - If it returns `blocked`: resolve each question with the user (options with tradeoffs, recommendation first), record the answers in the ledger (`mem_update`); then check whether any answer reveals a new surface or category — if it does, append it and its questions to the ledger before relaunching. Launch a FRESH applier to complete the slice with the updated ledger. Never answer on the user's behalf. Never finish the slice inline.
3. **Verify (subagent)** — launch the `oso-verifier` agent with the slice criteria, the zero-warnings commands from the ledger, the rubric path (`${CLAUDE_SKILL_DIR}/../_shared/rubric.md`), and the ledger decisions relevant to the slice (so it can check for unledgered abstractions). It reruns everything itself and returns a verdict with evidence (commands, exit codes, criteria observations).
   - On `fail`: relaunch the applier with the verifier's findings. Loop apply → verify until it passes.
   - On `blocked` (cannot verify: broken environment, missing commands): resolve the blocker with the user, then relaunch the verifier — do NOT relaunch the applier for a verifier-side blocker.
4. Only on the verifier's `pass`: `oso-state --session "${CLAUDE_CODE_SESSION_ID}" set verify_green=true`, mark the slice `[x]` (`mem_update` on the plan topic key — merge, never overwrite), report the result to the user, and move to the next slice.

Never run two slices at once. Never start slice N+1 while slice N is red. Small fixes are never applied inline "to save time" — they go through a subagent like everything else.

## 7. Close — when the user says they are happy

1. Activate the sweep as a slice: `oso-state --session "${CLAUDE_CODE_SESSION_ID}" set active_slice=debt-sweep verify_green=false`.
2. **Judge (subagent)** — INVOKE the `oso-code:debt-sweep` skill through the Skill tool; it runs in its own forked subagent. Never perform the sweep yourself in this conversation — an orchestrator sweeping its own change has no fresh eyes. It returns `clean` or a findings list.
3. **Fix (subagent)** — on findings, launch the `oso-applier` agent with the findings list as a cleanup assignment: the smallest edit that FULLY resolves each finding — behavior-preserving; structural findings may span files. Then re-invoke `oso-code:debt-sweep` to confirm. Loop judge → fix until `clean`.
4. Only on `clean`: `oso-state --session "${CLAUDE_CODE_SESSION_ID}" set verify_green=true`.
5. Update the change's `oso/index` row to `status: done` (`mem_update`, merge — never overwrite other rows).
6. Save a session summary to engram with a rich title (`"oso/{change}/summary — {human description}"` pattern) so it surfaces on first search. Do not save phase artifacts, explorations, or verbose progress.
7. Commit, push, or open a PR only if the user asks. When opening a PR, include the frozen decision ledger and the slice summary in the PR body — engram is per-machine, and the PR is the only surface where a reviewer can check the code against the decisions it implements.
