# 0133 — A session says once when its plugin is behind the published release

Date: 2026-08-07
Status: accepted
Supersedes: ADR-0075 (its single-command spelling of the plugin tier — the marketplace refresh now comes first, since the client installs from its own clone of the marketplace and an update alone reinstalls whatever that clone holds; the two tiers, the `./plugin` payload boundary and the **Reinstall required** marker stand unchanged)
Reconciled: applied — `plugin/hooks/warn-stale-version.sh` is the `version` gate in `tools/hook-gates.txt`, one of the ten that table now declares, wired on Claude only, and both manifests are rendered from it; nineteen cases in `tests/hooks-test.sh` drive the shipped hook from a plugin root of their own against a recording `curl` stub, and six mutations of the hook prove each of them red for the reason it names. It is also the sixth entry `plugin/hooks/hooks.json` registers, which leaves ADR-0127's body and 0.20.0's changelog entry naming five: both are records of their moment and stay as written. The live prose that counted the same hooks is count-free instead, in the two places `tests/hooks-test.sh` stated five; the one live count left standing beside the gates on purpose is the table's own ten, which `tools/render-hooks-json.sh` refuses to render past rather than merely asserting. `plugin/hooks/lib.sh`'s four-gate comment is the named residual: more than four gates hand a field on there, and more did before this change too, but that file's bytes are published in `bootstrap/hook-hashes.txt`, so even a comment edit moves a trust boundary a stale numeral does not justify moving. The count it should carry is left unstated rather than guessed, because the phrase does not say whether it counts the gates that read any field or only the ones whose `cwd` reaches the digest, and those are different sets.
Source: this change (clean-bar-convergence); an operator machine that ran 0.17.0 for five days while 0.19.0 was published and 0.20.0 was being prepared; ledger decision D7

## Decision

A `SessionStart` check compares the version of the plugin the session loaded against the newest release published for it and, when the install is behind, prints ONE line naming both versions and the commands that close the gap. Every other answer is silence.

### The facts it reads, and why those

**The installed version comes from the manifest beside the running hook**, not from the client's `installed_plugins.json`. That record holds an array per plugin and can hold several entries in one — the machine this was measured on carries five entries across those arrays, one of them a `version` field reading `unknown` — so which entry a session is running is a question it cannot answer, while the directory the hook was launched from already has. `$(dirname "$HOOK_DIR")/.claude-plugin/plugin.json` is the version of the code actually executing.

**The published version is the newest `vX.Y.Z` tag on the repository the manifest names**, read from the same ref advertisement `git ls-remote` reads (`<repo>.git/info/refs?service=git-upload-pack`) over `curl`. `curl` carries its own connect and transfer bounds, which is the reason `bootstrap/install.sh` already downloads with them rather than wrapping anything in GNU `timeout(1)` that macOS does not ship; `git ls-remote` would need that bound to come from somewhere else. GitHub advertises tags in name order, which puts `v0.5.0` after `v0.19.0`, so the highest is folded out by a fixed-width sort key rather than taken from the end of the list.

**The comparison only happens for an install whose marketplace is served from that same repository.** A machine that registered a local clone as a `directory` source — the shape a machine developing this plugin has — loads whatever that working tree holds and has no published release to be behind, so it never fetches and never speaks.

### The network call is not on the startup path

The answer is cached for a day in `$OSO_STATE_DIR/published-release`, and the ordinary session start reads that file and stops. Only a miss fetches, inside a 2-second connect and 4-second total bound; a fetch that answers nothing caches an empty answer on the same clock, so an offline machine pays one bounded attempt a day rather than one per session. The measured advertisement for this repository answered in under a third of a second, so four seconds is the wall a stalled connection hits rather than a budget a working one spends.

Fetching on every start was rejected: a captive portal or a black-holed route costs that wall on every session, and a startup hook that stalls is a hook an operator deletes. A detached background refresh was rejected too — it removes the fetch from the startup path completely, but a child the client's process group takes with it leaves a cache that never refreshes and a check that silently never speaks again, which is the one failure mode this decision exists to end.

### Claude only

`warn-stale-version.sh` compares an install against the marketplace that served it, and Codex has no marketplace: `bootstrap/install-codex.sh` copies a clone's files into a runtime directory, which the `claude plugin` commands this message names cannot reach. A Codex-wired handler would either never speak or tell an operator to update an install that came from somewhere else. It also stays out of the Codex trust boundary that way — the frozen thirteen-path set in `bootstrap/install-codex.sh` and `bootstrap/hook-hashes.txt` is unchanged, and `codex/hooks/hooks.json` renders byte for byte as before.

### The remedy is two commands, in that order

`claude plugin marketplace update oso-code && claude plugin update oso-code@oso-code`, the spellings `bootstrap/install.sh` runs and README documents. The refresh is what lets the update reach a new version at all: the client installs from its own clone of the marketplace, and on the machine that motivated this change that clone sat at 0.17.0 beside the 0.17.0 install while the remote had published 0.19.0 — so `plugin update` alone would have reinstalled what was already there.

## Context

Two releases in a row, the harness shipped improvements that never reached the projects of the person who wrote them. The install was five days behind, the marketplace clone was equally behind, and nothing on the machine said so: the client reports a version when asked and never volunteers one, and every artifact a session could read locally was a copy of the stale release.

Two alternatives were rejected before this one. A documented release ritual asks the memory that already failed twice; auto-updating hands the machine a surprise version jump mid-work and propagates a bad release instantly.

## Consequences

- The state directory gains one file that is not a `.state` file. Every sweep that walks `$OSO_STATE_DIR` is scoped to `*.state`, `worktrees/`, `plans/`, `.handoffs/` or `events.jsonl`, so the cache is invisible to all of them; deleting it costs one bounded fetch.
- A machine that merely installed the plugin now grows `$OSO_STATE_DIR` on its first session start, where before only an armed session created it. The gates' promise is unchanged — they still write no verdict and no event for an unarmed session — but the directory itself is no longer proof that oso-code was used here.
- The check is one day stale at worst, and silent for a day after a failed fetch. For a signal about a release published days ago that bound costs nothing it was buying.
- A published tag this numbering has not issued — a pre-release suffix, a fourth component — is not a release version here and passes unread. The comparison is `major.minor.patch` on both sides or it does not happen.
