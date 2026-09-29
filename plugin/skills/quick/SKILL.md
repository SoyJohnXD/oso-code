---
name: quick
description: "Fast iteration mode for small, easily verifiable changes. Runs a one-exchange micro-intent, iterates with visible results, and closes with a quality pass. Use for visual tweaks, small fixes, and adjustments that fit in a handful of files."
argument-hint: "[what to change]"
disable-model-invocation: true
---

# Quick mode

Fast, guided iteration for small changes. The operator steers; you keep the bar high.

## Files this flow reads

- `references/<host>.md` beside this file — read ALWAYS by this flow, now: what it leaves to the host (the tools it calls, the paths it interpolates, the state command). "Your host" below means this file.
- `_shared/references/<host>.md` — read ALWAYS by this flow: **Making a launch wait**, **The model a launch carries**, **The native card is not the report** and **The unattended run**.
- `_shared/reporting.md` — read ALWAYS by this flow: the milestone contract every judge and delegation reports under.
- `_shared/rubric.md` — read at the first edit: §3's Debt markers bar binds you at write time.
- `_shared/front-surface.md` — read when the change touches front surface.
- `_shared/didactic.md` — read when the explanation depth is didactic: the didactic register.

## 1. Micro-intent (one exchange, not a plan)

Read operator preferences silently — quick never asks. THIS PROJECT's `oso/preferences` record is the one record per project that `mem_search(query: "oso/preferences")` → `mem_get_observation(id)` can retrieve — previews are 300 chars. When it exists, apply its explanation depth (concise / standard / didactic), adaptive teaching (auto-detect / always / off) and model profile (`model_profile`, with the per-role tiers beside it) values; otherwise proceed with defaults — standard depth, auto-detect teaching. The preference ask belongs to the PLAN mode only.

Restate in one or two sentences:

- **Goal** — what changes.
- **Visible success** — how the operator will see it worked: a screen state, a command output, a passing test.

If either is unclear, ask exactly one question. Otherwise state both as assumptions and start. Vague (you can't tell *what* to change) takes the one question; knowledge-poor takes a teaching moment, below.

If the ask is actually a bug — something that worked and broke — say so and offer the DEBUG mode. The operator decides; if they choose to continue here, continue without further pushback.

**Teaching moment.** Before starting, fire when any trigger holds:

- **The ask contradicts current standard practice** — e.g. asks to hand-roll auth-token storage when the platform keychain is the standard.
- **The operator can't say what their ask involves** — e.g. "add SSO" but can't say against which identity provider.
- **The operator can't answer a decision that surfaces** — a choice you put to them (§3) meets silence or confusion.

When it fires, explain in 2–6 sentences: the terrain, the standard-path recommendation, and the why — BEFORE starting. It adds no mandatory exchange when nothing triggers. The guard is PER-TOPIC, not per-operator: knowing the flow ≠ knowing OAuth. Preference consumption: **always** → add a teaching-relevant terrain note whenever there is one; if there is genuinely nothing to teach, say nothing rather than filler. **auto-detect** → fire on the checklist above. **off** → silent.

## 2. Substantiality check

Before touching code, recommend the PLAN mode instead when any of these hold:

- The change needs architecture or contract decisions the operator has not made.
- New business logic spans 3+ files, or touches data models, auth, or payments.
- Success cannot be verified visually or with a fast command.

Say why in one sentence and let the operator decide. If they choose to continue here, continue without further pushback.

These fire before the operator decides — they are your rationalizations, not their call:

| Trap | Reality |
| --- | --- |
| 'it's small enough if I squint' | If the size is arguable, the PLAN trigger already fired. |
| 'the operator chose to continue once, so the check is settled for everything that follows' | Scope that grows mid-flow re-triggers the check — a past yes never covers new files. |
| 'success is sort of visually verifiable' | 'Sort of' is not verifiable — name the concrete screen state, command output, or passing test. |

## 3. Iterate

Before the first edit, initialize the runtime state — the commit gate stays locked until the quality pass. The whole triple goes in every write: a stale green or a slice left armed by an abandoned flow is overwritten here, never inherited.
`oso-state set mode=quick active_slice=none verify_green=false`
Read the echo `set` prints: a non-zero exit, or an echo that does not carry the three keys as written, means a write that failed and left the commit gate open with no other signal — STOP and tell the operator instead of iterating.
State outlives this session: if the operator walks away mid-flow, run `oso-state close`, or the stale green rides over the next unrelated work in the repository.

- Work in small increments that each produce a visible result (run the app, run the affected test, show output).
- **No inline comments** — quick has no applier to coach, so the rubric's Debt markers bar binds YOU at write time. Names and structure carry the meaning, the language's standard public-API doc form is the only exception, and a decision the operator made goes in your reply to them and in the close's session summary, never into a source file.
- **Front surface** — when the change touches front surface, increments follow the project's `DESIGN.md`/`PRODUCT.md` when they exist.
- **Design reference** — quick is inline, so before iterating it READS those docs itself plus the installed Impeccable skill's `SKILL.md` and its `reference/` playbook directory.
- **Missing design docs** — a NEW front page or feature in a project with no `PRODUCT.md`/`DESIGN.md` FIRST invokes the Impeccable skill with `init` (new front — the brand/audience questions happen with the operator) or with `document` (existing pages — generates `DESIGN.md` from the code).
- **Absence policy** — if Impeccable is not installed, follow the absence policy in `_shared/front-surface.md`; quick records the gap in the close's session summary.
- When a decision surfaces that the operator has not made — a library, a contract, a UX behavior — present options with tradeoffs and let them choose. Never assume. When a decision hinges on an external library's current API, version, or migration path, check context7 before presenting options; state whether each recommendation is current standard practice.
- Stay inside the stated goal. New wants from the operator are welcome; silent scope growth is not.
- Stop-the-line — breakage unrelated to the change discovered while iterating is never fixed in passing: name it and offer the DEBUG mode; declining is noted in the close's session summary and iteration continues.

## 4. Close — when the operator says it's done

Every judge invoked below (quality-pass, and security-pass when offered) and every delegation launched from an accepted finding reports under the milestone contract at `_shared/reporting.md`, delivered under your host's delivery contract.

1. Invoke the quality-pass judge on the touched code. On `Quality Pass: blocked`, present the findings it could not resolve to the operator with options and tradeoffs, apply the operator's decision the same way its own Apply step does, and re-run the judge until it returns `Quality Pass: passed`.
2. Zero warnings: the project's own checks — discovered from the project — must be clean before declaring done. When the change touched front surface, the pinned design detector joins these checks, run on the touched surfaces under the detect-gate contract in `_shared/front-surface.md`: the pin is resolved by that file's recipe when the front work starts, and both numerals land in the close's session summary (step 5). A detector that cannot run for environment reasons, or a pin that cannot be resolved at all, is named as skipped there rather than silently dropped.
   Refuse the dodges that fake a clean close:

   | Trap | Reality |
   | --- | --- |
   | 'this project has no checks' | Name what you searched — package.json scripts, Makefile, CI config — before concluding none exist. |
   | 'the warnings were already there before my change' | 'Already there' is not clean — the close bar is zero warnings, not a smaller count than before. |
   | 'it's only a warning, not an error' | The gate is zero warnings — a warning left standing is a fail. |
3. **Design audit (front surface only).** When the change touched front surface, after the checks above are clean and before the commit gate unlocks, invoke the Impeccable skill with `audit <touched surfaces>` and run its loop under the exit bar, fix route and residual rules in `_shared/front-surface.md`. Two things in that loop are quick's own. Step 2 declared the project's checks clean BEFORE this ran, so a fix landed here re-runs those checks to zero warnings before step 4 unlocks. And everything that file has the mode record — an accepted residual, a P2 or P3 still open at exit — goes in the close's session summary (step 5).
4. When the quality pass returns `Quality Pass: passed` — and the design audit, if it ran, met its exit bar or the operator accepted its residual (step 3) — unlock the commit gate:
   `oso-state set mode=quick active_slice=none verify_green=true`
   Nothing may edit code after this write. A path that has to — an accepted security fix below, a late tweak — re-reds the flag (`oso-state set mode=quick active_slice=none verify_green=false`), re-runs the project's checks to zero warnings, and only then unlocks again: green is never left standing over an edit the checks have not seen.
5. Save to engram only: a session summary with a rich title (descriptive, with domain keywords, so it surfaces on first search), plus any non-obvious discovery or convention learned. Cite any related topic keys literally (`oso/{change}/plan`) — never dash wiki-links like `[[oso-x-plan]]`. Do not save iterations or progress. Engram content and titles are written in English; Oso narrates them in Spanish when the operator asks.

Before any commit — if the change touched data models, auth, or payments (the §2 trigger vocabulary), offer AND recommend a security review. On acceptance invoke the security-pass judge — it runs the review in its own fresh, isolated context — with NO base ref in its ARGUMENTS, since quick tracks no branch model, and relay the returned markdown report to the operator verbatim. Fixes the operator accepts go through the `oso-applier` agent as judge findings, never inline, then RE-RUN the security-pass judge until it returns `Security Pass: clean`. That fix runs on the model the profile names for its role, named in the Launching milestone. On `Security Pass: findings`, the operator decides between fixing through that same loop and explicitly accepting the residual. On `Security Pass: blocked` the review never ran at all — resolve what it names missing with the operator and invoke the security-pass judge again fresh; never treat the missing review as clean. The operator decides, declining proceeds. The review reads the PENDING working-tree diff — after commit there is nothing left to review.

This flow lands no commit of its own — a commit per slice is the PLAN mode's, and quick has no slices. Never push or open a PR unless the operator asks.

Once the close is done and any commit the operator asked for has landed, run `oso-state close` as this flow's LAST state write: it releases the gates this session holds and refuses, changing nothing, when another session owns them.
