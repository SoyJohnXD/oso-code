# OpenCode purge and restore

`bootstrap/purge-opencode.sh` is the migration boundary for a user-level
OpenCode install that predates oso-code. It backs up and removes the complete
`~/.config/opencode`, `~/.local/share/opencode` (the sessions database
included), `~/.cache/opencode` and the installed binary at
`~/.opencode/bin/opencode`. It also removes the gentle-ai homes `~/.gentle-ai`
and `~/.local/bin/gentle-ai` unless `--keep-gentle-ai` says otherwise. It does
not try to classify the contents: OpenCode login data, session state,
gentle-ai artifacts, oso-code artifacts and unrelated personal files all belong
to the same backup.

This purge is optional and operator-run. It is not part of
`bootstrap/install-opencode.sh`, never installs or uninstalls OpenCode through
npm or bun, and never runs any login command.

## The three project-level opencode.json files

OpenCode reads per-project configuration from an `opencode.json` at the project
root — a repo-owned file, never part of the user-level install. The purge must
prove those files survive, so it requires them by name:

```bash
export OSO_OPENCODE_PROJECT_CONFIGS="
  /path/to/project-one/opencode.json
  /path/to/project-two/opencode.json
  /path/to/project-three/opencode.json"
```

Exactly three absolute paths, space-separated. The purge verifies that all
three exist before it backs anything up, wipes nothing until that holds, and
after the wipe reports each one as `INTACT` (existence is verified, content is
never read or compared). A project config that names a path inside a purge
target is refused. These files are outside the wipe boundary by construction:
the purge never writes them, and the restore contract never touches them.

## One-time migration on a home that still needs it

Close every OpenCode process and every open session first. The state directory
under `~/.local/share/opencode` also holds worktree working areas created by
the workspaces API, so an active session can own files the purge will remove.
Inspect the targets and make sure `HOME` names the account you intend to
migrate:

```bash
printf 'HOME=%s\n' "$HOME"
ls -ld "$HOME/.config/opencode" "$HOME/.local/share/opencode" \
  "$HOME/.cache/opencode" "$HOME/.opencode/bin/opencode" 2>/dev/null || true
bash bootstrap/purge-opencode.sh
```

The no-flag run asks for confirmation and defaults to no. When you are ready to
perform the already-reviewed operation, either answer `yes` or use the explicit
non-interactive form:

```bash
bash bootstrap/purge-opencode.sh --yes
```

A dry run performs every safety check — target paths, backup-overlap refusal,
the three project-level files — and prints the plan without touching anything:

```bash
bash bootstrap/purge-opencode.sh --dry-run
```

Record the absolute path printed after `backup:`. The script creates that
directory with mode `0700`, archives every target including empty directories,
symbolic links and permission modes, and publishes `manifest.sha256`. That
manifest covers the format, target and presence records as well as every
archive; the script verifies all of it before removing any source tree. An
empty second run succeeds without creating another backup.

The purge deliberately preserves everything outside its targets, including
`~/.claude`, `~/.codex`, `~/.agents`, `~/.local/share/oso-code`,
`~/.local/state/oso-code`, the three project-level `opencode.json` files,
repositories and Git configuration.

Continue the migration in this order:

```bash
bash bootstrap/install-opencode.sh --yes
```

The installer pins the supported OpenCode version in
`SUPPORTED_OPENCODE_VERSION` (1.18.22; the baseline that pin descends from is
`docs/decisions/0151-opencode-baseline-and-f7-verdict.md`, which took it at
1.18.18; install at https://opencode.ai/install). It writes only the keys it needs into
`~/.config/opencode/opencode.json` and leaves every other key that file holds
exactly as it found it — `theme`, `keybinds`, `provider`, `model`, your own
`permission` entries and your own `mcp` servers all survive an install byte for
byte. The keys it does write are the four operator-only modes under
`permission.skill`, `permission.task."*"`, `question`, `plan_enter`,
`plan_exit`, `oso_plan_approve`, `oso_plan_cancel`, the three oso-code MCP
servers, and `plugin` as an array. Every key it preserved is recorded in the
owner registry at `~/.local/state/oso-code/opencode-install-registry` under
`operator`. The purge and the installer share the same path vocabulary: the
purge backs up the whole user-level tree, the installer rebuilds it.
Afterward, restart OpenCode and run `bash bootstrap/verify-opencode.sh`.

The installer refuses to run when `XDG_CONFIG_HOME` names a directory that is
not `$HOME/.config`. OpenCode reads its user config from
`$XDG_CONFIG_HOME/opencode`, so setting `HOME` alone does not point an install
at a different account: the refusal is what keeps a run aimed at a scratch home
from writing into the config home the variable still names. Point both at the
same account, or unset the variable.

## What an install migrates, and how to undo it

Two on-disk shapes changed with this release, and the installer converts them
inside the same transaction that backs everything else up. Both live under
`~/.local/state/oso-code`, keyed by the sha256 of a repository's common git
directory — the same digest that names `<digest>.state` and `plans/<digest>/`.

| What | Before | After | Which files it touches |
|---|---|---|---|
| The session identity a state file records | `session=ses…`, the OpenCode session id this host published before the rename | `session=<the first 16 characters of the state file's own digest>`, the value the plugin now publishes as `OSO_AGENT` | A `<digest>.state` whose `session` matches `^ses[A-Za-z0-9]+$`; `plan_approval_session` is rewritten with it. Claude's UUID sessions and Codex's `session=1` are left alone |
| Where a plan approval lives | The presence of `plans/<digest>/approved-<plan digest>.md` | `plan_approval=approved` plus `plan_approval_digest`, `plan_approval_session`, `plan_snapshot_file`, `plan_current_file` and `plan_revision=0` in `<digest>.state` | A `<digest>.state` that carries no `plan_approval` key at all while its plan directory holds an approved document. `mode` and every other key are left alone |

Both are idempotent: a state file already in the new shape is skipped, so
re-running the installer never churns it. Every state file either one touches
is copied into that run's backup first, so `restore-opencode.sh` below is the
migration's inverse.

## Restore an install

`bootstrap/restore-opencode.sh` replays one of `install-opencode.sh`'s own
snapshots — the whole install, the migrated state files included:

```bash
bash bootstrap/restore-opencode.sh --list
bash bootstrap/restore-opencode.sh              # the newest, with a prompt
bash bootstrap/restore-opencode.sh --yes install-backup-20260822-175648-2913137
```

Every target comes from that backup's own manifest, so a snapshot written by an
older installer still restores. `install-codex.sh` writes its snapshots into the
same directory; those are refused here by name, and `restore-codex.sh` is what
replays them. The one thing a restore cannot revert is `core.hooksPath`: that
value is only ever held in memory for the run that captured it, so re-run the
installer or set it by hand if the git commit-hook wiring also needs to change.

## Repair operator keys an earlier release dropped

Releases before this one rebuilt `opencode.json` from a template and carried
only five operator keys across, so an install of one of those dropped every
other key the file held. The installer preserves them now, but nothing returns
the ones already lost, and a full restore would also undo the install.
`bootstrap/repair-opencode.sh` puts back exactly the keys the live config no
longer holds, reading them from a recorded install snapshot:

```bash
bash bootstrap/repair-opencode.sh --list
bash bootstrap/repair-opencode.sh
```

It prints every key it is about to return and its value, then asks. A key still
present keeps its current value whoever wrote it, so the repair can never
overwrite a newer choice, and it reads snapshots older than this release too —
which is the point, since those are the ones holding the lost keys.

Those releases replaced `~/.config/opencode/AGENTS.md` wholesale in the same
way, so prose that file held before such an install is gone from it too. This
release merges that file instead — the installer owns only the block between
`<!-- oso-code:start -->` and `<!-- oso-code:end -->` — so no further install
loses any of it. `repair-opencode.sh` stays a config-key repair: the whole
pre-install file sits in the snapshot as `items/global`, one plain Markdown
file, so copy that back by hand when only the prose is wanted, or replay the
snapshot with `restore-opencode.sh` when the whole install should go back.

## Restore a purge backup

Stop OpenCode before restoring. Treat the backup path as sensitive: it can
contain authentication material and private configuration. Do not edit any
file inside it.

This is the purge's own restore, not the installer's: it replays a `purge-*`
backup of the whole user-level OpenCode tree, where `restore-opencode.sh`
above replays one install. The command accepts only an absolute backup path:

```bash
bash bootstrap/purge-opencode.sh --restore \
  "$HOME/.local/state/oso-code/purge-backups/purge-YYYYMMDD-HHMMSS.XXXXXX"
```

Restore fails closed unless the backup has mode `0700`, its format and target
records are valid, every published digest matches, every archive is safe, and
every recorded destination is absent. It never merges into an existing tree. A
backup taken with `--keep-gentle-ai` restores without the gentle-ai records,
because restore derives its scope from the backup itself.

If a destination exists, preserve that newer state before retrying. Moving it
into a private rescue directory is recoverable and avoids deleting it:

```bash
rescue="$(mktemp -d "$HOME/.local/state/oso-code/pre-restore.XXXXXX")"
chmod 700 "$rescue"
if [ -e "$HOME/.config/opencode" ] || [ -L "$HOME/.config/opencode" ]; then
  mv "$HOME/.config/opencode" "$rescue/config"
fi
bash bootstrap/purge-opencode.sh --restore "/absolute/path/from-the-backup-line"
```

On success the restored trees match the recorded archives and the backup is
retained. Files outside those trees — the three project-level `opencode.json`
included — are outside the restore contract and remain untouched. If restored
credentials have expired, log in yourself.

## Failure handling

- A refusal or pre-delete backup failure leaves every source tree in place.
- A digest, archive or target-validation failure writes no destination.
- A destination conflict leaves both the existing destinations and the backup
  untouched.
- Keep the backup until the restored or newly installed OpenCode setup has
  passed its complete verification.

## Platform coverage

Linux and macOS are the verified platforms for every script on this page.

**Windows is UNVERIFIED, not unsupported.** `install-opencode.sh`,
`verify-opencode.sh`, `restore-opencode.sh`, `repair-opencode.sh` and
`purge-opencode.sh` are bash scripts, and Git Bash is the only runtime on
Windows that could host them, but no run of any of them has been observed on
that platform — there is no Windows bootstrapper for this host the way
`install.bat` is one for Claude Code, and CI runs the OpenCode job on ubuntu
only. Nothing here is declared not-applicable: the claim is simply absent, and
it stays absent until somebody runs them there and records what happened.
