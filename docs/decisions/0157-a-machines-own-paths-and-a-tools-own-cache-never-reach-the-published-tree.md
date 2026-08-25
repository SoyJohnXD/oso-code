# 0157 — A machine's own paths and a tool's own cache never reach the published tree

Date: 2026-08-23
Status: accepted
Reconciled: applied — `tests/plugin-lint.sh` gains `check_no_shipped_file_carries_the_home_path_of_whoever_runs_this` and `check_every_dot_directory_is_repo_owned_or_ignored`, `.gitignore` declares `.claude/` beside `.atl/` and `node_modules/`, and `tests/hooks-test.sh` carries a mutation per rule plus the control that a declared ignore closes the second one
Source: this change (opencode-runtime-parity), slice 23; `.atl/`, an external tool's cache committed at `1ebb29a` into a repository that is public, carrying 25 absolute paths under the operator's home directory, the private skill inventory those paths enumerate, and a named third-party client

## Decision

**No file under this repository carries the absolute home directory of whoever runs the check, and no dot-directory stands beside the repository's own without being either declared as this repo's or declared in `.gitignore`.**

The `.atl/` cache was untracked and ignored before this slice and its history is gone, so the instance is closed. Nothing guarded the CLASS: a repo-wide scan for `.atl` across `tests/ tools/ plugin/ bootstrap/ .github/ opencode/ docs/` returned zero hits outside `.gitignore` itself. The next cache will have a different name, so neither rule names `.atl` at all.

### Why the home path, and why the runner's own

The leak was not "a path" — it was THIS machine's path, which names its owner, their layout and, through the inventory it indexed, what else they had installed. A rule cannot know the operator's username in a clean-room checkout, and it does not need to: the machine that would leak its own home directory is the machine running the check. The rule looks for `$HOME` verbatim, so it is silent about the generic example paths already standing in the tree — `/home/a/b`, `/home/o/…`, `C:/Users/dev/…`, `/c/Users/x` — which belong to nobody, and loud about the one path that belongs to someone. It refuses to run at all rather than pass quietly when `HOME` is empty or `/`.

Its exclusions come from `.gitignore` itself: every directory line there is excluded from the scan, plus `.git`. That is what keeps an ignored cache from being reported as a tracked leak, and it is why the two rules compose — a new cache is either ignored, and therefore out of the scan and out of the index, or declared, and therefore scanned.

### Why the dot-directory, and why an allowlist

`.git`, `.github`, `.claude-plugin`, `.codex-plugin` and `.agents` are this repository's own and are named. Anything else that appears at the root must be a line in `.gitignore` before the linter goes green, which forces the one decision that was never made for `.atl/`: is this ours, or is it something a tool leaves behind? The check needs no `git` — deliberately, since `tests/plugin-lint.sh` runs inside the `bash:3.2` container CI uses, which carries neither `git` nor `jq` — so "would this be tracked" is answered by "is it declared", which is decidable from two files.

`.claude/` was the first thing the new rule found: ignored on this machine only, through a personal global ignore file that no clean-room checkout and no CI runner has. It is declared in `.gitignore` now.

## Consequences

- The first rule's reach is the repository tree minus its ignored directories, and its locator is a literal string, so a home path that reaches a file in some SPLIT form — assembled from two variables, or written with `~` — is out of its sight. It catches the shape that actually leaked and does not claim more.
- The second rule reads the repository ROOT only. A cache written into a subdirectory is out of its reach; the caches this class produces land at the root, which is where `.atl/` landed.
- Both are mutation-proven in `tests/hooks-test.sh`: a file carrying the runner's own `$HOME` turns the tree red by name, an undeclared `.some-tool-cache/` turns it red by name, and adding that directory to a fixture's `.gitignore` closes the finding without an allowlist entry — which is the route an operator will actually take.
