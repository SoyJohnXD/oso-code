---
name: debug
description: Debugging and error-recovery mode for something that broke. Triages reproduce-first — reproduce, localize, reduce — then delegates the fix and a regression test through the apply/verify loop with a zero-warnings bar. Use when a bug, crash, or failing behavior needs diagnosis; also the landing point when a /plan or /quick ask turns out to be a bug.
argument-hint: [what broke]
disable-model-invocation: true
model: opus
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
- **Named regression test** — the test that FAILS without the fix and passes with it.
- **Zero-warnings commands** — discover them (package.json scripts, Makefile, CI config), record the exact lint/type/test/build/run commands, mark the rest N/A.
- **Override** — the §1 hypothesis override, if any.

Save ONCE per D5: `mem_save(title: "oso/{bug}/diagnosis — {human description}", topic_key: "oso/{bug}/diagnosis", type: "architecture", capture_prompt: false, content: root cause + repro evidence + fix decision + named regression test + override if any)`. `{bug}` is a short kebab slug; content and title in English. No oso/index row — the index tracks changes, not bugs.

**Reverse detour (D6).** If triage reveals the "bug" is a design flaw needing architecture or contract decisions, say why in one sentence and offer `oso-code:plan`; the operator decides. If they continue here, continue without further pushback; on acceptance the diagnosis travels as intent input to /plan.

## 4. Delegated fix — you never write it inline

Arm the state:
`"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" set mode=debug active_slice=fix verify_green=false`

Then run the apply/verify loop (mechanics mirror plan §6):

1. **Apply (subagent)** — launch `oso-applier` with the diagnosis packaged as a ledger: root cause, repro evidence, fix decision, the named regression test, the project conventions, the zero-warnings commands, and the rubric path `${CLAUDE_SKILL_DIR}/../_shared/rubric.md`.
2. **Verify (subagent)** — launch `oso-verifier` with the fix criteria; its failing-check contract judges that the named regression test is new or extended by the fix diff and exercises its behavior.
   - Verifier `fail` → relaunch the applier with the findings. Loop apply → verify.
   - Applier `blocked` → resolve with the operator, update the diagnosis, launch a FRESH applier.
   - Verifier `blocked` → resolve the blocker, relaunch the verifier only.
3. Only on the verifier's `pass`: `"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" set verify_green=true`.

## 5. Close

1. Close via the `oso-code:quality-pass` skill on the touched code; offer `oso-code:debt-sweep` instead ONLY when the fix sprawled across many files.
2. **Security offer (D4).** If the fix touched data models, auth, or payments, offer AND recommend a security review BEFORE any commit — the native review reads the PENDING working-tree diff, and after commit there is nothing left to review. On acceptance, invoke the `security-review` skill through the Skill tool when it appears in the session's skill listing; when absent, recommend the operator type `/security-review`. Never invoke without acceptance; declining proceeds.
3. Save a session summary to engram with a rich title (English).
4. Never commit, push, or open a PR unless the user asks.

## Traps

| Trap | Reality |
| --- | --- |
| 'I already know what the bug is' | Reproduce first — cause assumptions fail roughly a third of the time. |
| 'the test must be wrong' | Verify the test's claim before dismissing it — a test you silence is a bug you ship. |
| 'it works on my machine' | Environments differ — reproduce where it breaks or say why you cannot. |
| 'flaky — rerun it' | Flakiness IS a bug masking another; a rerun that passes proves nothing. |
