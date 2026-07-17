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

- Phases 1–5 up to approval run inside Plan Mode (read-only). Enter it before phase 1 and stay in it until the slice plan is approved at the end of the walkthrough (§5).
- Question rounds: 3–5 questions maximum per round, each with 2–4 concrete options and their tradeoffs. Put your recommendation first, say why it wins, and state whether it is current standard practice; when the choice involves an external library, framework API, or well-trodden pattern, verify against current docs (context7) before recommending.
- If phase 1 reveals the change is actually small, say so and offer `oso-code:quick`. The user decides.
- Engram gotcha: `mem_search` returns 300-char previews — always call `mem_get_observation(id)` for full content.
- Engram content AND titles (`{human description}`) are written in English; Oso narrates them in Spanish when the operator asks. Applies to every save below — ledger, plan, summary.
- Runtime gates: plugin hooks deny `git commit` while `verify_green` is false and deny file edits while no slice is active. Keep the session state honest with the `oso-state` commands below — they are what unlocks those gates.

## 0. Resume check

Search engram for existing work on this change: `mem_search(query: "oso/index")`, then `mem_get_observation(id)` for the full table. Self-heal before trusting it: for EVERY row with status `executing`, cross-check against its `oso/{change}/plan` or `oso/{change}/summary` observation; if the evidence says the change completed, fix that row via `mem_update` (merge — never overwrite other rows) before proceeding. Scope guard: cross-check only `executing` rows — never scan the whole index (startup cost). Then locate the row for `{change}` and fetch its ledger and plan by topic key (`oso/{change}/ledger`, `oso/{change}/plan`).
Fallback when the index doesn't exist yet (first-ever use): `mem_search(query: "oso/{change}/plan")` directly.
If found, retrieve it, report the recorded position (phase or slice), and continue from there. Never re-ask what the ledger already answers.

Runtime state is per session and does not survive a restart. When resuming into execution, re-arm it before touching code:
`"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" set mode=plan active_slice=<current> verify_green=false`

Read operator preferences alongside the index: `mem_search(query: "oso/preferences")` → `mem_get_observation(id)` for full content (the 300-char preview gotcha applies). On resume (preferences exist), apply them silently — never re-ask.
First run — no `oso/preferences` observation yet (mirror "create oso/index if it doesn't exist yet"): before phase 1, ask ONE round of three preference questions:

- **E2E walkthrough before approval** — always / never / offer each time.
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

Present at the operator's explanation-depth preference (concise / standard / didactic — the didactic register is defined at `${CLAUDE_SKILL_DIR}/../_shared/didactic.md`).

**Teaching moment.** Before iterating on the request, fire when any trigger holds:

- **The ask contradicts current standard practice** — e.g. asks to hand-roll auth-token storage when the platform keychain is the standard.
- **The operator can't say what their ask involves** — e.g. "add SSO" but can't say against which identity provider.
- **The operator can't answer a decision question** — a decision-round question meets silence or confusion.

When it fires, explain in 2–6 sentences: the terrain, the standard-path recommendation, and the why — BEFORE iterating. This beats "default to short answers"; a knowledge gap is never a short-answer moment. Guard is PER-TOPIC, not per-operator: driving `/plan` competently says nothing about knowing the topic at hand (knowing the flow ≠ knowing OAuth) — read the topic, not the tool skill. Preference consumption: **always** → add a teaching-relevant terrain note in every intent round; if there is genuinely nothing to teach, say nothing rather than filler (the preference lowers the trigger bar to any teachable terrain, it does not mandate filler). **auto-detect** → fire on the checklist above. **off** → silent.

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

Order slices by dependency and present them. Approval comes after the walkthrough (§5), not here.

## 5. Walkthrough — a standalone didactic message, before approval

Honor the walkthrough preference: **always** → deliver it; **offer each time** → offer it through `AskUserQuestion` and let the operator decide; **never** → skip silently and go straight to approval below. The walkthrough is ALWAYS delivered in the didactic register (`${CLAUDE_SKILL_DIR}/../_shared/didactic.md`), regardless of the explanation-depth preference — depth tunes the other phases, never this one.

When delivered, it is a standalone chat MESSAGE, sent BEFORE any approval, that covers:

1. **The journey, in plain language** — how a request / a piece of data / a user travels through the built system once it works. Narrate the flow; define each jargon term in parentheses at first use; reach for ONE analogy when a concept is abstract.
2. **The slice map as stages of that journey** — tell each slice as a stage of the story above (which leg of the journey it builds), never a re-list of §4.
3. **Risks and the frozen ledger decisions** that shaped the design — what could go wrong, and which decisions constrain it.

Then ask a comprehension check through `AskUserQuestion`, with options equivalent to: **"quedó claro"** (understanding confirmed) / **"repasemos X"** (re-explain a named part) / **"listo para aprobar"** (ready to approve). On a review option, re-explain only the asked part — still didactic — then ask the comprehension check again; loop until the operator confirms understanding or picks approval. The loop re-explains; it never reopens decisions — a decision the operator wants to reopen goes through the ledger like any blocked question would.

HARD BAN: the walkthrough content NEVER goes inside the `ExitPlanMode` plan argument, and the native plan summary NEVER stands in for it. The walkthrough is a chat message; `ExitPlanMode` is the later, separate approval gate — never the delivery vehicle for the explanation.

ONLY after the operator confirms understanding does the plan go to approval: call `ExitPlanMode` with the plan summary (not the walkthrough). That approval is the single gate that starts execution. When the preference is **never** and no walkthrough is delivered, approval still happens through `ExitPlanMode` and the steps below still run. On approval, exit Plan Mode and save the plan state:
`mem_save(title: "oso/{change}/plan — {human description}", topic_key: "oso/{change}/plan", type: "architecture", capture_prompt: false, content: slices with [ ] marks + current position)`

Update the index so this change surfaces on first search: create `oso/index` if it doesn't exist yet (`mem_save`, topic_key `oso/index`) or update it (`mem_update`, merge the table — never overwrite other rows), adding/updating the row `{change} — {human description} — status: executing`. Follow the index format standard:

- **Rich title** — `oso/index — {project}: {n} changes, active: {change}`, kept current on every upsert.
- **`NEXT:` line** at the top of the content — active change + slice position + what follows (e.g. `NEXT: plan2-purga slice 3/6 → then roadmap Plan 3`).
- **Status vocabulary** — exactly `planning / executing / done / roadmap`, nothing else.
- **Detail column per row** — cite LITERAL topic keys (`oso/{change}/plan`, `oso/{change}/summary`); never dash wiki-links like `[[oso-x-plan]]` (they don't match real topic keys and cost an extra search hop).
- **Roadmap parents** — a `roadmap` row lists its child changes by topic key.
- **Explicit pendings** — name non-code pendings in the row (`PENDING: visual QA in staging`); ambiguous statuses like `done (código)` are banned.

Then initialize the runtime state:
`"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" set mode=plan verify_green=false`

## 6. Execution — one slice at a time, delegated

You (the orchestrator) never write code during execution. Each slice runs through fresh-context subagents; you manage the state, the ledger, and the human.

For the active slice:

1. **Activate** — `"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" set active_slice=<n> verify_green=false`.
2. **Apply (subagent)** — launch the `oso-applier` agent with: the slice (goal, files, verify criteria), every ledger decision relevant to it, the project conventions, and the rubric path (`${CLAUDE_SKILL_DIR}/../_shared/rubric.md`).
   - If it returns `blocked`: resolve each question with the user (options with tradeoffs, recommendation first), record the answers in the ledger (`mem_update`); then check whether any answer reveals a new surface or category — if it does, append it and its questions to the ledger before relaunching. Launch a FRESH applier to complete the slice with the updated ledger. Never answer on the user's behalf. Never finish the slice inline.
3. **Verify (subagent)** — launch the `oso-verifier` agent with the slice criteria, the zero-warnings commands from the ledger, the rubric path (`${CLAUDE_SKILL_DIR}/../_shared/rubric.md`), and the ledger decisions relevant to the slice (so it can check for unledgered abstractions). It reruns everything itself and returns a verdict with evidence (commands, exit codes, criteria observations).
   - On `fail`: relaunch the applier with the verifier's findings. Loop apply → verify until it passes.
   - On `blocked` (cannot verify: broken environment, missing commands): resolve the blocker with the user, then relaunch the verifier — do NOT relaunch the applier for a verifier-side blocker.
4. Only on the verifier's `pass`: `"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" set verify_green=true`, mark the slice `[x]` (`mem_update` on the plan topic key — merge, never overwrite), report the result to the user, and move to the next slice.

Never run two slices at once. Never start slice N+1 while slice N is red. Small fixes are never applied inline "to save time" — they go through a subagent like everything else.

## 7. Close — when the user says they are happy

1. Activate the sweep as a slice: `"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" set active_slice=debt-sweep verify_green=false`.
2. **Judge (subagent)** — INVOKE the `oso-code:debt-sweep` skill through the Skill tool; it runs in its own forked subagent. Never perform the sweep yourself in this conversation — an orchestrator sweeping its own change has no fresh eyes. It returns `clean` or a findings list.
3. **Fix (subagent)** — on findings, launch the `oso-applier` agent with the findings list as a cleanup assignment: the smallest edit that FULLY resolves each finding — behavior-preserving; structural findings may span files. Then re-invoke `oso-code:debt-sweep` to confirm. Loop judge → fix until `clean`.
4. Only on `clean`: `"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" set verify_green=true`.
5. Update the change's `oso/index` row to `status: done` (`mem_update`, merge — never overwrite other rows), keeping the rich title and `NEXT:` line current per the index format standard in §5.
6. Save a session summary to engram with a rich title (`"oso/{change}/summary — {human description}"` pattern) so it surfaces on first search. Do not save phase artifacts, explorations, or verbose progress.
7. Commit, push, or open a PR only if the user asks. When opening a PR, include the frozen decision ledger and the slice summary in the PR body — engram is per-machine, and the PR is the only surface where a reviewer can check the code against the decisions it implements.
