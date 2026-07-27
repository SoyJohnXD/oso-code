# 0053 — The commit matcher becomes a lexer

Date: 2026-07-25
Status: accepted
Reconciled: elsewhere — landed in plugin/hooks/lexer.sh; the lexer, its bounds and its telemetry are code detail the frozen body has never carried.
Source: docs/blueprint.md amendment of 2026-07-25 (gates-hardening), joint marker (D2/D3/D4/D18/D19/D20), deciding commit 7d52356

## Decision

The matcher becomes a lexer in `plugin/hooks/lexer.sh` — sourced by `lib.sh`, which keeps the payload reading, state, verdicts and telemetry every gate shares — that distinguishes CODE from TEXT: quote, escape and subshell state; heredoc excision with the shell-interpreter asymmetry; comment stripping; herestrings read as payloads; command-position enumeration; arity-agnostic prefix stripping (`env X=1 sudo -n timeout 60 git commit` runs git); a basename match on the command word, so `/usr/bin/git` and `git.exe` count; and an interpreter payload resolved by position — the first non-option word after `-c`, never the line's last argument.

Gated verbs are `commit` plus `commit-tree`, `update-ref`, `filter-branch`, `replace` and `fast-import`; every other history-writing verb is pinned to an explicit ALLOW, because for five of the seven allowed (`revert`, `merge`, `rebase`, `cherry-pick`, `am` — never `stash` or `push`, which answer `unknown option`) the bare verb and its `--abort`/`--continue` recovery form are the same token, and denying `--continue` deadlocks a session that cannot run verify mid-conflict. There is no `ask` rung — a subagent cannot answer a prompt and a headless run has no operator — so the undecidable residue ALLOWS and emits `residue-allowed`, which makes the rate measurable.

Input and decoder bounds sit at 3072 bytes: past them nothing is lexed or decoded and the line becomes residue, which is what turns an unbounded cost into a measured one. The worst shapes this lexer has run take 126-140 ms at that bound and over 400 ms at 8 KiB without it, where what a session really sends runs in 14-25 ms — at a coverage cost stated plainly: the commit rail stops applying to a Bash line whose command field exceeds 3072 escaped bytes.

## Context

Filed under one marker covering six numbers, and the entry never separates them: one lexer, its verb table, its residue rung and its bounds, in one continuous block with no clause tagged to a number. `tests/hooks-test.sh` attributes the input bound to D19 and the decoder bound to D20 inside this group; the entry itself attributes nothing, so no split here would be derived rather than invented.
