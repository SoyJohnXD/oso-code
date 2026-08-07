# 0091 — The concurrency fact is recorded as a question, and answered at the first wave

Date: 2026-08-02
Status: accepted
Reconciled: applied — Mode 1 phase 6 reads the first wave as what answers it; the question itself sits in the skill's §3 Verification row, which the frozen body never enumerated.
Source: this change (parallel wave execution); recorded with the change that made it

## Decision

Whether this project's bar tolerates being run CONCURRENTLY is recorded in the ledger's §3 Verification row as a QUESTION, never an answer. §6 answers it at the FIRST wave, reading that wave's verifications, and writes the answer back into the same row. A bar that does not tolerate it changes exactly one thing: the VERIFICATIONS serialize, one verifier at a time in its own worktree, while the appliers still run in parallel and the wave still integrates once.

## Context

§3 is read-only and establishing the fact means running the bar N times at once — the same split ADR-0059's pin resolution takes, resolved at the first front-touching slice and written into that same row. What makes it worth recording at all is that a shared port, a single test database, a build cache or a lockfile is what turns two green slices red when their checks run side by side, and none of it shows in a diff. ADR-0080's cap is the lever over it; the appliers stay parallel because separate worktrees contend on nothing while files are being written.
