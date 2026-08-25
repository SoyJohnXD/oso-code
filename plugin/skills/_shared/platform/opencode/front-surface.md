# Front surface — OpenCode

This file binds the platform-shaped edges of `../../front-surface.md`; it does not restate that file's trigger, pin recipe, audit exit bar or absence policy.

- The mode labels are the installed `oso-plan`, `oso-quick` and `oso-debug` skills.
- The stable Impeccable skill is `~/.agents/skills/impeccable/SKILL.md`, materialized inside its user-wide root as a real, symlink-free copy by the installer and never used through its source plugin-cache path. When a shell or payload needs the expanded spelling, use the absolute `$HOME/.agents/skills/impeccable/SKILL.md`.
- Invoke the mounted skill through this host's `skill` tool with name `impeccable` and the argument in the tool's own field: `init`, `document` and `audit <touched surfaces>` are the three routes. The words are explicit arguments to the one skill, never standalone skill names or slash commands.
- For a harness-owned invocation, read the mounted `SKILL.md` completely, pass the exact ARGUMENT `init`, `document` or `audit <touched surfaces>`, then load and follow the skill's mounted reference. Do not approximate an argument from memory or treat reading only `reference/` as loading the skill.
- The filesystem payload to an applier uses that absolute `SKILL.md` plus its `reference/` directory, also expanded below `$HOME/.agents/skills/impeccable/`. The applier reads those files; it does not invoke the skill and is never handed the source cache path.
- Record the independent installed-skill numeral from the `version:` field in the mounted `SKILL.md`; the npm CLI numeral still comes from the neutral pin recipe. Never inspect the source cache merely to obtain the mounted version.
- Route design findings to the `oso-applier` agent in fresh context through the synchronous `task` tool: the call blocks until the child turn completes and the verdict is in-band, so the findings are consumed on the way back, not awaited later.
- When Impeccable is absent, ask the operator to rerun `bootstrap/install-opencode.sh`, which installs and remounts it. Continue without the design bar and record the gap where the invoking mode requires; never use a discovered cache path as a temporary mount.
