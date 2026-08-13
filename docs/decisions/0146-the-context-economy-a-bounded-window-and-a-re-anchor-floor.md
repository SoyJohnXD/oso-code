# 0146 — The context economy: a bounded window the harness cannot guarantee, and a re-anchor as the floor

Date: 2026-08-13
Status: accepted
Supersedes: ADR-0138 (its Part 3 clause "a compaction costs it nothing" — the POSITION half of that claim was right and is unchanged; what was unpriced is the WINDOW, and the floor under an unattended run is now the host's re-anchor rather than a client setting nobody can promise)
Reconciled: elsewhere — it landed in a hook, a platform file and the roadmap body, and the frozen body never carried a context claim of its own. `plugin/hooks/reanchor-after-compact.sh` is the `SessionStart` handler, wired in `plugin/hooks/hooks.json` alone and recorded in `tools/hook-gates.txt` as Claude-wired with no Codex counterpart. `plugin/skills/_shared/platform/claude/plan.md` names it among the three hooks the marker arms and states the `autoCompactWindow` fact behind it; `plugin/skills/_shared/bodies/roadmap.md`'s chain phase states the honest form of the survivability claim — window and not position, best-effort, the re-anchor as the floor, and the three things the re-anchor reads — and `bodies/plan.md`'s AUTO ground rule states the same for a plain run. `tests/plugin-lint.sh`'s `check_unattended_run_carves_out_the_delivery_contract` flags the retired absolute by its own words if it returns to the roadmap body and holds the three clauses that replaced it.
Source: this change (auto-continuity), decision D8; ADR-0138's own durability claim read back against a run long enough to be compacted, where the position survived and the instructions holding the run together did not

## Decision

**A compaction costs an unattended run its WINDOW and never its POSITION, and the floor under that claim is a re-anchor the harness owns — not a window size it can only ask for.**

### Part 1 — the window is best-effort, and saying so is the decision

How much context a client holds before it compacts is the `autoCompactWindow` setting: something the harness can ask an operator for and can never guarantee, on a machine it does not own, in a client whose defaults move without it. Any survivability argument resting on that number is an argument resting on somebody else's configuration.

One fact closes the alternative that would otherwise be obvious. **The model cannot invoke a compaction.** Compaction is the client's — its own threshold, or the operator's `/compact` — so the harness cannot choose to compact at a boundary where re-anchoring is cheap, such as between two slices with nothing in flight. It can only react to one that already happened. That is why the mechanism is a re-anchor AFTER and not a compaction the flow schedules, and the fact is recorded here because without it the rejected design looks better than it is.

### Part 2 — the re-anchor reads exactly what was written down

`reanchor-after-compact.sh` runs on `SessionStart` and does nothing unless `source` is `compact`. Where it fires, it hands the fresh context the three places a run's position actually lives, in the order a reader needs them:

- **The change position** — `mem_search` for `oso/index`, then `mem_get_observation` on the row it returns, read down to its `NEXT:` line.
- **The run flags** — `oso-state show`, for `mode`, `active_slice`, `verify_green` and `auto`.
- **The milestones already landed** — the run journal (ADR-0148), named by path, and named only where one resolves.

It also restates the one instruction a compacted context is most likely to have lost: every milestone from here on is still appended with `oso-state journal`. An unattended run gets one sentence more — continue now rather than waiting, and park per the rules of its own flow if a decision needs the operator — because a fresh context under a marker is exactly where a run mistakes a compaction for a stopping point.

It arms for TWO conditions and not one: an unattended run (`auto=running`), or a plan slice still armed (`mode=plan` with an `active_slice` that is neither empty nor `none`). An attended run loses the same window to the same compaction, and the operator sitting there is not what re-reads the position — so restricting the re-anchor to the marker would have withheld it from the case where somebody is present to be misled by a confident, empty context.

Every gate on the way in fails silent: no `compact` source, no session id, an unreadable cwd, no readable state file, or a state file naming ANOTHER session, and the hook exits 0 with no output. A `SessionStart` handler that spoke on a start it could not identify would put a run's position in front of a session that is not running it.

### Part 3 — four handlers on one event, disjoint by construction

This host now wires four `SessionStart` handlers, and each pair is disjoint for its own stated reason rather than by luck:

- `warn-stale-version.sh` is SILENT on `source=compact` — the one source this handler requires — so the version notice is not repeated into a re-anchored context and the two never both speak.
- `warn-stale-state.sh` fires only for a state file naming a DIFFERENT session; this one fires only for a state file naming THIS one. They are complementary halves of the same read.
- `persist-state-bin.sh` writes an environment key and reads no state at all.

That partition is a property to keep, not an accident to leave undocumented: a fifth handler added without it produces two voices on one start, and the operator has no way to tell which one is about their run.

## Context

ADR-0138 Part 3 said the chain "runs IN-SESSION and needs no relaunch while the session lives; a compaction costs it nothing, because everything it knows is written down." The second half is true and still stands — the ledger topic, the `oso/index` row and the runtime key were all durable then and are durable now. What the sentence did not price is that a run is not only its position. It is also the instructions holding it together: which milestone shape it owes, that the journal is appended per milestone, that it is unattended at all. Those live in the WINDOW, and a compaction takes the window whether or not the position survives.

The gap only became load-bearing with this change. Under ADR-0138 the chain's next arming re-read everything it needed from the queue; a plain plan running under AUTO has no chain to re-arm it, so the fresh context after a compaction is the run itself, working from whatever it can find.

Two alternatives were rejected.

**Pinning `autoCompactWindow` from the installer** was rejected because it buys a claim rather than a property. The setting is the operator's, on their machine, in a client whose behavior around it is not this harness's to promise; an installer that wrote it would let every downstream text say "a compaction will not happen here", which is exactly the shape of claim this repo's parity discipline refuses. Asking for it stays available and is worth nothing as a floor.

**Compacting deliberately at a slice boundary** was rejected on the fact in Part 1: the model has no way to invoke one. The design that would have been better is unreachable, and recording why is what keeps it from being re-proposed as an improvement.

## Consequences

- The survivability claim is now shaped like the mechanism behind it. A body that says "best-effort window, re-anchor floor" can be checked against a hook that exists; the retired sentence could only be checked against a setting nobody in this repo writes.
- The re-anchor serves attended runs too, which makes it a context-recovery hook rather than an unattended one. That is deliberate and it is also what keeps its arming condition readable: it fires when there is a position worth re-reading, and an armed slice is one whether or not somebody is watching it.
- `SessionStart` is now the busiest event this plugin wires, and its handlers stay disjoint only as long as each new one states which half of the space it takes. That constraint is written into this decision because no lint rule reads it.
- Codex has no counterpart. A compaction there costs the same window and nothing re-anchors after it, which `docs/parity-codex.md` records with the Stop net rather than leaving to inference.
- ADR-0138's runtime key stays exactly what it was: a key no gate reads, best-effort by design. Nothing here wires a gate to it, and the marker this change added is a separate key with separate readers — which is what keeps that decision's own property from being traded away by proximity.
