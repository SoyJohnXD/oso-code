# Debt sweep — OpenCode

## Shared-file paths

Wherever the neutral body names a file as `_shared/<file>.md`, it is spelled `../_shared/<file>.md` here, resolved against the directory holding the `SKILL.md` you were routed through — the resolution rule OpenCode states for every relative path a skill writes (the `skill` tool returns content with "Relative paths in this skill are relative to this base directory"). Expand it to an absolute path before putting it in a payload another context reads.

## Reaching the fallow tools

This host has no deferred-tool search: every configured MCP tool is already in your listing, under its server-prefixed name. So §1 step 2 is a direct call — read the listing for fallow's tools and run them. Their ABSENCE from the listing is the evidence the trap table asks for: it means fallow's server is not configured for this session, and the sweep says so and continues rubric-only.
