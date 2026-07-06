---
name: quick
description: Fast iteration mode for small, easily verifiable changes. Runs a one-exchange micro-intent, iterates with visible results, and closes with a quality pass. Use for visual tweaks, small fixes, and adjustments that fit in a handful of files.
argument-hint: [what to change]
disable-model-invocation: true
---

# Quick mode

Fast, guided iteration for small changes. The human steers; you keep the bar high.

## 1. Micro-intent (one exchange, not a plan)

Restate in one or two sentences:

- **Goal** — what changes.
- **Visible success** — how the user will see it worked: a screen state, a command output, a passing test.

If either is unclear, ask exactly one question. Otherwise state both as assumptions and start.

## 2. Substantiality check

Before touching code, recommend `/oso-code:plan` instead when any of these hold:

- The change needs architecture or contract decisions the user has not made.
- New business logic spans 3+ files, or touches data models, auth, or payments.
- Success cannot be verified visually or with a fast command.

Say why in one sentence and let the user decide. If they choose to continue here, continue without further pushback.

## 3. Iterate

Before the first edit, initialize the runtime state — the commit gate stays locked until the quality pass:
`oso-state --session "${CLAUDE_CODE_SESSION_ID}" set mode=quick verify_green=false`

- Work in small increments that each produce a visible result (run the app, run the affected test, show output).
- When a decision surfaces that the user has not made — a library, a contract, a UX behavior — present options with tradeoffs and let them choose. Never assume.
- Stay inside the stated goal. New wants from the user are welcome; silent scope growth is not.

## 4. Close — when the user says it's done

1. Invoke the `oso-code:quality-pass` skill on the touched code.
2. Zero warnings: lint, types, and affected tests must be clean before declaring done.
3. When the quality pass reports passed, unlock the commit gate:
   `oso-state --session "${CLAUDE_CODE_SESSION_ID}" set verify_green=true`
4. Save to engram only: a session summary with a rich title (descriptive, with domain keywords, so it surfaces on first search), plus any non-obvious discovery or convention learned. Do not save iterations or progress.

Never commit, push, or open a PR unless the user asks.
