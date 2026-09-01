# Front surface — Codex

This file binds the platform-shaped edges of `../../front-surface.md`; it does not restate that file's trigger, pin recipe, audit exit bar or absence policy.

- The mode labels are the bare `plan`, `quick` and `debug` skills.
- The stable Impeccable skill is `~/.agents/skills/impeccable/SKILL.md`, materialized inside its user-wide root as a real, symlink-free copy by the installer and never used through its source plugin-cache path. When a shell or payload needs the expanded spelling, use the absolute `$HOME/.agents/skills/impeccable/SKILL.md`.
- Invoke the mounted skill as `$impeccable <argument>`: `$impeccable init`, `$impeccable document` and `$impeccable audit <touched surfaces>` are the three routes. The words are explicit arguments to the one skill, never standalone skill names or Claude slash commands.
- For a harness-owned invocation, read the mounted `SKILL.md` completely, pass the exact ARGUMENT `init`, `document` or `audit <touched surfaces>`, then load and follow the command's mounted reference. Do not approximate an argument from memory or treat reading only `reference/` as loading the skill.
- The filesystem payload to an applier uses that absolute `SKILL.md` plus its `reference/` directory, also expanded below `$HOME/.agents/skills/impeccable/`. The applier reads those files; it does not invoke the skill and is never handed the source cache path.
- Record the independent installed-skill numeral from the `version:` field in the mounted `SKILL.md`; the npm CLI numeral still comes from the neutral pin recipe. Never inspect the source cache merely to obtain the mounted version.
- Route design findings to the `oso-applier` subagent in fresh context through the Codex launch, wait and handoff protocol in `subagents.md`.
- When Impeccable is absent, ask the operator to rerun `node bootstrap/oso.js install --host codex`. That install does not mount Impeccable itself, so continue without the design bar and record the gap where the invoking mode requires; never repeat Claude's `/plugin` commands and never use a discovered cache path as a temporary mount.
