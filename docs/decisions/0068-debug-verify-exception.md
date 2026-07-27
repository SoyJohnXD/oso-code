# 0068 — `/debug` gains a bounded `Verify-exception`

Date: 2026-07-25
Status: accepted
Reconciled: applied — Mode 3 §3 reads the named regression test or a `Verify-exception: <reason>` on that line.
Source: this change (harness-hardening pass); recorded with the change that made it

## Decision

The named regression test is the DEFAULT and the fix's exit criterion. Only where the fix touches NO code the suite can execute — a Dockerfile, a CI workflow, an editor config, a surface the suite cannot reach — the diagnosis states `Verify-exception: <reason>` on the named-regression-test line instead, and that line is the fix-criteria line §4 hands the verifier, which reads the token in the test's place and returns `exception-declared`. The §1 hypothesis override never earns the exception, since that path's test is what tells whether the hypothesis was true.

## Context

Carries ADR-0037's shape into `/debug`, which had a mandatory test and no escape for a fix the suite cannot reach — an explicit, recorded override for a check that cannot exist, never a way past one that can.
