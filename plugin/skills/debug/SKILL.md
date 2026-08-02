---
name: debug
description: Debugging and error-recovery mode for something that broke. Triages reproduce-first — reproduce, localize, reduce — then delegates the fix and a regression test through the apply/verify loop with a zero-warnings bar. Use when a bug, crash, or failing behavior needs diagnosis; also the landing point when a /plan or /quick ask turns out to be a bug.
argument-hint: [what broke]
disable-model-invocation: true
---

# Debug mode

Guided flow for "something broke" — stop-the-line: while the bug is open, no feature work rides along, and the fix scope stays minimal.

Anti-swallow rule: operator-facing content — triage reports, the diagnosis presentation — ENDS the turn as plain text; the TUI drops assistant text that precedes a tool call in the same turn (same contract as /plan).

## 0. Resume check (light)

Before starting over, `mem_search(query: "oso/{bug}/diagnosis")` for an existing diagnosis that matches the symptom — engram gotcha: previews are 300 chars, `mem_get_observation(id)` for full content. Read `oso/preferences` (`mem_search` → `mem_get_observation`) and apply its depth and teaching values SILENTLY — debug never re-asks.

## 1. Reproduce — before any code

Before ANY code reading or hypothesis, obtain a concrete reproduction: the exact command or steps plus the observed failure versus what was expected. Capture it VERBATIM — it becomes evidence in the diagnosis and the seed of the regression test.

**No repro → no fix.** The flow stops and reports what it tried plus ranked hypotheses. The operator may order "fix on hypothesis" — an explicit override RECORDED in the diagnosis; the regression test stays mandatory — it encodes the hypothesis, and if the hypothesis is false, the test tells.

## 2. Localize + reduce

- Narrow to the failing layer or module with EVIDENCE — bisect, targeted logging, a minimal case — never a guess.
- Reduce the repro to the smallest case that still fails; the reduced case anchors the regression test.
- Teaching moment (per-topic guard, honoring the operator's teaching preference): when the failure sits on terrain the operator can't yet name, add one line of terrain before diving.

## 3. Diagnosis freeze — the triage exit bar

State all of these — this is the contract §4 hands the applier:

- **Root cause** — the cause, not the symptom.
- **Repro evidence** — the verbatim repro from §1.
- **Fix decision** — what changes and where.
- **Named regression test** — the test that FAILS without the fix and passes with it. That is the DEFAULT and the fix's exit criterion; only when the fix touches NO code the suite can execute — a Dockerfile, a CI workflow, an editor config, a surface the suite cannot reach — state `Verify-exception: <reason>` on this line instead — this is the fix-criteria line §4 step 2 hands the verifier, and that token is what it reads there in the test's place. An explicit, recorded override for a check that cannot exist, never a way past one that can: the §1 hypothesis override never earns it, since that path's test is what tells whether the hypothesis was true.
- **Zero-warnings commands** — discover them (package.json scripts, Makefile, CI config), record the exact lint/type/test/build/run commands, mark the rest N/A. When the fix touches front surface (the shared trigger at `${CLAUDE_SKILL_DIR}/../_shared/front-surface.md`), the pinned design detector joins them: resolve the pin by that file's recipe and record both numerals here; a pin that cannot be resolved at all is named here instead, never left as a placeholder.
- **Override** — the §1 hypothesis override, if any.

Save ONCE per ADR-0039: `mem_save(title: "oso/{bug}/diagnosis — {human description}", topic_key: "oso/{bug}/diagnosis", type: "architecture", capture_prompt: false, content: root cause + repro evidence + fix decision + named regression test + the two Impeccable numerals on a front-surface fix + override if any)`. `{bug}` is a short kebab slug; content and title in English. No oso/index row — the index tracks changes, not bugs.

**Reverse detour (ADR-0040).** If triage reveals the "bug" is a design flaw needing architecture or contract decisions, say why in one sentence and offer `oso-code:plan`; the operator decides. If they continue here, continue without further pushback; on acceptance the diagnosis travels as intent input to /plan.

## 4. Delegated fix — you never write it inline

Arm the state — the whole triple goes in every write because `oso-state` can set a key but never delete one: a stale green or a slice left armed by an abandoned flow is overwritten here, never inherited.
`"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" set mode=debug active_slice=fix verify_green=false`
Read it back with `"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" show` and confirm the three keys came back as written — a write that silently failed leaves the commit gate open with no other signal, so stop and tell the operator instead of delegating.
State survives until the session ends: if the operator walks away from this bug mid-flow, run `"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" clear`, or the stale green rides over whatever unrelated work follows in the session.

Then run the apply/verify loop (mechanics mirror plan §6's sequential path). Both launches run in the FOREGROUND: launch one subagent, wait, and read its report in the same turn before moving on. Since client v2.1.198 a subagent runs in the background unless the launch passes `run_in_background: false`, and a background result arrives in a LATER turn — so a backgrounded applier sends step 2 to verify a fix nobody wrote yet, and a backgrounded verifier lets the close's green (§5 step 4) land over a verdict nobody read.

1. **Apply (subagent)** — launch `oso-applier` with the diagnosis packaged as a ledger: root cause, repro evidence, fix decision, the named regression test, the project conventions, the zero-warnings commands, the rubric path `${CLAUDE_SKILL_DIR}/../_shared/rubric.md`, and the two coordinates its contract reads in either mode — the main checkout as the WORKTREE PATH, since this flow cuts none, and `HEAD` as the BASE REF, which is the pending working-tree diff this flow has always judged: nothing is committed while it runs (§5 step 5), so HEAD is the tree as it stood before the fix.
   - When the FIX touches front surface (per the shared trigger at `${CLAUDE_SKILL_DIR}/../_shared/front-surface.md`), the packaged ledger additionally carries the project's `DESIGN.md`/`PRODUCT.md` as conventions and the filesystem paths to the installed Impeccable skill's `SKILL.md` and its `reference/` playbook directory, which the applier READS as design reference. **Absence policy (ADR-0046):** if Impeccable is not installed, follow the absence policy in `${CLAUDE_SKILL_DIR}/../_shared/front-surface.md`; debug records the gap in the diagnosis notes.
2. **Verify (subagent)** — launch `oso-verifier` with the fix criteria, the zero-warnings commands the diagnosis froze (§3), the rubric path `${CLAUDE_SKILL_DIR}/../_shared/rubric.md`, the frozen diagnosis itself as fix-decision context — under that name and never "as ledger": this flow froze none, and the verifier reads the recorded fix decision as the narrower bar in a ledger's place — and step 1's two coordinates unchanged, the main checkout and `HEAD`, which is what makes the diff it judges `git -C <main checkout> diff HEAD`. It reruns those commands and reads that rubric itself, so a launch that withholds either answers `blocked` or judges against a bar it never saw. Its failing-check contract judges that the named regression test is new or extended by the fix diff and exercises its behavior; a `Verify-exception: <reason>` on the fix-criteria line (§3) is the only thing that stands in for it, and the verifier returns it as `exception-declared`. When the fix touched front surface, the fix criteria also include the pinned design detector on the touched surfaces, run at the numeral the diagnosis resolved and recorded (§3) — the design gate, under the detect-gate contract in `${CLAUDE_SKILL_DIR}/../_shared/front-surface.md`; a detector blocked by the environment, or a pin the diagnosis could not resolve, is named as skipped. The named regression test — or its recorded exception — stays the exit criterion and there is no Impeccable `audit` loop — detect is the design gate.
   - Verifier `fail` → relaunch the applier on the same diagnosis packaged as a ledger, carrying the verifier's findings. Loop apply → verify.
   - Applier `blocked` → resolve with the operator, update the diagnosis, launch a FRESH applier on the updated diagnosis packaged as a ledger.
   - Verifier `blocked` → resolve the blocker, relaunch the verifier only.
3. The verifier's `pass` closes the fix, not the flow: the state stays red until the close's green (§5 step 4), because the quality pass and any accepted security fixes still edit code.

## 5. Close

1. Close via the `oso-code:quality-pass` skill on the touched code; ONLY when the fix sprawled across many files, offer `oso-code:debt-sweep` as well — ADDITIVE to that pass, never instead of it, because step 4's green reads `Quality Pass: passed` and a branch that traded the pass for the sweep could never reach green at all. When the fix touched front surface, debug never runs Impeccable's `init` or `document` — a bug fix does not bootstrap a design system; if the project has no `DESIGN.md`/`PRODUCT.md`, the pinned detect (§4) still ran as the design gate and the missing-design-docs gap is named here in one clause.
   - On acceptance, INVOKE the `oso-code:debt-sweep` skill through the Skill tool — it runs in its own forked subagent — with no base ref in its ARGUMENTS, since debug tracks no branch model, which drops the sweep onto its own Scope rule, and with no ledger, since this flow never froze one. So it answers `Debt Sweep: clean` or `Debt Sweep: findings` over the debt axis alone, and `Conformance: skipped — no ledger provided` on the axis that had nothing to judge against. Here that skip is the CONTRACT, not a gap: /plan reads the same token as "the ledger never reached the ARGUMENTS" and invokes again, but debug has no ledger to have sent, so the token is the expected answer, never a re-invocation trigger, and the debt axis alone decides.
   - `Debt Sweep: findings` → the list goes to the `oso-applier` agent as a debt cleanup assignment: the smallest edit that FULLY resolves each finding — behavior-preserving; structural findings may span files. Then re-invoke `oso-code:debt-sweep` on the same arguments to confirm, and loop judge → fix until `Debt Sweep: clean`.
   - Then RE-RUN `oso-code:quality-pass` on the cleaned code: the applier's debt edits landed after the first pass, and that skill's own §3 holds here — the first run predates those edits, so only a run after them proves they hold. The `Quality Pass: passed` step 4 gates on is the one this re-run returns.
2. **Security offer (ADR-0045).** If the fix touched data models, auth, or payments, offer AND recommend a security review BEFORE any commit — the review reads the PENDING working-tree diff, and after commit there is nothing left to review. On acceptance, invoke the `oso-code:security-pass` skill through the Skill tool — it runs the review in its own forked subagent — with NO base ref in its ARGUMENTS, since debug tracks no branch model, and relay the returned markdown report to the operator verbatim; fixes the operator accepts go through the `oso-applier` agent as judge findings, never inline, then RE-RUN `oso-code:security-pass` until it returns `Security Pass: clean` or the operator explicitly accepts the residual findings. Never invoke without acceptance; declining proceeds.
3. Save a session summary to engram with a rich title (English).
4. **Green, last** — once the quality pass has returned `Quality Pass: passed` — the run AFTER any debt cleanup (step 1), never the one that predates it — and the debt sweep, if it ran, has returned `Debt Sweep: clean`, and any accepted security fixes have landed with the zero-warnings commands re-run: `"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" set mode=debug active_slice=none verify_green=true`. Nothing may edit code after this write: a path that has to — an accepted security fix in step 2, a late correction — re-reds the flag (`"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" set mode=debug active_slice=fix verify_green=false`), re-runs those commands, and only then repeats this step. Green is never left standing over an edit the bar has not seen.
5. This flow lands no commit of its own — a commit per slice is `/plan`'s, and debug has no slices (ADR-0093), which is what keeps §4's `HEAD` the tree as it stood before the fix. Never push or open a PR unless the user asks.

## Traps

| Trap | Reality |
| --- | --- |
| 'I already know what the bug is' | Reproduce first — cause assumptions fail roughly a third of the time. |
| 'the test must be wrong' | Verify the test's claim before dismissing it — a test you silence is a bug you ship. |
| 'it works on my machine' | Environments differ — reproduce where it breaks or say why you cannot. |
| 'flaky — rerun it' | Flakiness IS a bug masking another; a rerun that passes proves nothing. |
