# Security pass — OpenCode

## Which reviewer is native, and how to reach it

There is no native review CLI on this host: OpenCode ships no `review` command, and this port has not probed for one. So the neutral body's hybrid fallback IS the route, run HERE inside the dedicated `oso-security-reviewer` agent that read this file. Never ask the orchestrator to run it, never delegate it to another agent, and never substitute anything else for the fallback while the neutral body's Fallback criteria apply.

The role that runs the acquisition has unrestricted host access so it can reach the network and read the repository state the fallback needs. That broader access does not authorize the judge to edit: it acquires, reads and judges, and never edits.

- When ARGUMENTS is exactly `none`, cover staged, unstaged, and untracked changes (the host's default diff surface covers them). The exact report header is `Security Pass: fallback — covered: staged, unstaged, and untracked changes`.
- When ARGUMENTS carries the one base ref allowed by the wrapper, first validate it as exactly one locally resolvable base ref; an invalid, unresolved, or multi-argument value is blocked, never guessed. Never discover a remote or default branch and never replace the handed ref through remote inference. Cover committed changes from the merge base through HEAD plus staged and unstaged tracked changes, and enumerate `git ls-files --others --exclude-standard` and read every returned file before judging, so untracked files are not omitted. The exact report header is `Security Pass: fallback — covered: merge base of HEAD and <base-ref> through HEAD, plus staged, unstaged, and untracked changes`, with the actual validated ref substituted verbatim.

Do not acquire a diff in this parent context: the agent performs the acquisition. Relay the fallback's findings beneath the exact header for that surface, then emit the neutral body's separate terminal verdict. If the acquisition fails, cannot authenticate, cannot reach its service, or exits unsuccessfully, report the failure as blocked; do not silently downgrade to a different path and call it clean.
