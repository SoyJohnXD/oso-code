---
name: oso-plan
description: "Deep mode for substantial changes. Plans in four phases — intent, surface mapping, decision rounds, slicing — with nothing written before execution, closes with a Repaso-headed approval document, then executes slice by slice with an apply/verify loop and a zero-warnings bar. Use for features, refactors, or any change that needs architecture or contract decisions."
argument-hint: "[change-name or what to build]"
disable-model-invocation: true
---

# Plan mode

Host precondition: this operator-only skill starts only when the operator
invokes `/oso-plan`. The installed `opencode.json` denies it to the model
(`permission.skill: {"oso-plan": "deny"}`), so the model never sees it and a
model call to the `skill` tool for it is rejected; never imitate the invocation
by printing the command. This instruction is the fallback before that config
has been written by the installer.

The flow that follows this preface is the same on every host this harness runs on. It opens by pointing you at `references/opencode.md` — what it leaves to this host: the tools it calls, the paths it resolves, the approval gate, the amendment lane behind it, the state command, the wait rule every launch runs under, and the installed runtime gates.


# Plan mode

Guided flow for substantial changes. The human decides; you guide, present options with tradeoffs, and never assume. Read your platform's own reference file beside this one (`references/<host>.md`) now, before phase 0 — it is what this flow leaves to the host: the tools it calls, the paths it interpolates, the approval gate, the delivery rule the host imposes. Wherever this flow says "your host", that file is the answer.

## Ground rules for the whole flow

- Phases 1–5, through §5's delivered approval document, run inside Plan Mode — read-only, nothing before §6 writes code. Enter it before phase 1, stay through delivery. A ROADMAP child's own re-entry into Plan Mode is the host's call, not this rule's — its reference file has the answer, read before phase 1.
- Question rounds: 2–4 options with tradeoffs, your recommendation first with why, and whether it is current standard practice — verify a library, framework, or well-trodden pattern against context7 before recommending. Round size and the asking tool are the reference file's.
- Operator-facing content — the intent, the surface map, any narrative the operator must read — is delivered under the reference file's delivery contract. A question round's own context travels in its fields, never as prose the round carries for it.
- If phase 1 shows the change is actually small, offer QUICK; if it is actually a bug, offer DEBUG. The user decides either way.
- `mem_search` returns 300-char previews — always call `mem_get_observation(id)` for full content. Engram content and titles are written in English; Oso narrates them in Spanish on request. Applies to every save below.
- The commit gate refuses `git commit` while `verify_green` is false; the edits gate refuses a file edit while `mode=plan` and no slice is active. Keep the triple (`mode`, `active_slice`, `verify_green`) honest with `oso-state` — it can set a key but never delete one, so a slice CLOSES by writing `active_slice=none`, never by leaving its number behind.
- Abandoning this flow mid-run: run `oso-state clear`. The state belongs to the repository and outlives the session — left standing, it arms every gate over later, unrelated work. It is resolved from the directory the command runs in, so a PARALLEL wave's own worktrees read and write the same state file as the main checkout, with no path argument to carry between them.
- Report every arm, every subagent launch, every verdict, and every close under the milestone contract at `_shared/reporting.md`, read ALWAYS by this flow.
- A ROADMAP child never waits for the operator: that mode's own policy (§4) answers, in their place, what this flow would otherwise put to them — recorded in the ledger as delegated (§3), a decision handed to the flow, never the subagent launches §6 also calls delegated. An OFFER is not such a point; nobody there to take it is the declined route it already carries.
- What that policy will not answer costs this change, never the chain: `oso-state set mode=plan active_slice=none verify_green=false` sets it ASIDE — never `oso-state clear`, since the chain still owns this repository and arms the next child. Four points below name where this lands: the applier's blocked route (§6), a merge conflict, conformance triage, and the sweep's exit cap (§7).
- AUTO — its arming, its ceiling, what PARK means, and everything it changes about delivery and this close — is `_shared/unattended.md`'s, read ALWAYS by this flow.

## 0. Resume check

Search engram: `mem_search(query: "oso/index")`, then `mem_get_observation(id)` for the full table (fallback when it doesn't exist yet: `mem_search(query: "oso/{change}/plan")` directly). Self-heal every `executing` row against its `oso/{change}/plan` or `/summary` observation before trusting it — `mem_update` merge, never overwrite, never scan the whole index otherwise. Locate `{change}`'s row, fetch its ledger and plan, report the recorded position, and continue from there — never re-ask what the ledger already answers.

Resuming into execution re-arms runtime state first: `oso-state set mode=plan active_slice=<current> verify_green=false`, then `oso-state show` to confirm — stop and tell the operator if it did not land.

Worktrees outlive the session that cut them: run `git -C <main checkout> worktree list` and report every worktree of this change still standing, each naming the slice its branch (`oso/<change>/<slice>`) holds. What becomes of them is the operator's; §7 clears them at close.

Read `oso/preferences` (one record per project — `mem_search` already filters by cwd). Self-heal a retired field, or a legacy `scope: personal` copy, via `mem_update`, then apply silently. Two field groups, asked at different moments:

- **Behavior**, asked at the FIRST plan in this project (no record yet): one round of two questions — **explanation depth** (concise/standard/didactic) and **adaptive teaching** (auto-detect/always/off).
- **Ceiling**, asked at the first AUTO or ROADMAP arming and never in the round above — `_shared/unattended.md`'s, read ALWAYS by this flow.

Save once: `mem_save(title: "oso/preferences — this project's operator record", topic_key: "oso/preferences", type: "preference", capture_prompt: false, content: the values + date)`. Later updates — including a natural-language request from the operator — go through `mem_update` (merge, never overwrite), confirmed with no ceremony.

## 1. Intent

Understand WHAT the user wants, one level above code — no stack talk, no file names, no how. Produce and show, at the operator's explanation-depth preference (`_shared/didactic.md` for the didactic register):

- **Intent** — two or three sentences.
- **In-scope / Out-of-scope** — explicit lists.
- **Visible outcome** — what exists when this is done that does not exist today.

**Teaching moment**, before iterating: fires when the ask contradicts standard practice, the operator can't say what their ask involves, or can't answer a decision question. When it fires, explain in 2–6 sentences — the terrain, the standard-path recommendation, the why — before iterating; a knowledge gap is never a short-answer moment, and the guard is per-topic, not per-operator. Preference consumption: **always** adds a teaching-relevant note every round, saying nothing rather than filler when there is genuinely nothing to teach; **auto-detect** fires on the triggers above; **off** stays silent.

Iterate until the user approves the intent. Do not advance without approval.

## 2. Surface mapping

Turn the approved intent into a map of what the change actually touches, built from evidence, not a checklist.

1. Launch up to 3 exploration subagents in parallel (your host's explorer, named in the reference file), each with a focus derived from the intent, to discover modules, contracts and their consumers, shared state, jobs, data flows.
2. Generate the surface list from what they return — never recited from a fixed list.
3. Audit the map against the INVARIANT CORE (§3: Contracts, Architecture, Errors, Verification, Reuse) — each lens covered by a surface, marked N/A with a reason, or revealing a surface exploration missed. Derive further categories straight from the surfaces, each citing its motivating evidence: infra → rollback, cost, observability; front surfaces (`_shared/front-surface.md`'s trigger) → accessibility, responsive, state, and its design-bar absence policy when Impeccable isn't installed; data-touching → data model, migrations, source of truth; auth/payments → security; user-facing → UX behavior.
4. Generate the question battery from the map — every question cites the code evidence that motivates it and the consequence of not deciding it.
5. Prioritize blocking-decisions-first, feeding Decision rounds at the reference file's per-round cap.
6. Audit the map again against the four rules the rubric (`_shared/rubric.md`) puts outside its own judgment contract — the three Hard blockers and the inline-comment debt class. A repo convention in tension with one of these is a battery QUESTION like any other, ranked in with its consequence, answered by the operator and recorded — never softened as "the project's own convention."

Fallback: if exploration surfaces nothing clear, fall back to the INVARIANT CORE as the question generator — a template question beats silence, though only the evidence citation is waived.

Exit: every surface has a battery question or an explicit N/A, and every core lens plus derived category is questioned or marked N/A.

## 3. Decision rounds

Goal: after this phase, execution needs zero assumptions. The Surface mapping battery is the source of questions here; the table below is an audit floor, never a generator. Present the surface map and its audited N/As as a turn-ending message before the first round — there is still no separate approval gate for the map itself.

Run rounds until every core lens and every derived category is decided or explicitly marked N/A with a reason:

| Category | Covers |
|---|---|
| Contracts | APIs, signatures, events, exchange schemas |
| Architecture | Where logic lives, dependency direction, patterns to follow or establish |
| Errors | Expected failures, empty/invalid states, what the user sees when things break |
| Verification | What proves each part works, and this project's zero-warnings bar |
| Reuse | Existing code and primitives the change must use instead of recreating |

Derived categories extend this core per change (§2 step 3) — Data, UX behavior, Security among others — and run through the same rounds.

**Verification** records the exact lint/type/test/build/run commands that exist in this project (the rest N/A), and settles:

- **Base ref** — the starting point the close's two judges (§7) diff against; record `none` when nothing is committed yet, which forces SEQUENTIAL execution (§4), since a worktree branches from something.
- **Per-slice commits** — ON by default: a slice's work commits when it goes green, in both modes, nothing asked of the operator. A project whose branch policy can't take one commit per slice turns them off here, which also forces SEQUENTIAL.
- **Concurrency** — whether this project's bar tolerates N slices' checks running side by side (a shared port, one test database, a build cache, a lockfile). Read-only phases can't establish it, so the row records it as a QUESTION and §6 answers it at the first wave.
- When the change has front surface (`_shared/front-surface.md`), the pinned design detector joins these commands under its pin recipe — record the recipe and the commitment here; §6 resolves the numerals at the first front-touching slice, from the npm channel, never the installed plugin's version.

Rules:

- Enumerable choices get options with tradeoffs, never open-ended questions.
- Record every decision, its rationale, and the alternatives rejected, in the ledger; a decision the user delegates ("you pick") is recorded as delegated.
- Before freeze, every ledger entry cites the in-scope item or Visible-outcome element it serves; an entry serving only a future need is a YAGNI candidate for the user to cut or keep.
- Freeze is a reconciliation gate. Before accepting "frozen", render the battery as a checklist — every question mapped to a decision, a delegated mark, or a reasoned N/A. At the freeze attempt, state any still-open item as an explicit assumption ("If you freeze now, I will assume X → I'd pick Y because Z"); the user answers it or freezes over the assumption, recorded as delegated.
- **Doubt pass** — offered and recommended when a derived category came from a migrations, security, or rollback surface; on decline, record `Doubt pass: N/A — no migration, security, or rollback surface` in §5. On acceptance, invoke the doubt-pass judge with ONLY the intent, surface map, and bare decisions — never the rationale. It ends on `Doubt Pass: clean` (freeze proceeds), `Doubt Pass: findings` (reconcile yourself against the recorded rationale — a finding it already answers is noise, the rest go to the operator like §6 blocked questions), or `Doubt Pass: blocked` (its own launch never reached it whole — resolve what it names missing and invoke it again fresh). Single pass by default, re-run only after major ledger changes, hard cap 3 cycles — 2+ cycles with zero findings is doubt theater: name it and stop rather than wait for the cap.

On freeze, save the ledger once: `mem_save(title: "oso/{change}/ledger — {human description}", topic_key: "oso/{change}/ledger", type: "architecture", capture_prompt: false, content: intent + surface map + scope + every ledger entry)`.

## 4. Slicing

Split the change into vertical slices — each delivers observable progress and fits one focused apply/verify batch, never a one-line task, never half the project. Each slice states:

- **Goal** — the observable progress it delivers.
- **Files** — expected touch points.
- **Verify** — which project checks plus what observable behavior proves it, and at least one automated check that fails without the slice. When none is sensible (docs, config), state `Verify-exception: <reason>` instead.
- **Depends-on** — the slices that must land first, by number, or nothing.

Cut by that bar alone, never by the target execution mode: the dependency graph below is DERIVED from the cut, never the cut from the graph. Cutting for parallelism instead produces the horizontal slice — "all the types", "all the tests" — disjoint in files, which is what makes it look parallel, and individually unverifiable, which is what makes it not a slice: it loses both the vertical bar and the per-slice automated check.

**Design-foundation slice.** When the change touches a front surface and the target project has no `PRODUCT.md`/`DESIGN.md`, the FIRST slice is design-foundation — but before it is cut, READ the installed Impeccable skill's `SKILL.md` and RECORD its version in the ledger. That read decides the cut: `init` writes `PRODUCT.md` only (a new project — brand/audience questions run interactively); `document` writes `DESIGN.md` from existing code and leaves `PRODUCT.md` alone. The ORCHESTRATOR runs it directly — the sole exception to the §6 execution invariant, scoped exclusively to Impeccable's design-doc generation. Impeccable absent means no read, no version, and no design-foundation slice — the same absence policy `_shared/front-surface.md` gives §2 step 3.

**Expand-contract slicing.** When the surface map shows a contract, signature, or schema change with many consumers, offer the template: EXPAND, MIGRATE, CONTRACT. EXPAND adds the new form beside the old so every check stays green; MIGRATE moves consumers in batched, independently verifiable slices; CONTRACT deletes the old form — its Verify MUST include a pre-delete completeness check proving zero remaining consumers, run before the delete lands.

**The dependency graph.** Draw one edge per dependency and fill each slice's `Depends-on` from it, read off the surface map rather than guessed. Four sources: a CONTRACT and its consumers, SHARED STATE two slices both write, a DATA FLOW running out of one into the other, and VERIFICATION-BAR COUPLING — two slices sharing no contract, state, data flow or file that still cannot pass this project's bar apart. This repo is its own example: its linter requires the prose that counts its rules to name the number the linter actually declares, and that prose lives in README as well as in the linter. The slice that adds a rule and the slice that raises the count README states are therefore one edge apart however disjoint their files read — run side by side, each tree is missing the other half and both go red. Files overlap is a secondary check on top of the four, for physical conflicts only: an overlap the graph failed to predict is a merge conflict the integration gate reports, never an edge the graph was trusted to catch.

**Waves.** Group the graph into waves — a set of slices with no edge between any two of them, starting only once the wave before it has landed. Wave 0 is the design-foundation slice alone, width 1, in the main checkout, run by the orchestrator; it writes `PRODUCT.md` always and `DESIGN.md` only when `document` ran. Wave 1's WAVE START is wave 0's landing commit when it ran. CONTRACT is a barrier and may never share a wave with a MIGRATE slice — its completeness check would grep a tree the migration hasn't finished reaching.

A wave's WIDTH is how many slices it holds. Present the slices in wave order, each with its four fields, and the widest wave's width beside them.

**The execution mode.** Ask the operator, in one round whose first question this is: run the slices SEQUENTIALLY in the main checkout, or run each wave in PARALLEL, one worktree per slice — the width, the estimated gain, and your recommendation travel in the question's own fields.

- Recommend parallel when the widest wave is 3 or more; at 2, report the number and recommend sequential.
- The gain comes from the widest wave, never the slice count: a wave costs its slowest slice plus one full integration gate.
- The concurrency cap defaults to 4, adjustable at this question — it is what settles §3's concurrency question, at the first wave.
- A base ref of `none`, or per-slice commits turned off, never reaches this question: sequential is the only mode. Record the forced mode, the exact reason, the wave count and the widest width for §5's planning disposition.

**The execution disposition**, the round's second question, inside that same round: run §6 and §7 NORMALLY, with the operator at every point that puts a decision to them, or under AUTO — the disposition `_shared/unattended.md` defines, read ALWAYS by this flow, where its default, recommendation and no-re-ask rule live.

Record the answers — the mode, the cap when parallel, and the disposition with its date — in the ledger. Approval happens at §5, not here.

## 5. Repaso de cambios (change recap) — heads the approval document

The repaso is ALWAYS delivered — no gate, no preference to honor. It HEADS the plan document your host's approval gate receives — the opening the operator reads first, an initial brief that makes the plan easy to approve, immediately followed by the FULL plan detail — context, the frozen ledger, every slice (goal, files, verify, depends-on) under its wave, and the verification bar.

The full detail opens with a compact **Planning disposition**: Phase 1 intent approved; Phase 2 surface map completed; Phase 3 ledger frozen plus the doubt-pass outcome or explicit N/A reason; Phase 4 slicing completed with slice count, wave count, widest width, execution mode CHOSEN or FORCED with the reason; Phase 5 approval document ready. It is observability, not another approval gate: never ask the operator to confirm it, never replace the slices or frozen decisions with this summary.

Fixed shape, three sections, written in the operator's language and at their explanation-depth preference, soft cap ~20 lines total:

1. **Qué se va a realizar** — the change in plain terms, one level above code.
2. **Decisiones del ledger que lo moldean** — the frozen decisions that shaped this design, and why they matter.
3. **Cómo va a funcionar** — how the pieces connect once the change is live.

No confirmation loop and no question round — the repaso is read, not interrogated. There is exactly ONE approval gate, named by the reference file: hand it the plan built repaso-first, full-detail-after. A material change after presentation invalidates approval: re-present the complete repaso-first plan and pass the gate again. That approval is what starts execution. On approval, cross the reference file's execution boundary and save:

`mem_save(title: "oso/{change}/plan — {human description}", topic_key: "oso/{change}/plan", type: "architecture", capture_prompt: false, content: slices with [ ] marks, grouped into their waves, + current position)`

Update the index so this change surfaces on first search: create `oso/index` if it doesn't exist yet, else `mem_update` (merge, never overwrite other rows) — adding/updating the row `{change} — {human description} — status: executing`. Follow the index format standard. Rich title `oso/index — {project}: {n} changes, active: {change}`, kept current on every upsert. A `NEXT:` line at the top names the active change, slice position and what follows (AUTO's own annotation is `_shared/unattended.md`'s). Status vocabulary is exactly `planning/executing/done/roadmap`. The detail column cites literal topic keys (`oso/{change}/plan`, `oso/{change}/summary`). A `roadmap` row lists its children by topic key. Explicit pendings are named in the row.

Then initialize runtime state — the sentinel says execution has begun with no slice armed yet: `oso-state set mode=plan active_slice=none verify_green=false` (where §4's disposition answer was AUTO, arming that marker and cutting the run's own branch beside this write is `_shared/unattended.md`'s). Read it back with `oso-state show` and confirm the three keys before entering §6 — if they did not land, say so and stop rather than executing with the gates open.

## 6. Execution — one slice or one wave at a time, delegated

You (the orchestrator) never write code during execution: each slice runs through fresh-context subagents, and you manage the state, the ledger, and the human. The one exception is the design-foundation slice (§4): you run Impeccable's `init` or `document` yourself, scoped exclusively to design-doc generation, never feature code.

The ledger's execution mode (§4) picks the path: SEQUENTIAL is steps 1–4, once, in the main checkout; PARALLEL runs those same four steps per slice inside its own worktree, under the wave loop at `_shared/parallel.md` — opened only once §4's execution-mode question actually picked PARALLEL.

**Three coordinates, and every launch below names one by its own name.** CHANGE BASE is §3's Verification-row ref — unmoving for the whole change, what the close's two judges (§7) diff against. WAVE START is the commit a wave's worktrees are cut from. Wave 1's is the CHANGE BASE when no wave 0 ran, wave 0's own landing commit when it did. Every later wave's is the commit the previous wave's integrator produces on a clean merge — a conflict or a red integration gate lands no such commit, so no next wave arms until this one does. SLICE START is what the ACTIVE slice's own novelty is judged against: under SEQUENTIAL it is `HEAD`, since nothing else commits to the main checkout while that slice is active; under PARALLEL a worktree holds nothing before its own cut, so SLICE START is the same WAVE START it was cut from. `oso-code:triage` compares a red check against WAVE START, never CHANGE BASE — a breakage an earlier wave already landed is background the wave in flight never introduced.

Both delegations below are launches you READ before you move: an unwaited applier sends verify to code nobody wrote, an unwaited verifier lets step 4 write `verify_green=true` over a verdict nobody read. How your host delivers that report is the reference file's to state.

For the active slice:

1. **Activate** — `oso-state set mode=plan active_slice=<n> verify_green=false`, then `oso-state show` and confirm `active_slice=<n>` came back before delegating.
2. **Apply (subagent)** — launch the `oso-applier` agent with the slice (goal, files, verify criteria), every ledger decision relevant to it, the project conventions, the rubric path (`_shared/rubric.md`), and the two coordinates that place the work — the WORKTREE PATH (the main checkout under SEQUENTIAL) and SLICE START.
   - Front-surface slices (`_shared/front-surface.md`) additionally carry the project's `DESIGN.md`/`PRODUCT.md` as conventions, the paths to Impeccable's `SKILL.md` and its `reference/` playbook (read as reference, never invoked), and a verify bar that includes the pinned detector. At the first such slice, resolve the pin per that file's recipe and write both numerals into the ledger's Verification row; a detector or pin that cannot resolve takes a `Verify-exception` instead, never a silent skip.
   - On `blocked`: resolve each question with the user (options with tradeoffs, recommendation first), record the answers in the ledger, derive any new surface or category the answers reveal and append it with its own questions, then launch a FRESH applier to complete the slice with the updated ledger — never finish the slice inline, never answer on the user's behalf. Under a ROADMAP the policy answers each question in their place, recorded the same way; a question it will not answer queues the change set aside.
3. **Verify (subagent)** — launch the `oso-verifier` agent with the slice criteria, the zero-warnings commands from the ledger, the rubric path, the relevant ledger decisions, and the same two coordinates, diffing `HEAD` since step 2 — this slice's own pending work alone, never a sibling slice already committed beside it.
   - On `fail`: relaunch the applier on the same slice assignment, carrying the verifier's findings VERBATIM — every one with its `file:line` and evidence. Loop apply → verify until it passes. A finding grounded in one of §2 step 6's four no-exception rules is never yours to overrule: FIX (the relaunch above) or ESCALATE it to the operator with options and tradeoffs. No payload you build may instruct any judge away from one of those rules — a standing ruling written into the next verifier's payload is that same overrule with a longer reach. Under a ROADMAP, ESCALATE is the reconciliation-class question the ground rules already queue, and the change is set aside on it. §3's doubt-pass reconciliation, and §7 step 3's bare-tag rule, stand outside this.
   - On `blocked` (broken environment, missing commands): resolve the blocker with the user, then relaunch the verifier — never the applier for a verifier-side blocker.
4. Only on the verifier's `pass`: `oso-state set mode=plan active_slice=none verify_green=true`, then COMMIT the slice (`git -C <main checkout> add -A` and `commit`, conventional-commit message, no AI attribution or `Co-Authored-By` trailer) — never a push — mark it `[x]` (`mem_update`), report the result, and move to the next slice.
   - Per-slice commits are ON by default, so nothing is asked here; the one thing that skips this commit is the ledger's Verification row saying so, or a base ref of `none`. Where the commit lands under AUTO is `_shared/unattended.md`'s.

Never run two slices at once. Never start slice N+1 while slice N is red. Small fixes are never applied inline "to save time" — they go through a subagent like everything else.

## 7. Close — when the user says they are happy

The heading is the entry with an operator present. Under a ROADMAP nobody is there to say it, so this close has a MACHINE ENTRY CONDITION in their place: the change's LAST slice goes green and is committed and marked `[x]`, or under PARALLEL the last wave's integration gate passes — with every slice of the plan marked, there is nothing left for the operator to be happy about.

A run whose operator flipped AUTO owes them one report at its end, sequenced with this close's disarm per `_shared/unattended.md`, read ALWAYS by this flow.

Parallel leaves trees AND branches behind, so a change that ran in waves opens its close by clearing both, before step 1 arms the sweep. First the trees: any worktree of this change still standing is removed through git (`git -C <main checkout> worktree remove <path>`, never `rm -rf`), then `git -C <main checkout> worktree prune` clears any registration a killed run left behind. A removal git refuses is uncommitted work in a wave that never integrated: name it to the operator, never force it.

Then the branches, after the trees and never before — git will not delete a branch a standing worktree still has checked out. Any branch still standing goes through `git -C <main checkout> branch -d oso/<change>/<slice>` — never `-D`, never a force. A refusal says that branch is the only copy of that slice's committed work: name it to the operator with the slice it belongs to and let them decide.

A change that ran sequentially has nothing here to clear.

1. Activate the sweep as a slice: `oso-state set mode=plan active_slice=debt-sweep verify_green=false`, then `oso-state show` and confirm.
2. **Judge (subagent)** — INVOKE the debt-sweep judge in its own fresh, isolated context, with CHANGE BASE (the ledger's Verification row, left out when it says `none`, which drops the sweep onto its own Scope rule) and the frozen ledger as bare decisions + scope only — never the rationale or rejected alternatives. Never sweep your own change in this conversation — an orchestrator sweeping its own work has no fresh eyes. It ends on two independent verdicts: `Debt Sweep: clean` or `Debt Sweep: findings` on one axis, and `Conformance: clean`, `Conformance: findings`, or `Conformance: skipped — no ledger provided` on the other — that last one is never a pass. `Debt Sweep: blocked` is a third, whole-report token — resolve what it names missing and invoke again fresh.
3. **Fix (subagent)** — findings route by axis, never through a shared path:
   - **Debt findings** → launch the `oso-applier` agent as a debt-cleanup assignment, with the findings VERBATIM (`file:line`, severity, the readability win), the change-surface file list, and the rubric path. The fix is the smallest edit that fully resolves each finding, carried across every site of the reported pattern inside that surface. Read the report finding by finding: `fixed` closes it; anything else stays open for the next round.
   - **Conformance findings** → operator triage, one finding at a time, each with two readings for the operator to pick between: the CODE diverged (fix through the `oso-applier` agent as judge findings), or the DECISION changed (AMEND the ledger — a dated entry appended, never edited, via `mem_update`). Under a ROADMAP, amendment is never the policy's to pick — it queues the change set aside; a code-diverged fix the policy can justify on the evidence proceeds.
   - **`Unimplemented`** goes back to §6 as its own slice, with its own failing check, through the normal apply → verify loop — never fixed inline here.

   Re-invoke the debt-sweep judge to confirm, restating CHANGE BASE, the ledger AS IT NOW STANDS (amendments included, never the superseded text), and every finding raised so far with its disposition (`fixed`, `operator-dismissed`, `accepted-residual`) — bare, never the reasoning. Loop judge → fix under the exit bar below.

   **Exit bar** — a severity BAND, never an empty findings list: no `blocker` and no `structural` finding open on the debt axis, and `Conformance: clean` on the other. An open `nit` is this loop's NAMED RESIDUAL — recorded in the ledger and relayed to the operator verbatim under the residual exception in `_shared/reporting.md`. HARD CAP three judge → fix rounds. At the cap with a `blocker` or `structural` finding still open, the OPERATOR picks: accept the residual, grant more rounds, or send the remainder to §6 as its own slice. Under a ROADMAP that policy picks among those three, recorded, an accepted one taking the `accepted-residual` disposition; where none is justified on the evidence, the change is set aside at the cap.
4. **Design audit (subagent, front surface only)** — after the sweep meets its exit bar on both axes and before `verify_green`: INVOKE Impeccable's `audit <touched surfaces>` under `_shared/front-surface.md`'s exit bar, fix route and residual rules. You run the project bar each round proves against — running a check is not writing code — and record what that file requires (an accepted residual, an open P2/P3) in the ledger.
5. Update the change's `oso/index` row to `status: done` (`mem_update`), keeping the rich title and `NEXT:` line current.
6. Save a session summary to engram (`"oso/{change}/summary — {human description}"`) — decisions and outcomes only, never phase artifacts or verbose progress.
7. **Green, last** — only once the sweep has MET its exit bar on both axes, and the design audit, if it ran, has met its own exit bar or the operator explicitly accepted its residual: `oso-state set mode=plan active_slice=none verify_green=true`. Nothing may edit code after this write: a path that has to — an accepted security fix, a late correction — re-arms the state as its own slice, lands the edit through the `oso-applier` agent, re-runs the zero-warnings bar, and only then repeats this step. A named residual is not such an edit and never re-reds this flag.
8. A COMMIT is part of the flow and never asked for: what this close itself landed — the sweep's fixes, the design audit's, an accepted security fix — is committed here the same way as §6, after step 7's green. PUSH and PR still require the operator to ask; under an UNATTENDED run they are the FINISH instead — `_shared/unattended.md`'s. When opening a PR, include the frozen decision ledger and the slice summary in the PR body.
   - Before this commit, and before any push or PR — if the ledger recorded a security derived category (auth/payments surfaces), offer AND recommend a security review. On acceptance invoke the security-pass judge in its own fresh context, passing CHANGE BASE and the ledger's Verification row — passed as no ref at all when that row says `none`, since the pending tree IS the change then. Relay its markdown report to the operator verbatim. Fixes the operator accepts go through the `oso-applier` agent as judge findings, never inline; re-run the security-pass judge afterward until it returns `Security Pass: clean`. On `findings`, the operator fixes through that loop or explicitly accepts the residual. On `blocked`, resolve what it names missing and invoke again fresh — never treat a missing review as clean. A native review that covered only the pending fragment, not the full committed range, is a coverage gap to name to the operator, not to overstate as clean.
