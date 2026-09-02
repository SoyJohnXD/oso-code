OpenCode's `task` delegation carries no working-directory parameter, so explicitly scope every shell command and every edit to the slice's handed path.

Reach context7 through the MCP tools under their server-prefixed names present in this session — `context7_resolve-library-id` and `context7_query-docs`.

The commit gate on this host is a plugin hook — a throw inside `tool.execute.before` — never your own permission config. Your bash permission stays open, so the gate and only the gate decides when `git commit` lands.

Verdict vocabulary — `status: done | blocked`, exactly as shaped above. Your final message is the task result: this host's `task` delegation is synchronous and returns your final message in-band to the orchestrator that launched you, so the verdict above is what the orchestrator parses — it is data, never prose.
