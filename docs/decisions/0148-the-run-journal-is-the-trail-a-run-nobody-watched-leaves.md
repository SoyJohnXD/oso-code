# 0148 — The run journal: the trail a run nobody watched leaves behind

Date: 2026-08-13
Status: accepted
Reconciled: elsewhere — it landed in the state binary, the hooks library, the flow bodies and the Claude platform binding, and the frozen body never carried a record of this kind. `plugin/bin/oso-state` gained the `journal` verb; `plugin/hooks/lib.sh` gained `journal_file_for`, which resolves the path both the verb and the hooks read. `plugin/skills/_shared/platform/claude/reporting.md`'s unattended-run section names the journal as what replaces the interrupted stream, `plugin/skills/_shared/reporting.md` names it as what every host taking the carve-out writes, and `plugin/skills/_shared/bodies/plan.md`'s AUTO ground rule and `bodies/roadmap.md` §4 each require the append per milestone with `auto_change` naming the file. `plugin/hooks/auto-continue.sh` reads its size as the run's only progress signal and journals its own give-up; `plugin/hooks/reanchor-after-compact.sh` names its path among the three places a compacted context re-reads the position. `bootstrap/hook-hashes.txt` moved with the state binary and the library.
Source: this change (auto-continuity), decisions D4 and D6; the carve-out in ADR-0145, which trades a milestone's visibility for a run that keeps moving and is only payable if something else holds the account

## Decision

**Every milestone an unattended run reports is appended FULL-TEXT to a per-change journal, and that file — not the stream — is the record.** The stream was never the record; what changed is that the harness stopped behaving as though it were.

### Part 1 — one file per change, in the state root, keyed the way state already is

`oso-state journal "<the milestone exactly as it was written>"` appends one line — a UTC timestamp and the text — to `$OSO_STATE_DIR/runs/<repository>/<change>.log`. The repository component is the same SHA-256 digest the state file already keys on (ADR-0095), so the main checkout and every linked worktree of a parallel wave reach ONE journal. The change component is the `auto_change` value the marker was armed with, validated by the reader (ADR-0145) and falling back to a fixed name where it is not a usable slug.

Per CHANGE rather than per SESSION, and that is the load-bearing half. A parked run expects resumption in a later session, a compacted context is the same run under the same change, and the operator coming back wants the run's trail and not one session's slice of it. A per-session journal would have split the one thing this file exists to be whole.

It is written with `umask 077` under a `mkdir -p`, as private as the state files beside it, because a milestone carries whatever the run carries. A failed append is an ERROR naming the path it could not write — never the stderr fallback the event log takes — because the whole decision rests on this file existing, and a journal that silently did not write is the failure being defended against wearing the appearance of the fix.

### Part 2 — why not the event log, which was already there

`events.jsonl` was the obvious home and it is wrong on three independent counts, any one of which is disqualifying:

- **It truncates.** A command field is cut to 120 bytes. A milestone is up to three lines of prose, and the head of one is not a record of it.
- **It ages out.** The log rotates on a 30-day mtime. A decision ledger and a PR outlive that; a run's account should not be the one artifact of a change that quietly expires.
- **It is one file for the whole machine**, with a size budget the suite pins, carrying every gate event of every repository. Per-milestone full text is the highest-volume thing anyone could put in it, added to the file least able to hold it.

The journal takes the opposite trade on each: no truncation, no rotation, one file per change per repository.

### Part 3 — two readers, and one of them is mechanical

The operator is the reader this file exists for: it is what they open on their return, what a compaction cannot take, and what the final report at §7 REFERENCES rather than reprints. `reanchor-after-compact.sh` names its path among the three places a fresh context re-reads the position (ADR-0146).

The second reader is `auto-continue.sh`, and it reads the file's SIZE and nothing else. A journal that grew between two `Stop` pushes is a run that did something; one that did not is a run being restarted into the same place. That is what the net's cap counts, and it is why the journal is the progress signal rather than a turn counter — a turn is evidence that the model spoke, and journal bytes are evidence that the run reported a milestone.

The verb takes no session and needs none. It writes no state file, arms no gate, and is called from a `Stop` hook that has a session id it has no reason to spell — so `journal` is dispatched beside `handoff`, before the `--session` requirement, while the flow's own `--session`-prefixed spelling keeps working unchanged.

## Context

ADR-0145 buys a run that keeps moving by letting its milestones ride a stream this TUI may swallow. That trade is only payable if the account survives somewhere else, so the journal is not a feature beside the carve-out — it is the half that makes the carve-out affordable, and neither would have been taken alone.

The alternative of keeping milestone text ONLY in the session transcript was rejected on the same fact the carve-out rests on. A transcript is the client's, it is compacted on the client's threshold, and text that never rendered was never in it. A record the harness cannot read back is not a record the harness can promise.

## Consequences

- An unattended run leaves a durable, human-readable trail whose granularity is the milestone contract's, not the transcript's. That trail is what a park hands back, what a resume reads, and what the final report points at instead of restating.
- Nothing ages the journals out. `cleanup-state.sh` sweeps state files, worktrees, orphaned pending artifacts and the event log, and deliberately touches `runs/` at none of them — a run's account outliving its session is the point, and the cost is that the directory grows one file per change per repository forever. Disposal is the operator's, exactly as a standing worktree's is (ADR-0138).
- The push tally the `Stop` net keeps lives beside the journal it measures, under the same directory and the same private mode. Two files, one location, one lifetime — which is what keeps a cap from being reset by a cleanup that only knew about one of them.
- The journal is now a hook input, so its FORMAT is load-bearing in one narrow way: the net compares byte counts, and any future change that rewrote lines in place rather than appending would make a growing record look like a stalled one.
