# 0160 — A resumed session adopts its receipt, and consume proves the same claim wait never had to

Date: 2026-09-11
Status: accepted
Reconciled: applied — `core/src/state/handoff.ts`'s `runHandoffAdopt` and the `confirmCodexDelegation` proof it shares with `runHandoffConsume`; `core/src/state/cli.ts` wires `handoff adopt --agent-id <id> --agent-path <canonical> --slice <id> --attempt <n> --agent-type <type>` and adds `--agent-path` to `consume`; `core/test/state/codex-handoff.test.ts` and `core/test/port/codex-consume-native-proof.test.ts` hold both
Source: this change (codex-desacople); an operator's own parked plan whose delegation had already finished, resumed from a session `resolve-codex` could never authorize because a resumed chat is a different thread

## Decision

### `resolve-codex`'s one requirement a resumed session cannot meet

`resolve-codex` binds a receipt to the caller's own current `CODEX_THREAD_ID` — the parent that spawned the child. A resumed chat is issued a new thread id, so a parked plan whose delegated child had already finished and published its receipt could never be resolved from the resumed session: the child's verdict sat on screen, complete and unusable, with no event, no route and no test covering the gap. `handoff adopt --agent-id <uuid> --agent-path <canonical> --slice <id> --attempt <n> --agent-type <role>` is the second path this decision adds: it takes the UUID a resume already retained from its own checkpoint and proves it rather than searching for it. The proof, `confirmCodexDelegation`, requires the asserted agent's sole matching native rollout to live in THIS repository, to carry this exact agent path and this exact agent role, and to have a live, unconsumed receipt for this slice and attempt — and to have a parent, any parent at all. That last clause is deliberate: the one requirement `resolve-codex` cannot satisfy for a resumed caller is an exact match to the CURRENT session's own thread id, so adopt drops only that one check and keeps every other identity proof `resolve-codex` already made real. An ambiguous match — more than one rollout answering the same agent id — refuses with the count rather than choosing one.

### Closing what handing out the UUID would otherwise have opened

`wait` and `consume` read no session identity at all before this decision: a caller holding nothing but the UUID could consume a receipt it had no part in, and a probe against the pre-decision build confirmed exactly that — a receipt was consumed whose native rollout named an entirely unrelated agent. A verb this decision now teaches a legitimate resumed caller to obtain the UUID from cannot ship beside a door that does not lock: `consume` now takes the same `--agent-path` and runs the same `confirmCodexDelegation` proof `adopt` does, before it reads or deletes anything. `wait` stays exactly as it was — it only reads, it returns nothing the caller did not already supply to match against, and closing it would break a parallel wave's own readiness barrier, which is a materially different risk than deleting another agent's result out from under it.

### The rail stops being silent about itself, here too

Nothing in this file logged anything before this decision. `adopt` and `consume` now record the claims they refuse — `handoff-adopt-failed` and `handoff-consume-claim-failed`, each carrying the failing detail — which is what was missing when an operator was left with a finished delegation, an unresolvable session, and no diagnosis of why.

## Consequences

- A plan resumed after a compaction or a fresh chat can claim a delegation's already-finished receipt through `adopt`, where it previously had no route back to it at all.
- `consume` now refuses a caller that cannot prove the same identity `adopt` proves, closing the gap a bare UUID used to leave open; `wait` is unchanged, because closing it costs a parallel wave's readiness barrier for a risk it does not carry.
- Three parity fixtures whose argv could no longer reach the check their own names promised are retired, and the coverage they claimed now runs against the shipped bundles (`plugin/bin/oso-state`, `plugin/dist/gate.js`) rather than only against the TypeScript source.
