---
name: plan
description: Deep mode for substantial changes. Plans in three phases — intent, decision rounds, slicing — inside Plan Mode, then executes slice by slice with an apply/verify loop and a zero-warnings bar. Use for features, refactors, or any change that needs architecture or contract decisions.
argument-hint: [change-name or what to build]
disable-model-invocation: true
---

# Plan mode

Guided flow for substantial changes. The human decides; you guide, present options with tradeoffs, and never assume.

## Ground rules for the whole flow

- Phases 1–3 run inside Plan Mode (read-only). Enter it before phase 1 and stay in it until the slice plan is approved.
- Question rounds: 3–5 questions maximum per round, each with 2–4 concrete options and their tradeoffs. Put your recommendation first and say why it wins.
- If phase 1 reveals the change is actually small, say so and offer `oso-code:quick`. The user decides.
- Engram gotcha: `mem_search` returns 300-char previews — always call `mem_get_observation(id)` for full content.
- Runtime gates: plugin hooks deny `git commit` while `verify_green` is false and deny file edits while no slice is active. Keep the session state honest with the `oso-state` commands below — they are what unlocks those gates.

## 0. Resume check

Search engram for existing work on this change: `mem_search(query: "oso/{change}/plan")`.
If found, retrieve it, report the recorded position (phase or slice), and continue from there. Never re-ask what the ledger already answers.

Runtime state is per session and does not survive a restart. When resuming into execution, re-arm it before touching code:
`oso-state --session "${CLAUDE_CODE_SESSION_ID}" set mode=plan active_slice=<current> verify_green=false`

## 1. Intent

Understand WHAT the user wants, one abstraction level above code. No stack talk, no file names, no how.

Produce and show:

- **Intent** — two or three sentences.
- **In-scope / Out-of-scope** — explicit lists.
- **Visible outcome** — what exists when this is done that does not exist today.

Iterate until the user approves the intent. Do not advance without approval.

## 2. Decision rounds

Goal: after this phase, execution requires zero assumptions.

Run rounds until every category below is decided or explicitly marked not applicable:

| Category | Covers |
|---|---|
| Contracts | APIs, signatures, events, exchange schemas |
| Architecture | Where logic lives, dependency direction, patterns to follow or establish |
| Data | Model, persistence, migrations, source of truth |
| Errors | Expected failures, empty/invalid states, what the user sees when things break |
| UX behavior | Flows, loading/error states — when the change has a user surface |
| Security | Authn/authz, data exposure — when applicable |
| Verification | What proves each part works, and this project's zero-warnings bar: the exact lint, type, test, and build commands |
| Reuse | Existing code and primitives the change must use instead of recreating |

Rules:

- Enumerable choices get options with tradeoffs, never open-ended questions.
- Record every decision in the ledger: the decision, the rationale, the alternatives rejected.
- The user may delegate a decision ("you pick") — record it as delegated, with your rationale.
- Exit only when the user declares the ledger frozen.

On freeze, save the ledger once:
`mem_save(title: "oso/{change}/ledger", topic_key: "oso/{change}/ledger", type: "architecture", capture_prompt: false, content: intent + scope + every ledger entry)`

## 3. Slicing

Split the change into vertical slices. Each slice delivers observable progress and fits one focused apply/verify batch — never a one-line task, never half the project.

Each slice states:

- **Goal** — the observable progress it delivers.
- **Files** — expected touch points.
- **Verify** — which project checks plus what observable behavior proves it.

Order slices by dependency. Present the plan; when the user approves, exit Plan Mode and save the plan state:
`mem_save(title: "oso/{change}/plan", topic_key: "oso/{change}/plan", type: "architecture", capture_prompt: false, content: slices with [ ] marks + current position)`

Then initialize the runtime state:
`oso-state --session "${CLAUDE_CODE_SESSION_ID}" set mode=plan verify_green=false`

## 4. Execution — one slice at a time, delegated

You (the orchestrator) never write code during execution. Each slice runs through fresh-context subagents; you manage the state, the ledger, and the human.

For the active slice:

1. **Activate** — `oso-state --session "${CLAUDE_CODE_SESSION_ID}" set active_slice=<n> verify_green=false`.
2. **Apply (subagent)** — launch the `oso-applier` agent with: the slice (goal, files, verify criteria), every ledger decision relevant to it, the project conventions, and the rubric path (`${CLAUDE_SKILL_DIR}/../_shared/rubric.md`).
   - If it returns `blocked`: resolve each question with the user (options with tradeoffs, recommendation first), record the answers in the ledger (`mem_update`), then launch a FRESH applier to complete the slice with the updated ledger. Never answer on the user's behalf. Never finish the slice inline.
3. **Verify (subagent)** — launch the `oso-verifier` agent with the slice criteria and the zero-warnings commands from the ledger. It reruns everything itself and returns a verdict with evidence (commands, exit codes, criteria observations).
   - On `fail`: relaunch the applier with the verifier's findings. Loop apply → verify until it passes.
4. Only on the verifier's `pass`: `oso-state --session "${CLAUDE_CODE_SESSION_ID}" set verify_green=true`, mark the slice `[x]` (`mem_update` on the plan topic key — merge, never overwrite), report the result to the user, and move to the next slice.

Never run two slices at once. Never start slice N+1 while slice N is red. Small fixes are never applied inline "to save time" — they go through a subagent like everything else.

## 5. Close — when the user says they are happy

1. Activate the sweep as a slice: `oso-state --session "${CLAUDE_CODE_SESSION_ID}" set active_slice=debt-sweep verify_green=false`.
2. **Judge (subagent)** — INVOKE the `oso-code:debt-sweep` skill through the Skill tool; it runs in its own forked subagent. Never perform the sweep yourself in this conversation — an orchestrator sweeping its own change has no fresh eyes. It returns `clean` or a findings list.
3. **Fix (subagent)** — on findings, launch the `oso-applier` agent with the findings list as a cleanup assignment: smallest edit per finding, readability and semantics only, never behavior. Then re-invoke `oso-code:debt-sweep` to confirm. Loop judge → fix until `clean`.
4. Only on `clean`: `oso-state --session "${CLAUDE_CODE_SESSION_ID}" set verify_green=true`.
5. Save a session summary to engram. Do not save phase artifacts, explorations, or verbose progress.
6. Commit, push, or open a PR only if the user asks. When opening a PR, include the frozen decision ledger and the slice summary in the PR body — engram is per-machine, and the PR is the only surface where a reviewer can check the code against the decisions it implements.
