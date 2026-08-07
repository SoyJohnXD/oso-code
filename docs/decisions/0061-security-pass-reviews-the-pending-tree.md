# 0061 — `security-pass` reviews the pending working tree

Date: 2026-07-25
Status: accepted
Supersedes: ADR-0045 (its description of the fallback review, which named no acquisition and no verdict line)
Reconciled: applied — Mode 1 §7 reads the pending working-tree surface.
Source: docs/blueprint.md amendment of 2026-07-25 (c-mechanisms), decision (c), deciding commit 7d52356

## Decision

On its fallback path — the native path leaves acquisition to the native skill — `security-pass` reviews `git diff HEAD` plus the full CONTENTS of every untracked file (`git ls-files --others --exclude-standard`, then READ each), since a brand-new auth file is the commonest shape of an auth change and no form of the diff can see it. Never `git add -N` or any other write to the index, because a judge does not mutate the repository it judges, and a base-ref range ONLY when one arrived in its arguments. No remote named `origin` is ever assumed: a diff against a ref that resolves nowhere dies with `fatal: ambiguous argument` (rc 128) at the one gate that must not improvise, and `/quick` and `/debug` track no branch model and pass no base ref, so for them the two mandatory sources ARE the whole review surface. The verdict is its own line after the body — `Security Pass: clean` or `Security Pass: findings` — and never collapses into the `Security Pass: native` / `Security Pass: fallback` header, which names only the path that ran.

## Context

One of six 0.14.0 mechanisms whose documentation ran ahead of its behavior; each is written here to what it does.
