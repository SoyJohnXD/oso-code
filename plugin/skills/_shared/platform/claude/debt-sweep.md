# Debt sweep — Claude Code

## Shared-file paths

Wherever the neutral body names a file as `_shared/<file>.md`, it is spelled `${CLAUDE_SKILL_DIR}/../_shared/<file>.md` here. That interpolation resolves to an absolute path, which is what a payload handed to another context needs.

## Reaching the fallow tools

`ToolSearch` is this host's route to deferred tools: §1 step 2's fallow tools are not in the fork's default listing, so load them with `ToolSearch` before calling them. A call attempted without loading them is not evidence of unavailability — it is the dodge the trap table names.
