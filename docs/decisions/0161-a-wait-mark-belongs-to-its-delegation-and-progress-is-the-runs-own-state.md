# 0161 — A wait mark belongs to its delegation, and progress is the run's own state

Date: 2026-09-11
Status: accepted
Supersedes: ADR-0145 (its Part 3 clause "progress is journal BYTES rather than turns" and the second record the push tally kept for it — the journal's size no longer decides whether a push made progress, because the unattended contract obliges a run to journal every milestone and a run obeying it could never reach the cap; the cap itself is still three pushes, a held turn still spends none of it, and Part 3's fail-open direction is untouched and extended here as ADR-0150 extended it), ADR-0148 (its Part 3 clause "it reads the file's SIZE and nothing else" and the sentence that makes the journal the net's progress signal — the net still reads that size, but only to RENEW a standing wait mark, never to decide a push made progress; the journal itself, its per-change keying, the three counts against the event log and the format sensitivity that read creates all stand)
Reconciled: applied — `core/src/gates/delegation.ts` puts the label on the wait mark and stops restoring the mark's old timestamp when it is carried; `core/src/gates/autocontinue.ts` reads a mark armed for another label as no sighting of this delegation, holds the turn on the one it carries into a new run, and counts a push as progressless unless the run's own state file moved since the tally was written; `core/test/port/unattended-wait-mark.test.ts` and the `core/test/fixtures/gates/` streams beside it hold both halves, including a run journaling milestones alone still reaching the push cap
Source: this change (codex-desacople); a real unattended run whose net refused a delegation twenty-seven seconds old against a mark five hours old, and pushed a healthy run on every turn it was working

## Decision

**The continuation net declared live delegations lost and pushed a healthy unattended run forever.** Two faults, each making the other permanent, and each landing on one of the two records the net keeps on disk.

### The mark's clock belonged to the session, so it belonged to no delegation

The wait mark's clock is the sidecar file's own mtime, and the file was rewritten only when the mark was missing, when it was from another session, or when it had already expired. While the net was correctly HOLDING, nothing touched it — so the clock started at the session's first delegation and ran from there for every delegation after it. Crossing from one change to another made it worse deliberately: the mark was rewritten and its old timestamp then put back, so a new run inherited a clock that had already run out. Three renewals later the door shut for good and everything that followed was declared lost however recently it had started. Measured on a real run: a mark five hours old against the forty-five minute ceiling, refusing a delegation that had been alive for twenty-seven seconds.

The mark now carries the label it was armed for. A different label is a different delegation and gets its own mark, its own clock and its own three renewals, and carrying a mark into a new run rewrites it at the current time rather than restoring the old one — the carry is itself a hold, so the turn that adopts a mark is never also the turn that tests it for expiry.

This is ADR-0150's own contract kept rather than a new one. That decision already decided the sidecar carries the believed label AND the session that armed it, so that the clock starts when the net first sees a label from this run; what the port carried was the session alone, and a rule keyed on a label cannot hold while the label is not on disk.

### Progress was journal growth, which the unattended contract itself mandates

The net's cap exists to let a run that has genuinely stopped moving go. It counted a push as progressless unless the run journal had grown since the last one — and the unattended contract obliges a run to journal every milestone. So a run doing exactly as it was told reset the net's patience on every turn, and the cap could not be reached by the one run it was written for.

Progress is the run's own state changing now: the state file's modification time against the push tally's own. A push cannot manufacture that signal: the order it carries instructs a re-read of the position and a journal append, and the one state write it can lead to is the park that ends the run rather than continuing it. A run that is actually moving, meanwhile, arms slices, marks its verify green and takes its own wait down through `oso-state` as it goes. The tally file drops the journal-size record it kept for the old signal and holds the push count alone.

What did not change is the journal's other reader inside the same gate: a standing mark whose ceiling has passed is still RENEWED on journal growth, at most three times, exactly as ADR-0150 decided. The byte signal was never wrong about a delegation reporting milestones; it was wrong as the sole evidence that a PUSH had achieved something.

### What the two records hold on disk now

Both live in the run directory this repository keys by repository — the sidecar named for the session that armed the mark, the tally named for the change whose journal it sits beside — at owner-only mode, with the lifetime ADR-0148 gave them:

- the wait sidecar carries `run`, `session`, `label`, `journal_bytes` and `renewals` — five records where it carried four, the new one keying the whole belief window;
- the push tally carries `pushes` — one record where it carried two.

Neither reader rejects the other shape. A mark an earlier net wrote carries no label, so it matches no armed delegation and is read as a first sighting rather than a stale clock to inherit; a tally an earlier net wrote still yields its push count and is rewritten without the stale record at the next push. The net fails open on both, which is the direction ADR-0145 fixed and nothing here moves.

## Consequences

- The record is the point: this contract sits on disk, under a rail more than one host reaches. The `autocontinue` gate is one implementation in the core, reached by Claude through its `Stop` subprocess and by OpenCode natively through `runGate`, while Codex wires that gate on no event at all; the session-start stale gate, wired on all three, reads the same sidecar to tell an operator their run is still marked as waiting past the ceiling.
- A run in flight across the release pays one restarted clock and nothing worse: its label-less mark is re-sighted once, with renewals back at zero, on the first turn after the upgrade.
- The give-up sentence ADR-0150 made honest stays honest for a second reason. `cap reached after 3 pushes without progress` was false where the run was journaling milestones under a working delegation; it is now written only where the run's own state has not moved across three pushes, which is the claim the sentence makes.
- Two tests and one fixture asserted the old behaviour by name — one of them titled for never letting go of a run that is moving. They were the defect written down as intent, and they now assert what this repository's own reference says: a run journaling milestones alone still reaches the push cap, and a second delegation under one label restarts the belief window only where the run has moved since the sighting.
