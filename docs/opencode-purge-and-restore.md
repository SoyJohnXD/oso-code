# OpenCode purge, restore and repair

The supported entry point is the generated Node CLI at `bootstrap/oso.js`.
It can remove a user-level OpenCode installation, restore the backup created by
that purge, and recover operator config keys recorded by an earlier OsoCode
install. None of these commands installs, uninstalls or logs in to OpenCode.

## What purge owns

`purge --host opencode` backs up and removes these user-level targets:

- `~/.config/opencode`
- `~/.local/share/opencode`
- `~/.cache/opencode`
- `~/.opencode/bin/opencode`
- `~/.gentle-ai` and `~/.local/bin/gentle-ai`, unless
  `--keep-gentle-ai` is present

It leaves repositories, Git configuration, `~/.claude`, `~/.agents` and
OsoCode's own state outside those targets untouched.

OpenCode project configuration belongs to each repository, not to the
user-level install. Before purge, declare exactly three absolute project config
paths so the command can prove they survive:

```bash
export OSO_OPENCODE_PROJECT_CONFIGS="
  /path/to/project-one/opencode.json
  /path/to/project-two/opencode.json
  /path/to/project-three/opencode.json"
```

Each file must exist and must be outside every purge target. Purge reports each
one as `INTACT` after removal and never reads or rewrites its contents.

## Review and run a purge

Close OpenCode and inspect the account and targets first. The state tree may
hold active workspaces, sessions and credentials.

```bash
printf 'HOME=%s\n' "$HOME"
node bootstrap/oso.js purge --host opencode --dry-run
```

The dry run performs path, project-config and backup-overlap checks without
backing up or removing anything. A customized `XDG_CONFIG_HOME`,
`XDG_STATE_HOME` or `XDG_CACHE_HOME` is refused unless it names the default
location below the selected `HOME`.

Run the reviewed operation explicitly:

```bash
node bootstrap/oso.js purge --host opencode --yes
```

The report prints an absolute `backup:` directory and a ready-to-run restore
command. The backup is private, carries a format marker and manifest, and is
verified before any source target is removed. A second purge over an already
absent installation succeeds without creating another backup.

To leave gentle-ai outside both the backup and the removal:

```bash
node bootstrap/oso.js purge --host opencode --yes --keep-gentle-ai
```

## Restore a purge backup

Stop OpenCode and ensure every recorded destination is absent. Restore never
merges into a newer tree and accepts only an absolute path to a verified purge
backup:

```bash
node bootstrap/oso.js purge --host opencode --restore \
  "$HOME/.local/state/oso-code/purge-backups/purge-YYYYMMDD-HHMMSS.XXXXXX"
```

`--restore` cannot be combined with `--yes`, `--dry-run` or
`--keep-gentle-ai`. A bad format, unsafe archive entry, failed digest or
occupied destination stops before writing. The backup remains in place after
a successful restore.

If a destination contains newer state, move it into a private rescue directory
before retrying instead of deleting it:

```bash
rescue="$(mktemp -d "$HOME/.local/state/oso-code/pre-restore.XXXXXX")"
chmod 700 "$rescue"
mv "$HOME/.config/opencode" "$rescue/config"
node bootstrap/oso.js purge --host opencode --restore "/absolute/path/from-the-backup-line"
```

## Install and verify again

After a purge, install the supported runtime and restart OpenCode:

```bash
node bootstrap/oso.js install --host opencode --yes
node bootstrap/oso.js verify --host opencode
```

The installer preserves unrelated `opencode.json` keys, owns only its marked
block in `AGENTS.md`, records its targets, and writes an install backup under
`~/.local/state/oso-code` before changing them.

## Repair operator config keys

Older OsoCode installers could drop unrelated keys from `opencode.json`.
`repair` lists install snapshots that contain a recorded config and can return
only keys that are missing from the live document:

```bash
node bootstrap/oso.js repair --host opencode --list
node bootstrap/oso.js repair --host opencode --yes
node bootstrap/oso.js repair --host opencode --yes install-backup-YYYYMMDD-HHMMSS-N
```

An existing key always keeps its current value. Repair refuses a non-object
container rather than overwriting it, and it does not perform a full install
rollback. Operator prose from an old `AGENTS.md` snapshot must be recovered
manually from that snapshot if needed.

## Verification scope

The Node CLI and its filesystem transactions run in the PR suite on Ubuntu and
Windows. Tests use isolated homes and fixture binaries; authenticated checks
against the real pinned OpenCode binary remain opt-in under `OSO_CERTIFY=1` and
are recorded in [the OpenCode parity record](parity-opencode.md).
