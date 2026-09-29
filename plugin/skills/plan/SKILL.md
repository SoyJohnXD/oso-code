---
name: plan
description: Deep mode for substantial changes. Plans intent, surface, decisions and slices inside Plan Mode, gets one Repaso-headed approval, then executes slice by slice with independent verification and a zero-warnings bar. Use for features, refactors, or architecture and contract decisions.
argument-hint: [change-name or what to build]
disable-model-invocation: true
---

# Plan mode

The operator decides; you guide, present options with tradeoffs, and never assume.

## Files this flow reads

- `references/<host>.md` beside this file — read ALWAYS by this flow, before phase 0: "your host" and "the reference file" below mean this file.
- `_shared/references/<host>.md` — read ALWAYS by this flow.
- `_shared/reporting.md` — read ALWAYS by this flow: report every arm, launch, verdict and close under its milestone contract; it also defines the inline-or-applier threshold.
- `_shared/rubric.md` — read ALWAYS by this flow: §2 step 6 audits the map against it.
- `_shared/unattended.md` — read only once AUTO arms: §4's disposition answer, an operator instruction at any point, or when the change runs as a child of the ROADMAP.
- `_shared/parallel.md` — read only once §4's execution-mode question picks PARALLEL.
- `_shared/front-surface.md` — read when the change touches a front surface.
- `_shared/didactic.md` — the didactic register.

## Ground rules for the whole flow

- Phases 1–5 run inside the host's read-only planning mode where it has one, entered before phase 1 and kept through §5's delivered approval document — nothing before §6 writes code. Whether a ROADMAP child enters it is the reference file's call.
- Question rounds: 2–4 options with tradeoffs, your recommendation first with why, and whether it is current standard practice — verify a library, framework, or well-trodden pattern against context7 before recommending. Round size and the asking tool are the reference file's.
- Operator-facing content — the intent, the surface map, any narrative the operator must read — follows the reference file's delivery contract.
- If phase 1 shows the change is small, offer QUICK; if a bug, offer DEBUG — the operator decides.
- `mem_search` returns 300-char previews — always call `mem_get_observation(id)` for full content. Engram content and titles are written in English; Oso narrates them in Spanish on request.
- The commit gate refuses `git commit` while `verify_green` is false; the edits gate refuses a file edit while `mode=plan` and no slice is active. Keep the triple (`mode`, `active_slice`, `verify_green`) honest with `oso-state` — a slice CLOSES by writing `active_slice=none`. Every `set` echoes the state it left: a non-zero exit, or an echo missing the values you wrote, means STOP and report.
- Abandoning this flow mid-run: run `oso-state close` (§7 step 9); `clear` stays the operator's hard reset.
- A ROADMAP child never waits for the operator: that mode's policy answers in their place, and what it will not answer sets the change ASIDE. That routine, and every point below marked "under a ROADMAP", are stated in `_shared/unattended.md`, read when the change runs as a child of the ROADMAP.

## 0. Resume check

Search engram: `mem_search(query: "oso/index")`, then `mem_get_observation(id)` for the full table (fallback when it doesn't exist yet: `mem_search(query: "oso/{change}/plan")`). Self-heal every `executing` row against its `oso/{change}/plan` or `/summary` observation before trusting it — `mem_update` merge, never overwrite, never scan the whole index otherwise. Locate `{change}`'s row, fetch its ledger and plan, report the recorded position, and continue from there — never re-ask what the ledger already answers.

Resuming into execution re-arms runtime state first: `oso-state set mode=plan active_slice=<current> verify_green=false`, reading its echo. A change whose ledger picked PARALLEL also reports its standing worktrees per `_shared/parallel.md`, read only once PARALLEL is picked.

Read `oso/preferences` (one record per project; `mem_search` filters by cwd). Self-heal a retired field or a legacy `scope: personal` copy via `mem_update`, then apply silently:

- **Behavior**, asked at the FIRST plan in this project (no record yet): one round of two questions — **explanation depth** (concise/standard/didactic) and **adaptive teaching** (auto-detect/always/off).
- **Ceiling**, never asked here — `_shared/unattended.md` asks it at the first AUTO or ROADMAP arming, read only once AUTO arms.
- **Model profile**, never asked: `model_profile` — `normal`, `strong`, or a `custom` naming a tier per role — read silently for the launches below, changed only by the operator's own request or `oso profile set`.

Save once: `mem_save(title: "oso/preferences — this project's operator record", topic_key: "oso/preferences", type: "preference", capture_prompt: false, content: the values + date)`. Later updates, including an operator's natural-language request, go through `mem_update` (merge, never overwrite), confirmed with no ceremony.

## 1. Intent

Understand WHAT the operator wants, one level above code — no stack talk, no file names, no how. Produce and show, at the operator's explanation-depth preference (`_shared/didactic.md` for the didactic register):

- **Intent** — two or three sentences.
- **In-scope / Out-of-scope** — explicit lists.
- **Visible outcome** — what exists when this is done that does not exist today.

**Teaching moment**, before iterating: fires when the ask contradicts standard practice, the operator can't say what their ask involves, or can't answer a decision question. When it fires, explain in 2–6 sentences the terrain, the standard-path recommendation and the why; the guard is per-topic, not per-operator. By preference: **always** adds a teaching note every round, saying nothing rather than filler; **auto-detect** fires on the triggers above; **off** stays silent.

Iterate until the operator approves the intent. Do not advance without approval.

## 2. Surface mapping

Turn the approved intent into a map of what the change actually touches, built from evidence, not a checklist.

1. Launch up to 3 exploration subagents in parallel (your host's explorer), each with a focus derived from the intent, to discover modules, contracts and their consumers, shared state, jobs, data flows.
2. Generate the surface list from what they return — never recited from a fixed list.
3. Audit the map against the INVARIANT CORE (§3: Contracts, Architecture, Errors, Verification, Reuse) — each lens covered by a surface, marked N/A with a reason, or revealing a surface exploration missed. Derive further categories from the surfaces, each citing its evidence: infra → rollback, cost, observability; front surfaces (when the change touches one, `_shared/front-surface.md`'s trigger) → accessibility, responsive, state, and that file's absence policy; data-touching → data model, migrations, source of truth; auth/payments → security; user-facing → UX behavior.
4. Generate the question battery from the map — every question cites the code evidence that motivates it and the consequence of not deciding it.
5. Prioritize blocking decisions first, feeding Decision rounds at the reference file's per-round cap.
6. Audit the map against the four rules the rubric puts outside its own judgment contract — the three Hard blockers and the inline-comment debt class. A repo convention in tension with one of them is a battery QUESTION, ranked with its consequence, answered by the operator and recorded — never softened as "the project's own convention."

Fallback: if exploration surfaces nothing clear, use the INVARIANT CORE as the question generator; only the evidence citation is waived.

Exit: every surface has a battery question or an explicit N/A, and every core lens and derived category is questioned or marked N/A.

## 3. Decision rounds

Goal: after this phase, execution needs zero assumptions. The battery is the source of questions; the table below is an audit floor, never a generator. Present the surface map and its audited N/As as a turn-ending message before the first round — the map has no approval gate of its own.

Run rounds until every core lens and derived category is decided or marked N/A with a reason:

| Category | Covers |
|---|---|
| Contracts | APIs, signatures, events, exchange schemas |
| Architecture | Where logic lives, dependency direction, patterns to follow or establish |
| Errors | Expected failures, empty/invalid states, what the operator sees when things break |
| Verification | What proves each part works, and this project's zero-warnings bar |
| Reuse | Existing code and primitives the change must use instead of recreating |

Derived categories (§2 step 3) — Data, UX behavior, Security among others — run through the same rounds.

**Verification** records the exact lint/type/test/build/run commands this project has (the rest N/A), and settles:

- **Base ref** — what the close's two judges (§7) diff against; `none` when nothing is committed yet, which forces SEQUENTIAL execution (§4).
- **Per-slice commits** — ON by default: a slice commits when it goes green, in both modes. A branch policy that can't take one commit per slice turns them off here, which also forces SEQUENTIAL.
- **Concurrency** — whether this project's bar tolerates N slices' checks side by side (a shared port, one test database, a build cache, a lockfile). Record it as a QUESTION; §6 answers it at the first wave.
- When the change touches a front surface, the pinned design detector joins these commands as `_shared/front-surface.md`'s PLAN wiring records it.

Rules:

- Enumerable choices get options with tradeoffs, never open-ended questions.
- Record every decision, its rationale, and the alternatives rejected, in the ledger; a decision the operator delegates ("you pick") is recorded as delegated.
- Before freeze, every ledger entry cites the in-scope item or Visible-outcome element it serves; an entry serving only a future need is a YAGNI candidate for the operator to cut or keep.
- Freeze is a reconciliation gate. Before accepting "frozen", render the battery as a checklist — every question mapped to a decision, a delegated mark, or a reasoned N/A. State any still-open item as an explicit assumption ("If you freeze now, I will assume X → I'd pick Y because Z"); the operator answers it or freezes over it, recorded as delegated.
- **Doubt pass** — offered and recommended when a derived category came from a migrations, security, or rollback surface; on decline, record `Doubt pass: N/A — no migration, security, or rollback surface` in §5. On acceptance, invoke the doubt-pass judge with ONLY the intent, surface map, and bare decisions — never the rationale. `Doubt Pass: clean` lets freeze proceed; `Doubt Pass: findings` go to the operator like §6 blocked questions, less those the recorded rationale already answers; `Doubt Pass: blocked` — resolve what it names missing and invoke it again fresh. Re-run only after major ledger changes, hard cap 3 cycles; 2+ cycles with zero findings is doubt theater — name it and stop.

On freeze, save the ledger once: `mem_save(title: "oso/{change}/ledger — {human description}", topic_key: "oso/{change}/ledger", type: "architecture", capture_prompt: false, content: intent + surface map + scope + every ledger entry)`.

## 4. Slicing

Split the change into vertical slices — each delivers observable progress and fits one focused apply/verify batch, never a one-line task, never half the project. Each slice states:

- **Goal** — the observable progress it delivers.
- **Files** — expected touch points.
- **Verify** — which project checks plus what observable behavior proves it, and at least one automated check that fails without the slice. When none is sensible (docs, config), state `Verify-exception: <reason>` instead.
- **Depends-on** — the slices that must land first, by number, or nothing.

Cut by that bar alone, never by the target execution mode: the dependency graph is DERIVED from the cut. A horizontal cut made for parallelism — "all the types", "all the tests" — is individually unverifiable, so not a slice.

**Design-foundation slice.** When the change touches a front surface and the project has no `PRODUCT.md`/`DESIGN.md`, the FIRST slice is design-foundation — wave 0, run by the orchestrator — cut and run as `_shared/front-surface.md`'s PLAN wiring states.

**Expand-contract slicing.** When the surface map shows a contract, signature, or schema change with many consumers, offer the template: EXPAND, MIGRATE, CONTRACT. EXPAND adds the new form beside the old so every check stays green; MIGRATE moves consumers in batched, independently verifiable slices; CONTRACT deletes the old form — its Verify MUST include a pre-delete completeness check proving zero remaining consumers, run before the delete lands.

**The dependency graph.** Draw one edge per dependency, read off the surface map, and fill each slice's `Depends-on` from it. Four sources: a CONTRACT and its consumers, SHARED STATE two slices both write, a DATA FLOW from one into the other, and VERIFICATION-BAR COUPLING — two slices that cannot pass this project's bar apart (a rule added in one, the count a doc states for it raised in the other). File overlap is a secondary check for physical conflicts only.

**Waves.** A wave is a set of slices with no edge between any two, starting once the wave before it has landed. CONTRACT never shares a wave with a MIGRATE slice. A wave's WIDTH is how many slices it holds. Present the slices in wave order, each with its four fields, and the widest wave's width.

**The execution mode.** Ask the operator, as the first question of one round: run the slices SEQUENTIALLY in the main checkout, or each wave in PARALLEL, one worktree per slice — the width, the estimated gain, and your recommendation travel in the question's own fields.

- Recommend parallel when the widest wave is 3 or more; at 2, report the number and recommend sequential.
- The gain comes from the widest wave, never the slice count: a wave costs its slowest slice plus one full integration gate.
- The concurrency cap defaults to 4, adjustable here — this settles §3's concurrency question.
- A base ref of `none`, or per-slice commits off, never reaches this question: sequential is the only mode. Record the forced mode, the exact reason, the wave count and the widest width for §5's planning disposition.

**The execution disposition**, the round's second question: run §6 and §7 NORMALLY, with the operator at every decision point, or under AUTO. NORMAL is the default and the recommendation; an operator who said auto earlier has answered it. An AUTO answer arms it: read `_shared/unattended.md` only once AUTO arms, which is here.

Record the mode, the cap when parallel, and the disposition with its date in the ledger.

## 5. Repaso de cambios (change recap) — heads the approval document

The repaso is ALWAYS delivered. It HEADS the plan document your host's approval gate receives, followed by the FULL plan detail — context, the frozen ledger, every slice with its four fields under its wave, and the verification bar.

The full detail opens with a compact **Planning disposition**: Phase 1 intent approved; Phase 2 surface map completed; Phase 3 ledger frozen plus the doubt-pass outcome or explicit N/A reason; Phase 4 slicing completed with slice count, wave count, widest width, execution mode CHOSEN or FORCED with the reason; Phase 5 approval document ready. It is observability: never ask the operator to confirm it, never let it replace the slices or decisions.

Fixed shape, three sections, in the operator's language and explanation depth, soft cap ~20 lines total:

1. **Qué se va a realizar** — the change in plain terms, one level above code.
2. **Decisiones del ledger que lo moldean** — the frozen decisions that shaped this design, and why they matter.
3. **Cómo va a funcionar** — how the pieces connect once the change is live.

No confirmation loop and no question round. There is exactly ONE approval gate, named by the reference file: hand it the plan, repaso first, full detail after. A material change after presentation invalidates approval: re-present the complete plan and pass the gate again. That approval starts execution: cross the reference file's execution boundary and save:

`mem_save(title: "oso/{change}/plan — {human description}", topic_key: "oso/{change}/plan", type: "architecture", capture_prompt: false, content: slices with [ ] marks, grouped into their waves, + current position)`

Update the index: create `oso/index` if missing, else `mem_update` (merge, never overwrite other rows) the row `{change} — {human description} — status: executing`. Rich title `oso/index — {project}: {n} changes, active: {change}`, kept current on every upsert. A `NEXT:` line at the top names the active change, slice position and what follows. Status vocabulary is exactly `planning/executing/done/roadmap`. The detail column cites literal topic keys (`oso/{change}/plan`, `oso/{change}/summary`); explicit pendings are named in the row.

Then initialize runtime state — execution has begun with no slice armed: `oso-state set mode=plan active_slice=none verify_green=false`. Under AUTO, the marker and the run's own branch join this write per `_shared/unattended.md`, read only once AUTO arms. Read the echo for the three keys before entering §6.

## 6. Execution — one slice or one wave at a time

Each slice is written by the threshold defined at `_shared/reporting.md`; PARALLEL waves keep one applier per worktree.

The ledger's execution mode (§4) picks the path: SEQUENTIAL runs steps 1–4 per slice in the main checkout; PARALLEL runs them per slice in its own worktree, under the wave loop at `_shared/parallel.md`, read only once PARALLEL is picked.

**Coordinates, each launch below naming one by name.** CHANGE BASE is §3's base ref — fixed for the whole change, what §7's two judges diff against. SLICE START is what the ACTIVE slice's novelty is judged against: `HEAD` under SEQUENTIAL, the wave's WAVE START under PARALLEL.

Every launch below is a delegation you READ before you move — never verify unreported work, never write `verify_green=true` over an unread verdict.

For the active slice:

1. **Activate** — `oso-state set mode=plan active_slice=<n> verify_green=false`, and read the echo for `active_slice=<n>` before the slice's work starts.
2. **Apply** — over the threshold, launch the `oso-applier` agent with the slice (goal, files, verify criteria), the DECISION BLOCK, the project conventions, the rubric path (`_shared/rubric.md`), and the two coordinates that place the work — the WORKTREE PATH (the main checkout under SEQUENTIAL) and SLICE START. The applier runs on the model the profile names for its role, named in the Launching milestone. The DECISION BLOCK is every ledger decision relevant to this slice, copied from the ledger record BY ID — verbatim and whole, never paraphrased and never quoted in part. The slice's Verify line travels as §4 wrote it: its failing check is what `red:` and `green:` exercise, and a `Verify-exception` there is what `red: exception — <its reason>` carries instead.
   - A front-surface slice adds the payload and pin resolution `_shared/front-surface.md`'s PLAN wiring names, read when the change touches a front surface.
   - On `blocked`: resolve each question with the operator as a question round, record the answers in the ledger, derive any new surface or category the answers reveal and append it with its own questions, then the threshold completes the slice — inline under it, else a FRESH applier — on the updated ledger, never answering for the operator. Under a ROADMAP the policy answers in their place.
3. **Verify (subagent)** — launch the `oso-verifier` agent with the slice criteria, the zero-warnings commands from the ledger, the rubric path, step 2's DECISION BLOCK unchanged, `applier_proof`, and the same two coordinates, diffing `HEAD` since step 2 — this slice's own pending work alone. The verifier runs on the model the profile names for its role, named in the Launching milestone. Every slice goes to a FRESH verifier, whoever wrote it. `applier_proof` carries exactly the author's `proof:`, `scan:`, and `decisions_used:` blocks, verbatim — never its narrative or other report fields.
   - On `fail`: apply the findings by the threshold above — inline under it, else relaunch the `oso-applier` agent on the same slice assignment. Carry the verifier's findings VERBATIM, every one with its `file:line` and evidence. A refuted claim among the verdict's `claims:` lines is one of those findings and rides the same fix. Loop apply → verify until it passes; every re-verification is a FRESH verifier. A finding grounded in one of §2 step 6's four rules is never yours to overrule: FIX it, or ESCALATE it to the operator with options and tradeoffs. No payload you build may instruct a judge away from one of those rules; §3's doubt-pass reconciliation and §7 step 3's bare dispositions stand outside this. Under a ROADMAP, ESCALATE sets the change aside.
   - On `blocked` (broken environment, missing commands): resolve the blocker with the operator, then relaunch the verifier — never the applier for a verifier-side blocker.
4. Only on the verifier's `pass`: `oso-state set mode=plan active_slice=none verify_green=true`, then COMMIT the slice (`git -C <main checkout> add -A` and `commit`, conventional-commit message, no AI attribution or `Co-Authored-By` trailer) — never a push — mark it `[x]` (`mem_update`), report the result, and move to the next slice.
   - Only the ledger's Verification row turning per-slice commits off, or a base ref of `none`, skips this commit.

Never run two slices at once. Never start slice N+1 while slice N is red.

## 7. Close — when the operator says they are happy

Under a ROADMAP nobody is there to say it, so its machine entry condition stands in. Under AUTO the close owes the operator one final report, sequenced with its disarm per `_shared/unattended.md`, read only once AUTO arms.

A change that ran in waves first runs `_shared/parallel.md`'s teardown, read only once PARALLEL is picked.

1. Activate the sweep as a slice: `oso-state set mode=plan active_slice=debt-sweep verify_green=false`, and read the echo.
2. **Judge (subagent)** — INVOKE the debt-sweep judge in its own fresh, isolated context, with CHANGE BASE (left out when the Verification row says `none`) and the frozen ledger as bare decisions + scope only — never the rationale or rejected alternatives. Never sweep your own change in this conversation. It ends on two independent verdicts: `Debt Sweep: clean` or `Debt Sweep: findings` on one axis, and `Conformance: clean`, `Conformance: findings`, or `Conformance: skipped — no ledger provided` on the other — that last one is never a pass. `Debt Sweep: blocked` is a whole-report token — resolve what it names missing and invoke again fresh.
3. **Fix** — findings route by axis, never through a shared path:
   - **Debt findings** → over the threshold, launch the `oso-applier` agent as a debt-cleanup assignment, with the findings VERBATIM (`file:line`, severity, the readability win), the change-surface file list, and the rubric path, launched on the model the profile names for its role, named in the Launching milestone. Read the report finding by finding: `fixed` closes it; anything else stays open for the next round.
   - **Conformance findings** → operator triage, one finding at a time, each with two readings: the CODE diverged (fix by §6's threshold, the `oso-applier` agent as judge findings when over it), or the DECISION changed (AMEND the ledger — a dated entry appended, never edited, via `mem_update`). An applier fix runs on the model the profile names for its role, named in the Launching milestone. Under a ROADMAP, the policy never amends.
   - **`Unimplemented`** goes back to §6 as its own slice, with its own failing check, through the normal apply → verify loop — never fixed here.

   Re-invoke the debt-sweep judge to confirm, restating CHANGE BASE, the ledger AS IT NOW STANDS (amendments included), and every finding raised so far with its disposition (`fixed`, `operator-dismissed`, `accepted-residual`) — bare, never the reasoning. Loop judge → fix under the exit bar below.

   **Exit bar** — a severity BAND, never an empty findings list: no `blocker` and no `structural` finding open on the debt axis, and `Conformance: clean` on the other. An open `nit` is this loop's NAMED RESIDUAL — recorded in the ledger and relayed to the operator verbatim under the residual exception in `_shared/reporting.md`. HARD CAP three judge → fix rounds. At the cap with a `blocker` or `structural` finding still open, the OPERATOR picks: accept the residual, grant more rounds, or send the remainder to §6 as its own slice. Under a ROADMAP the policy picks, or the change is set aside at the cap.
4. **Design audit (subagent, front surface only)** — after the sweep meets its exit bar on both axes and before `verify_green`, run as `_shared/front-surface.md`'s PLAN wiring states, read when the change touches a front surface.
5. Update the change's `oso/index` row to `status: done` (`mem_update`), keeping the rich title and `NEXT:` line current.
6. Save a session summary to engram (`"oso/{change}/summary — {human description}"`) — decisions and outcomes only, never phase artifacts or verbose progress.
7. **Green, last** — only once the sweep has MET its exit bar on both axes, and the design audit, if it ran, has met its own exit bar or the operator explicitly accepted its residual: `oso-state set mode=plan active_slice=none verify_green=true`. Nothing may edit code after this write: a path that has to — an accepted security fix, a late correction — re-arms the state as its own slice, lands the edit by §6's threshold (the `oso-applier` agent when over it), re-runs the zero-warnings bar, and only then repeats this step. A named residual is not such an edit and never re-reds this flag.
8. A COMMIT is part of the flow and never asked for: what this close landed is committed here as in §6, after step 7's green. PUSH and PR still require the operator to ask; under an UNATTENDED run they are the FINISH instead, per `_shared/unattended.md`, read only once AUTO arms. When opening a PR, include the frozen decision ledger and the slice summary in the PR body.
   - Before this commit, and before any push or PR — if the ledger recorded a security derived category (auth/payments surfaces), offer AND recommend a security review. On acceptance invoke the security-pass judge in its own fresh context, passing CHANGE BASE — no ref at all when the Verification row says `none`. Relay its markdown report to the operator verbatim. Fixes the operator accepts follow §6's threshold (the `oso-applier` agent as judge findings when over it); re-run the security-pass judge afterward until it returns `Security Pass: clean`. An applier fix runs on the model the profile names for its role, named in the Launching milestone. On `findings`, the operator fixes through that loop or explicitly accepts the residual. On `blocked`, resolve what it names missing and invoke again fresh — never treat a missing review as clean. A native review covering only the pending fragment, not the full committed range, is a coverage gap to name to the operator, never clean.
9. **Close the state, last** — after step 8's commit, the push and PR an UNATTENDED run finishes with, and the AUTO disarm: run `oso-state close`, this flow's LAST state write. It releases this session's triple, leaves a chain's `roadmap`, `auto` and `auto_change` standing, and refuses, changing nothing, when another session owns the gates.
