import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import {
  EVENTS_LOG,
  REPOSITORY_RUNS_DIR,
  repositoryRoot,
  type StateSubject,
  withStateSandbox,
} from "../support/state-sandbox.ts";

const CLI_SUBJECT: StateSubject = {
  name: "core/src/bin/oso-state.ts",
  command: [process.execPath, "--experimental-strip-types", path.join(repositoryRoot, "core", "src", "bin", "oso-state.ts")],
};

const VERDICTS_LOG = `${REPOSITORY_RUNS_DIR}/verdicts.jsonl`;
const REPORT_FIXTURE = readFileSync(
  path.join(repositoryRoot, "core", "test", "fixtures", "verdicts", "report.jsonl"),
  "utf8",
);

function verdictLines(content: string): Record<string, unknown>[] {
  return content
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("oso-state set writes an arm marker when it arms a slice", () => {
  test("active_slice=<X> with verify_green=false appends one arm marker naming the slice, session and change", () => {
    withStateSandbox("workspace", (sandbox) => {
      assert.equal(sandbox.run(CLI_SUBJECT, ["--session", "ses-arm", "set", "auto_change=alpha"]).exit, 0);
      const armingPairs = ["mode=plan", "active_slice=2", "verify_green=false"];
      const armed = sandbox.run(CLI_SUBJECT, ["--session", "ses-arm", "set", ...armingPairs]);
      assert.equal(armed.exit, 0, armed.stderr);
      const log = sandbox.read(VERDICTS_LOG);
      assert.equal(log.kind, "file");
      const [marker, ...rest] = verdictLines(log.kind === "file" ? log.content : "");
      assert.deepEqual(rest, []);
      const { time, ...named } = marker ?? {};
      assert.deepEqual(named, { kind: "arm", slice: "2", session: "ses-arm", change: "alpha" });
      assert.match(String(time), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });
  });

  test("a set that closes, moves or greens a slice writes no marker, and a change never armed is null", () => {
    withStateSandbox("workspace", (sandbox) => {
      for (const pairs of [["active_slice=none", "verify_green=false"], ["active_slice=3"], ["verify_green=true"]]) {
        assert.equal(sandbox.run(CLI_SUBJECT, ["--session", "ses-arm", "set", ...pairs]).exit, 0);
      }
      assert.deepEqual(sandbox.read(VERDICTS_LOG), { kind: "absent" });
      sandbox.run(CLI_SUBJECT, ["--session", "ses-arm", "set", "active_slice=4", "verify_green=false"]);
      const log = sandbox.read(VERDICTS_LOG);
      assert.equal(verdictLines(log.kind === "file" ? log.content : "")[0]?.["change"], null);
    });
  });

  test("an arm marker that cannot be written logs telemetry-write-failed and never blocks the set", () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [REPOSITORY_RUNS_DIR]: "a file where the runs directory belongs" });
      const armed = sandbox.run(CLI_SUBJECT, ["--session", "ses-arm", "set", "active_slice=2", "verify_green=false"]);
      assert.equal(armed.exit, 0, armed.stderr);
      assert.match(armed.stdout, /^active_slice=2$/m);
      assert.ok(sandbox.eventLogLines().some((line) => line.includes('"event":"telemetry-write-failed"')));
    });
  });
});

describe("oso-state report", () => {
  test("prints the metrics as a table, and the same fields as JSON under --json, with no --session", () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [VERDICTS_LOG]: REPORT_FIXTURE, [EVENTS_LOG]: "" });
      const table = sandbox.run(CLI_SUBJECT, ["report"]);
      assert.equal(table.exit, 0, table.stderr);
      assert.match(table.stdout, /^first-fail rate\s+50\.0 % \(2 of 4 slices\)$/m);
      assert.match(table.stdout, /^rounds per slice\s+max 3, median 1\.5$/m);
      assert.match(table.stdout, /^unreceipted greens\s+0$/m);
      const json = sandbox.run(CLI_SUBJECT, ["report", "--json"]);
      assert.equal(json.exit, 0, json.stderr);
      const metrics = JSON.parse(json.stdout) as Record<string, unknown>;
      assert.equal(metrics["first_fail_rate_percent"], 50);
      assert.deepEqual(metrics["rounds_per_slice"], { max: 3, median: 1.5 });
    });
  });

  test("with no events log the unreceipted greens are omitted and the reason said", () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [VERDICTS_LOG]: REPORT_FIXTURE });
      const table = sandbox.run(CLI_SUBJECT, ["report"]);
      assert.match(table.stdout, /^unreceipted greens\s+omitted: no events log at .*events\.jsonl$/m);
    });
  });

  test("an unknown flag is a usage error", () => {
    withStateSandbox("workspace", (sandbox) => {
      const refused = sandbox.run(CLI_SUBJECT, ["report", "--all"]);
      assert.equal(refused.exit, 1);
      assert.match(refused.stderr, /^usage: oso-state/);
    });
  });
});
