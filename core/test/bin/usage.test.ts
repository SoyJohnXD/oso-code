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
`;

const CLOSE_LINE = "       oso-state --session <id> close\n";
const CLOSE_SLICE_LINE = "       oso-state --session <id> close-slice <n>\n";
const DENY_PATTERN_LINE = "       oso-state --session <id> deny-pattern add <pattern>\n";
const WATCH_LINE = "       oso-state --session <id> watch\n";
const WATCH_PARAGRAPH =
  "\nwatch polls this session's in-flight delegations and exits 0 once none is left,\n" +
  "or 3 naming each one silent for 60 minutes, in flight for 3 hours or ended\n" +
  "without notice; each is named once across watches.\n";
const SCAN_LINES =
  "       oso-state scan comments <ref>\n" + "       oso-state scan abstractions <ref>\n";
const REPORT_LINE = "       oso-state report [--json]\n";
const MARK_LINE =
  "       oso-state --session <id> mark <diagnosed|escalated|empty-result> [slice]\n" +
  "       oso-state --session <id> wave start <wave> <slice>=<low|high> [<slice>=<low|high> ...]\n" +
  "       oso-state --session <id> launch-token <wave> <token> <slice> [<slice> ...]\n";
const REPORT_PARAGRAPH =
  "\nreport reads this repository's verdict records and prints the armed slice with\n" +
  "its rounds since its arming and since its newest diagnosis, the first-fail\n" +
  "rate, rounds per slice, escalated slices, verdicts by model, malformed reports\n" +
  "and unreceipted greens; --json prints the same fields as one JSON object.\n";
const MARK_PARAGRAPH =
  "\nmark records a diagnosis, an escalation or an empty applier result against the\n" +
  "armed slice, and is refused when no slice is armed; inside a started wave it\n" +
  "takes the id of one of the wave's slices instead.\n" +
  "\nwave start records a wave's slices with their risk and arms each of them, so its\n" +
  "rounds are counted per slice. launch-token registers the slices one verifier\n" +
  "launch covers and is refused for an id outside the wave, a batch of more than 3\n" +
  "slices or a batch holding a high-risk slice.\n";
const SCAN_PARAGRAPH =
  "\nscan reads the working directory's own repository, reports every hit on stdout\n" +
  "and exits 0 whether or not it found any. comments flags the inline comments the\n" +
  "diff since <ref> adds; abstractions flags the exports it adds that fewer than\n" +
  "two use sites reach.\n";

const TS_USAGE = BASH_USAGE.replace(
  "       oso-state --session <id> clear\n",
  `       oso-state --session <id> clear\n${CLOSE_LINE}${CLOSE_SLICE_LINE}`,
)
  .replace(
    "       oso-state --session <id> amend-plan <slice-id>\n",
    `       oso-state --session <id> amend-plan <slice-id>\n${DENY_PATTERN_LINE}${WATCH_LINE}${MARK_LINE}`,
  )
  .replace(
    "       oso-state journal --path\n",
    `       oso-state journal --path\n${SCAN_LINES}${REPORT_LINE}${SCAN_PARAGRAPH}${REPORT_PARAGRAPH}${MARK_PARAGRAPH}${WATCH_PARAGRAPH}`,
  );

test(
  "the CLI's usage text names the set, get, show, clear, event, plan and journal verbs " +
    "plus close-slice, deny-pattern add, scan, close, watch, report and mark",
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
