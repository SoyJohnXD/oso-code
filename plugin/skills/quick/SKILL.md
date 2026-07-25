---
name: quick
description: Fast iteration mode for small, easily verifiable changes. Runs a one-exchange micro-intent, iterates with visible results, and closes with a quality pass. Use for visual tweaks, small fixes, and adjustments that fit in a handful of files.
argument-hint: [what to change]
disable-model-invocation: true
---

# Quick mode

Fast, guided iteration for small changes. The human steers; you keep the bar high.

## 1. Micro-intent (one exchange, not a plan)

Read operator preferences silently — quick never asks. If an `oso/preferences` observation exists (`mem_search(query: "oso/preferences")` → `mem_get_observation(id)`, the 300-char preview gotcha applies), apply its explanation depth (concise / standard / didactic — the didactic register is defined at `${CLAUDE_SKILL_DIR}/../_shared/didactic.md`) and adaptive teaching (auto-detect / always / off) values; if none exists, proceed with defaults — standard depth, auto-detect teaching. The preference ask belongs to `/plan` only.

Restate in one or two sentences:

- **Goal** — what changes.
- **Visible success** — how the user will see it worked: a screen state, a command output, a passing test.

If either is unclear, ask exactly one question. Otherwise state both as assumptions and start. Distinguish two kinds of unclear: vague (you can't tell *what* to change — the one question resolves it) from knowledge-poor (a teaching moment, below).

If the ask is actually a bug — something that worked and broke — say so and offer `oso-code:debug`. The user decides; if they choose to continue here, continue without further pushback.

**Teaching moment.** Before starting, fire when any trigger holds:

- **The ask contradicts current standard practice** — e.g. asks to hand-roll auth-token storage when the platform keychain is the standard.
- **The operator can't say what their ask involves** — e.g. "add SSO" but can't say against which identity provider.
- **The operator can't answer a decision that surfaces** — a choice you put to them (§3) meets silence or confusion.

When it fires, explain in 2–6 sentences: the terrain, the standard-path recommendation, and the why — BEFORE starting. This replaces blind execution and beats "default to short answers"; it adds no mandatory exchange when nothing triggers. Guard is PER-TOPIC, not per-operator: fluency with `/quick` says nothing about knowing the topic at hand (knowing the flow ≠ knowing OAuth) — read the topic, not the tool skill. Preference consumption: **always** → add a teaching-relevant terrain note whenever there is one; if there is genuinely nothing to teach, say nothing rather than filler. **auto-detect** → fire on the checklist above. **off** → silent.

## 2. Substantiality check

Before touching code, recommend `/oso-code:plan` instead when any of these hold:

- The change needs architecture or contract decisions the user has not made.
- New business logic spans 3+ files, or touches data models, auth, or payments.
- Success cannot be verified visually or with a fast command.

Say why in one sentence and let the user decide. If they choose to continue here, continue without further pushback.

These fire before the user decides — they are your rationalizations, not their call:

| Trap | Reality |
| --- | --- |
| 'it's small enough if I squint' | If the size is arguable, the /plan trigger already fired. |
| 'the user chose to continue once, so the check is settled for everything that follows' | Scope that grows mid-flow re-triggers the check — a past yes never covers new files. |
| 'success is sort of visually verifiable' | 'Sort of' is not verifiable — name the concrete screen state, command output, or passing test. |

## 3. Iterate

Before the first edit, initialize the runtime state — the commit gate stays locked until the quality pass. The whole triple goes in every write because `oso-state` can set a key but never delete one: a stale green or a slice left armed by an abandoned flow is overwritten here, never inherited.
`"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" set mode=quick active_slice=none verify_green=false`
Read it back with `"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" show` and confirm the three keys came back as written — a write that silently failed leaves the commit gate open with no other signal, so stop and tell the operator instead of iterating.
State survives until the session ends: if the operator walks away from this change mid-flow, run `"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" clear`, or the stale green rides over whatever unrelated work follows in the session.

- Work in small increments that each produce a visible result (run the app, run the affected test, show output).
- **Front surface** — when the change touches front surface (per the shared trigger at `${CLAUDE_SKILL_DIR}/../_shared/front-surface.md`), increments follow the project's `DESIGN.md`/`PRODUCT.md` when they exist.
- **Design reference** — quick is inline by design, with no subagent to coach, so before iterating it READS those docs itself plus the installed Impeccable skill's `SKILL.md` and its `reference/` playbook directory.
- **Missing design docs** — a NEW front page or feature in a project with no `PRODUCT.md`/`DESIGN.md` FIRST invokes the `impeccable:impeccable` skill through the Skill tool with `init` (new front — the brand/audience questions happen with the operator) or with `document` (existing pages — generates `DESIGN.md` from the code). Quick edits are unrestricted, so this is a direct step, not a gated slice.
- **Absence policy (D3 · 2026-07-24)** — if Impeccable is not installed, follow the absence policy in `${CLAUDE_SKILL_DIR}/../_shared/front-surface.md`; quick records the gap in the close's session summary.
- When a decision surfaces that the user has not made — a library, a contract, a UX behavior — present options with tradeoffs and let them choose. Never assume. When a decision hinges on an external library's current API, version, or migration path, check context7 before presenting options; state whether each recommendation is current standard practice.
- Stay inside the stated goal. New wants from the user are welcome; silent scope growth is not.
- Stop-the-line (D7) — breakage unrelated to the change discovered while iterating is never fixed in passing: name it and offer `oso-code:debug`; declining is noted in the close's session summary and iteration continues.

## 4. Close — when the user says it's done

1. Invoke the `oso-code:quality-pass` skill on the touched code.
2. Zero warnings: the project's own checks — discovered from the project — must be clean before declaring done. When the change touched front surface, the pinned design detector joins these checks, run on the touched surfaces under the detect-gate contract in `${CLAUDE_SKILL_DIR}/../_shared/front-surface.md`: the pin is resolved by that file's recipe when the front work starts, and both numerals land in the close's session summary (step 5). A detector that cannot run for environment reasons, or a pin that cannot be resolved at all, is named as skipped there rather than silently dropped.
   Refuse the dodges that fake a clean close:

   | Trap | Reality |
   | --- | --- |
   | 'this project has no checks' | Name what you searched — package.json scripts, Makefile, CI config — before concluding none exist. |
   | 'the warnings were already there before my change' | 'Already there' is not clean — the close bar is zero warnings, not a smaller count than before. |
   | 'it's only a warning, not an error' | The gate is zero warnings — a warning left standing is a fail. |
3. **Design audit (front surface only).** When the change touched front surface, after the checks above are clean and before the commit gate unlocks, invoke the `impeccable:impeccable` skill through the Skill tool with `audit <touched surfaces>` and run its loop under the exit bar, fix route and residual rules in `${CLAUDE_SKILL_DIR}/../_shared/front-surface.md`. Two things in that loop are quick's own: step 2 declared the project's checks clean BEFORE this ran, so a fix landed here re-runs those checks to zero warnings before step 4 unlocks; and everything that file has the mode record — an accepted residual, a P2 or P3 still open at exit — goes in the close's session summary (step 5).
4. When the quality pass returns `Quality Pass: passed` — and the design audit, if it ran, met its exit bar or the operator accepted its residual (step 3) — unlock the commit gate:
   `"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" set mode=quick active_slice=none verify_green=true`
   Nothing may edit code after this write. A path that has to — an accepted security fix below, a late tweak — re-reds the flag (`"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" set mode=quick active_slice=none verify_green=false`), re-runs the project's checks to zero warnings, and only then unlocks again: green is never left standing over an edit the checks have not seen.
5. Save to engram only: a session summary with a rich title (descriptive, with domain keywords, so it surfaces on first search), plus any non-obvious discovery or convention learned. Cite any related topic keys literally (`oso/{change}/plan`) — never dash wiki-links like `[[oso-x-plan]]`. Do not save iterations or progress. Engram content and titles are written in English; Oso narrates them in Spanish when the operator asks.

Before any commit — if the change touched data models, auth, or payments (the §2 trigger vocabulary), offer AND recommend a security review: on acceptance invoke the `oso-code:security-pass` skill through the Skill tool — it runs the review in its own forked subagent — with NO base ref in its ARGUMENTS, since quick tracks no branch model, and relay the returned markdown report to the operator verbatim; fixes the operator accepts go through the `oso-applier` agent as judge findings, never inline, then RE-RUN `oso-code:security-pass` until it returns `Security Pass: clean` or the operator explicitly accepts the residual findings. The operator decides, declining proceeds. The review reads the PENDING working-tree diff — after commit there is nothing left to review (D4).

Never commit, push, or open a PR unless the user asks.
