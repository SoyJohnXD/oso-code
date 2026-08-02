# Security pass — Codex

## Which reviewer is native, and how to reach it

This host ships no security-review skill, so there is nothing in your listing to take the native path to: run the hybrid fallback, and the header you open with is `Security Pass: fallback` every time. That is the neutral body's own rule for an absent native reviewer, not a decision taken here.

Codex does ship a `codex review` command, which is a different shape — a separate CLI run, not a skill this fork can invoke — and whether it becomes this host's native path is not settled by this change. Until a later slice settles it, do not shell out to it: a reviewer that runs outside this fork is the one thing the neutral body forbids on either path.
