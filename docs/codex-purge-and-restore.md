# Codex purge and restore

`bootstrap/purge-codex.sh` is the one-time migration boundary for a Codex home
that predates oso-code. It backs up and removes the complete `~/.codex` and
`~/.agents` trees. It does not try to classify their contents: Codex login data,
gentle-ai artifacts, oso-code artifacts and unrelated personal files all belong
to the same backup.

This purge is optional and operator-run. It is not part of
`bootstrap/install-codex.sh`, never installs or uninstalls Codex, and never runs
`codex login`.

## Current migration status

For the workstation used to build this port, the operator already removed the
old Codex configuration, reinstalled Codex and completed login on 2026-08-03.
Do **not** run the purge there again. Finish the repository verification, then
run only the oso-code installer against that clean, authenticated Codex home.

## One-time migration on a home that still needs it

Close every Codex process first. Inspect the two targets and make sure `HOME`
names the account you intend to migrate:

```bash
printf 'HOME=%s\n' "$HOME"
ls -ld "$HOME/.codex" "$HOME/.agents" 2>/dev/null || true
bash bootstrap/purge-codex.sh
```

The no-flag run asks for confirmation and defaults to no. When you are ready to
perform the already-reviewed operation, either answer `yes` or use the explicit
non-interactive form:

```bash
bash bootstrap/purge-codex.sh --yes
```

Record the absolute path printed after `backup:`. The script creates that
directory with mode `0700`, archives both trees including empty directories,
symbolic links and permission modes, and publishes `manifest.sha256`. That
manifest covers the format, target and presence records as well as every archive;
the script verifies all of it before removing either source tree. An empty second
run succeeds without creating another backup.

The purge deliberately preserves everything outside those two paths, including
`~/.claude`, `~/.local/share/oso-code`, `~/.local/state/oso-code`, Codex binaries,
repositories and Git configuration.

Continue the migration in this order:

```bash
bash bootstrap/install-codex.sh --yes
codex login
```

The installer pins the supported Codex version and installs the oso-code
surfaces. Login is always an operator action. Afterward, review hook trust with
`/hooks`, restart Codex, and run the Codex verifier when Slice 13 supplies it.

## Restore a recorded backup

Stop Codex before restoring. Treat the backup path as sensitive: it can contain
authentication material and private configuration. Do not edit any file inside
it.

The restore command accepts only an absolute backup path:

```bash
bash bootstrap/purge-codex.sh --restore \
  "$HOME/.local/state/oso-code/purge-backups/purge-YYYYMMDD-HHMMSS.XXXXXX"
```

Restore fails closed unless the backup has mode `0700`, its format and target
records are valid, every published digest matches, both archives are safe, and
both original destinations are absent. It never merges into an existing
`.codex` or `.agents` tree.

If either destination exists, preserve that newer state before retrying. Moving
it into a private rescue directory is recoverable and avoids deleting it:

```bash
rescue="$(mktemp -d "$HOME/.local/state/oso-code/pre-restore.XXXXXX")"
chmod 700 "$rescue"
if [ -e "$HOME/.codex" ] || [ -L "$HOME/.codex" ]; then
  mv "$HOME/.codex" "$rescue/codex"
fi
if [ -e "$HOME/.agents" ] || [ -L "$HOME/.agents" ]; then
  mv "$HOME/.agents" "$rescue/agents"
fi
bash bootstrap/purge-codex.sh --restore "/absolute/path/from-the-backup-line"
```

On success the two restored trees match the recorded archives and the backup is
retained. Files outside those trees are outside the restore contract and remain
untouched. If restored credentials have expired, run `codex login` yourself.

## Failure handling

- A refusal or pre-delete backup failure leaves both source trees in place.
- A digest, archive or target-validation failure writes neither destination.
- A destination conflict leaves both the existing destinations and the backup
  untouched.
- Keep the backup until the restored or newly installed Codex setup has passed
  its complete verification.
