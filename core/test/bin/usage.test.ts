import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const cliSource = path.join(repoRoot, "core", "src", "bin", "oso-state.ts");

const BASH_USAGE = `usage: oso-state --session <id> set key=value [key=value ...]
       oso-state --session <id> get key
       oso-state --session <id> show
       oso-state --session <id> clear
       oso-state --session <id> event <type> [detail]
       oso-state --session <id> capture-plan <sha256>
       oso-state --session <id> approve-plan <sha256>
       oso-state --session <id> cancel-plan <sha256>
       oso-state --session <id> amend-plan <slice-id>
       oso-state journal <text>
       oso-state journal --path
       oso-state handoff publish --slice <id> --attempt <n> --agent-id <id> --agent-type <type> --hook-session <id>
       oso-state handoff wait --slice <id> --attempt <n> --agent-id <id> --agent-type <type> --timeout <seconds>
       oso-state handoff consume --slice <id> --attempt <n> --agent-id <id> --agent-type <type>

The SubagentStop hook publishes a provenance receipt, never a verdict. wait is
bounded and consume is one-shot. Handoff attempts start at 1 and timeout must
be between 0 and 600 seconds.
`;

const CLOSE_SLICE_LINE = "       oso-state --session <id> close-slice <n>\n";
const DENY_PATTERN_LINE = "       oso-state --session <id> deny-pattern add <pattern>\n";

const TS_USAGE = BASH_USAGE.replace(
  "       oso-state --session <id> clear\n",
  `       oso-state --session <id> clear\n${CLOSE_SLICE_LINE}`,
).replace(
  "       oso-state --session <id> amend-plan <slice-id>\n",
  `       oso-state --session <id> amend-plan <slice-id>\n${DENY_PATTERN_LINE}`,
);

test(
  "the TypeScript CLI's usage text equals the bash's (read from 8c54fd8:plugin/bin/oso-state:7-29) " +
    "plus exactly the two verbs G6 adds, close-slice and deny-pattern add",
  () => {
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", cliSource],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stderr, TS_USAGE);
    assert.equal(result.stdout, "");
  },
);
