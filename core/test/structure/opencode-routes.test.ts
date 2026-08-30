import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { openCodeRoutes, type OpenCodeRoute } from "../../src/routes/render.ts";
import { provedSomething } from "../support/proved.ts";

const UNKNOWN_TOOL_ALLOWLIST: readonly string[] = [
  "bash",
  "apply_patch",
  "task",
  "list_mcp_resources",
  "list_mcp_resource_templates",
  "read_mcp_resource",
  "engram_mem_search",
  "engram_mem_get_observation",
  "engram_mem_save",
  "engram_mem_update",
  "engram_mem_context",
  "engram_mem_session_summary",
  "engram_mem_current_project",
  "engram_mem_save_prompt",
  "engram_mem_judge",
  "context7_resolve-library-id",
  "context7_query-docs",
  "fallow_find_dupes",
  "fallow_get_cleanup_candidates",
  "fallow_audit",
  "fallow_fix_apply",
  "edit",
  "write",
  "read",
  "grep",
  "glob",
  "skill",
  "todowrite",
  "webfetch",
  "websearch",
  "question",
  "lsp",
  "plan_exit",
  "oso_plan_approve",
  "oso_plan_cancel",
  "oso_wave",
];

const ROUTES_THE_BASH_RENDERER_LAST_EMITTED: readonly OpenCodeRoute[] = [
  { hook: "tool.execute.before", gate: "commit", matcher: "bash", allow: [] },
  { hook: "tool.execute.before", gate: "edits", matcher: "edit|write|fallow_fix_apply|apply_patch", allow: [] },
  { hook: "tool.execute.before", gate: "unknown", matcher: ".*", allow: UNKNOWN_TOOL_ALLOWLIST },
  { hook: "experimental.chat.system.transform", gate: "stale", matcher: "", allow: [] },
  { hook: "dispose", gate: "teardown", matcher: "", allow: [] },
  { hook: "tool.execute.before", gate: "proddeploy", matcher: "bash|.*deploy.*", allow: [] },
  { hook: "event", gate: "reanchor", matcher: "", allow: [] },
];

provedSomething(
  `${ROUTES_THE_BASH_RENDERER_LAST_EMITTED.length} pinned OpenCode routes are compared here`,
  ROUTES_THE_BASH_RENDERER_LAST_EMITTED.length > 0,
  "the pinned table is empty, so this check compared nothing",
);

describe(
  "core/src/routes/render.ts: openCodeRoutes() is what the OpenCode adapter runs, pinned against the table " +
    "tools/render-hooks-json.sh emitted into the deleted opencode/hooks/routes.ts at a11804a",
  () => {
    test("the derived rows equal that table, hook, gate, matcher and allowlist alike", () => {
      assert.deepEqual(
        openCodeRoutes().map((route) => ({ ...route, allow: [...route.allow] })),
        ROUTES_THE_BASH_RENDERER_LAST_EMITTED.map((route) => ({ ...route, allow: [...route.allow] })),
      );
    });

    test("the unknown-tool route carries the allowlist and every other route carries none", () => {
      for (const route of openCodeRoutes()) {
        assert.equal(route.allow.length > 0, route.gate === "unknown", `${route.gate} carries the wrong allowlist`);
      }
    });
  },
);
