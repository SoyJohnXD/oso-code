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
const CONSUME_PROOF_LINE =
  "       oso-state handoff consume --slice <id> --attempt <n> --agent-id <id> --agent-path <canonical> --agent-type <type>\n";
const RESOLVE_CODEX_LINE = "       oso-state handoff resolve-codex --agent-path <canonical> --slice <id> --attempt <n> --agent-type <role>\n";
const ADOPT_LINE =
  "       oso-state handoff adopt --agent-id <id> --agent-path <canonical> --slice <id> --attempt <n> --agent-type <type>\n";
const SCAN_LINES =
  "       oso-state scan comments <ref>\n" + "       oso-state scan abstractions <ref>\n";
const NATIVE_CLAIM_PARAGRAPH =
  " adopt proves an asserted agent id against its\n" +
  "own native rollout without requiring the current session to be its parent;\n" +
  "consume now demands that same proof before it destroys a receipt.\n";
const SCAN_PARAGRAPH =
  "\nscan reads the working directory's own repository, reports every hit on stdout\n" +
  "and exits 0 whether or not it found any. comments flags the inline comments the\n" +
  "diff since <ref> adds; abstractions flags the exports it adds that fewer than\n" +
  "two use sites reach.\n";

const TS_USAGE = BASH_USAGE.replace(
  "       oso-state --session <id> clear\n",
  `       oso-state --session <id> clear\n${CLOSE_SLICE_LINE}`,
)
  .replace(
    "       oso-state --session <id> amend-plan <slice-id>\n",
    `       oso-state --session <id> amend-plan <slice-id>\n${DENY_PATTERN_LINE}`,
  )
  .replace(
    "       oso-state handoff consume --slice <id> --attempt <n> --agent-id <id> --agent-type <type>\n",
    `${CONSUME_PROOF_LINE}${RESOLVE_CODEX_LINE}${ADOPT_LINE}${SCAN_LINES}`,
  )
  .replace(
    "be between 0 and 600 seconds.\n",
    `be between 0 and 600 seconds.${NATIVE_CLAIM_PARAGRAPH}${SCAN_PARAGRAPH}`,
  );

test(
  "the TypeScript CLI's usage text equals the bash's (read from 8c54fd8:plugin/bin/oso-state:7-29) " +
    "plus close-slice, deny-pattern add, scan, native Codex handoff resolution and its adopt/consume proof",
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
