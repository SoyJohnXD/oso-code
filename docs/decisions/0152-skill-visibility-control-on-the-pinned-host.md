# 0152 — Skill visibility control on the pinned host

Date: 2026-08-18
Status: accepted
Supersedes: the pending `permission.skill` line in ADR-0151's Consequences — "S3 must empirically re-check skill visibility control; the parity ledger's `permission.skill` claim is downgraded to unverified until then" — and the parity ledger's S3 row of the same name. The empirical re-check happened, and the frozen claim survives it.
Reconciled: applied — slice S3 of the opencode-parity plan (`docs/opencode-parity-plan.md`) is what arms this ADR: it writes the operator-only wrappers with the `oso-*` naming this ADR settles, records the visibility evidence in `docs/parity-opencode.md`, and ships the installed-config deny rules through the S13 installer.
Source: slice S3 of the opencode-parity plan; a live probe fixture at `/tmp/opencode/s3-probe` (isolated `HOME`/`XDG_CONFIG_HOME`/`XDG_DATA_HOME`, skill installed at `config/opencode/skills/oso-s3probe/SKILL.md`, headless sessions via `opencode run -m opencode/deepseek-v4-flash-free` against the pinned 1.18.18 binary), plus the permissions and skills docs at opencode.ai

## Decision

**`permission.skill` exists on the pinned host, and a per-name deny rule hides the skill from the model while the operator's slash command stays. Operator-only modes are real on OpenCode: the installed config denies the skill tool for the three mode names, the model never sees them, and the TUI's `/oso-<name>` command still starts them.**

### Part 1 — the probe

The fixture mirrors the installed shape the plan demands: a skill named `oso-s3probe` installed under the config `skills/` directory, launched headlessly against the pinned binary with the operator's real config untouched. Two config states were probed:

- **`permission.skill: {"oso-s3probe": "deny"}`** — the model's `<available_skills>` contained ONLY the built-in `customize-opencode`; a `skill` tool call for `oso-s3probe` was rejected: `The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules [{"permission":"*","action":"allow","pattern":"*"},{"permission":"skill","pattern":"oso-s3probe","action":"deny"}]` (artifact `run-a-deny.json`, verbatim list `run-c-avail-skills.txt`).
- **`permission.skill: {"oso-s3probe": "allow"}`** — the skill appeared in `<available_skills>` and the `skill` tool call returned its content, ending `PROBEHIT` (artifact `run-b-allow.json`).

The docs at opencode.ai/docs/permissions/ confirm the spelling and state the deny effect: "Skill hidden from agent, access rejected". The binary's strings carry the same mechanics: the `skill` tool asks `t.ask({permission:"skill",patterns:[r.name],always:[r.name]})`, and the guidance loader filters skills through the permission set before offering them. Slash-command registration is separate from the model's visibility: commands are built from every skill with no permission filter, so `/oso-s3probe` stays available to the operator under deny.

### Part 2 — two more host facts the slice needed

- **Skill discovery directories.** The installed tree accepts BOTH spellings: `~/.config/opencode/skill/<name>/SKILL.md` (singular, the frozen plan's D11 spelling) and `~/.config/opencode/skills/<name>/SKILL.md` (plural, the docs' spelling). The loader globs `{skill,skills}/**/SKILL.md`. The installed layout may keep the D11 spelling.
- **Frontmatter recognition.** The docs' recognized fields are `name`, `description`, `license`, `compatibility`, and `metadata`; unknown fields are ignored. The wrappers keep `argument-hint` and `disable-model-invocation` as inert, uniform markers across the three hosts, and the operator-only enforcement lives in the installed config's deny rules — never in frontmatter.

### Part 3 — a headless limitation, recorded not hidden

`opencode run --command` cannot exercise the slash-command side of anything on this host: even the built-in `/compact` fails with an `UnknownError` in headless mode (captured 2026-08-18 in the isolated probe, artifact `run-d-command.log`; the original claim's capture was lost before the verifier ran and this capture replaces it). Slash-command behavior is TUI-verified only; the S14 smoke must not rely on `--command`.

## Consequences

- The parity ledger's "Skill visibility" row closes as **Verified** with this ADR's evidence; the slash-command-stays claim is TUI-side, supported by the command-registration strings but not headlessly exercisable.
- The S13 installer writes `permission.skill` deny rules for `oso-plan`, `oso-quick`, and `oso-debug` into the installed `opencode.json` (D6/D11); the wrappers' prose carries the precondition as the fallback before that config exists.
- Skill dir spelling is singular-or-plural; the installer may keep D11's `skill/` spelling.
- Verification of every later slice runs against 1.18.18; a version mismatch DEGRADES claims to `unverified:<version>` per D12.
