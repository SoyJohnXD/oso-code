# Quality pass — OpenCode

## Shared-file paths

Wherever the neutral body names a file as `_shared/<file>.md`, it is spelled `../_shared/<file>.md` here, resolved against the directory holding the `SKILL.md` you were routed through — the resolution rule OpenCode states for every relative path a skill writes (the `skill` tool returns content with "Relative paths in this skill are relative to this base directory"). Expand it to an absolute path before putting it in a payload another context reads.
