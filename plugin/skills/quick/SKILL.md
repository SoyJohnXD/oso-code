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

## 3. Iterate

Before the first edit, initialize the runtime state — the commit gate stays locked until the quality pass:
`"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" set mode=quick verify_green=false`

- Work in small increments that each produce a visible result (run the app, run the affected test, show output).
- When a decision surfaces that the user has not made — a library, a contract, a UX behavior — present options with tradeoffs and let them choose. Never assume. When a decision hinges on an external library's current API, version, or migration path, check context7 before presenting options; state whether each recommendation is current standard practice.
- Stay inside the stated goal. New wants from the user are welcome; silent scope growth is not.

## 4. Close — when the user says it's done

1. Invoke the `oso-code:quality-pass` skill on the touched code.
2. Zero warnings: the project's own checks — discovered from the project — must be clean before declaring done.
3. When the quality pass reports passed, unlock the commit gate:
   `"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" set verify_green=true`
4. Save to engram only: a session summary with a rich title (descriptive, with domain keywords, so it surfaces on first search), plus any non-obvious discovery or convention learned. Cite any related topic keys literally (`oso/{change}/plan`) — never dash wiki-links like `[[oso-x-plan]]`. Do not save iterations or progress. Engram content and titles are written in English; Oso narrates them in Spanish when the operator asks.

Never commit, push, or open a PR unless the user asks.
