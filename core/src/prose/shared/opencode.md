# Shared layer — OpenCode

Host binding for the shared concerns that bind no single wrapper: `../front-surface.md`'s wiring and `../reporting.md`'s delivery.

## Front-surface binding

- The mode labels are the installed `oso-plan`, `oso-quick` and `oso-debug` skills.
- The stable Impeccable skill is `~/.agents/skills/impeccable/SKILL.md`, materialized inside its user-wide root as a real, symlink-free copy by the installer and never used through its source plugin-cache path. When a shell or payload needs the expanded spelling, use the absolute `$HOME/.agents/skills/impeccable/SKILL.md`.
- Invoke the mounted skill through this host's `skill` tool with name `impeccable` and the argument in the tool's own field: `init`, `document` and `audit <touched surfaces>` are the three routes. The words are explicit arguments to the one skill, never standalone skill names or slash commands.
- For a harness-owned invocation, read the mounted `SKILL.md` completely, pass the exact ARGUMENT `init`, `document` or `audit <touched surfaces>`, then load and follow the skill's mounted reference. Do not approximate an argument from memory or treat reading only `reference/` as loading the skill.
- The filesystem payload to an applier uses that absolute `SKILL.md` plus its `reference/` directory, also expanded below `$HOME/.agents/skills/impeccable/`. The applier reads those files; it does not invoke the skill and is never handed the source cache path.
- Record the independent installed-skill numeral from the `version:` field in the mounted `SKILL.md`. Never inspect the source cache merely to obtain the mounted version.
- Route design findings to the `oso-applier` agent in fresh context through the synchronous `task` tool: the call blocks until the child turn completes and the verdict is in-band, so the findings are consumed on the way back, not awaited later.
- When Impeccable is absent, ask the operator to rerun `node bootstrap/oso.js install --host opencode`. That install does not mount Impeccable itself; never use a discovered cache path as a temporary mount.

## Native agent files, no card

Spawning a role runs one of this host's own native agent files — the seven subagent contracts under `opencode/agents/`, each `mode: subagent` and `hidden: true` — through the synchronous `task` tool, and that launch renders no card: the operator sees only a spinner and its description while the child runs, and when it returns, the milestone text itself is the only record of what happened — no report panel, no handoff receipt, no verdict surface is ever drawn. The contract at `../reporting.md` is therefore this host's WHOLE visibility layer, not a complement to a native affordance, and it is delivered exactly as every other operator-facing content on this host.

## The unattended run — no carve-out here, and the record that carries it instead

An UNATTENDED RUN is this repository's runtime state carrying `auto=running` for this session: the marker the AUTO disposition arms (`plan/SKILL.md`'s ground rules) and the ROADMAP chain arms per child (`roadmap/SKILL.md` §4). Claude Code carves milestone text out of its delivery contract while that marker stands, because ending the turn at every milestone stops a run nobody is there to continue. **This host takes no such carve-out**, and it costs the run nothing, because the continuation rail posts the next turn itself: the installed plugin answers `session.idle` with a real user turn back into the same session, where Claude Code has only a `Stop` decision to refuse one with. What stops a milestone stopping the run there is a carve-out; what stops it here is a rail, so the safer delivery is the one this host keeps.

The record is the same on both hosts and is not optional here either. Every milestone `../reporting.md` fires is ALSO appended full-text with `oso-state journal "<the milestone exactly as it was written>"` — one journal per change, named by the `auto_change` value the marker was armed with — and that file is what the operator reads on their return and what a compaction cannot take. It is also what the rail's own bounds are measured against: a posted turn that moved the journal nowhere counts against the turn bound, and journal growth is what resets it, so a run that reports its milestones is a run the rail keeps carrying.

The PARK and the FINAL REPORT of the run THE OPERATOR ARMED — a plain-AUTO change's own close (`plan/SKILL.md` §7), or a chain's own report over the whole queue it ran (`roadmap/SKILL.md` §5) — are the run handing itself back, and each is SEQUENCED with the disarm (`auto=done`) as the tool call BEFORE the report's text. A roadmap CHILD's own close is neither of the two, however final it reads inside that child: the chain arms the next child in the same turn, and the rail carries that turn end like every milestone before it.
