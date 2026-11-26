import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import {
  REPOSITORY_RUNS_DIR,
  repositoryRoot,
  STATE_FILE,
  type StateSubject,
  type StateSandbox,
  withStateSandbox,
} from "../support/state-sandbox.ts";

const CLI_SUBJECT: StateSubject = {
  name: "core/src/bin/oso-state.ts",
  command: [process.execPath, "--experimental-strip-types", path.join(repositoryRoot, "core", "src", "bin", "oso-state.ts")],
};

const VERDICTS_LOG = `${REPOSITORY_RUNS_DIR}/verdicts.jsonl`;
const WAVES_LOG = `${REPOSITORY_RUNS_DIR}/waves.jsonl`;
const SESSION = "ses-wave";

function linesOf(sandbox: StateSandbox, file: string): Record<string, unknown>[] {
  const read = sandbox.read(file);
  if (read.kind !== "file") return [];
  return read.content
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function oso(sandbox: StateSandbox, ...args: string[]) {
  return sandbox.run(CLI_SUBJECT, ["--session", SESSION, ...args]);
}

function startWave(sandbox: StateSandbox, ...slices: string[]) {
  return oso(sandbox, "wave", "start", "wave-1", ...slices);
}

describe("oso-state wave start", () => {
  test("records the wave's slices with their risk and one arm marker per slice nested in the wave", () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_FILE]: "mode=plan\nactive_slice=wave-1\nverify_green=false\nauto_change=alpha\n" });
      const started = startWave(sandbox, "s1=low", "s2=high", "s3=low");
      assert.equal(started.exit, 0, started.stderr);
      const [wave, ...rest] = linesOf(sandbox, WAVES_LOG);
      assert.deepEqual(rest, []);
      const { time, ...named } = wave ?? {};
      assert.deepEqual(named, {
        kind: "wave",
        wave: "wave-1",
        slices: [
          { slice: "s1", risk: "low" },
          { slice: "s2", risk: "high" },
          { slice: "s3", risk: "low" },
        ],
        session: SESSION,
        change: "alpha",
      });
      const markers = linesOf(sandbox, VERDICTS_LOG).map(({ time: _time, ...marker }) => marker);
      assert.deepEqual(
        markers,
        ["s1", "s2", "s3"].map((slice) => ({ kind: "arm", slice, session: SESSION, change: "alpha", wave: "wave-1" })),
      );
    });
  });

  test("is refused for a missing slice list, a bad risk, a repeated slice or a bad name, and writes nothing", () => {
    withStateSandbox("workspace", (sandbox) => {
      const none = startWave(sandbox);
      assert.equal(none.exit, 1);
      assert.match(none.stderr, /wave start refused: /);
      const badRisk = startWave(sandbox, "s1=medium");
      assert.equal(badRisk.exit, 1);
      assert.equal(badRisk.stderr, "oso-state: wave start refused: s1=medium is not <slice>=<low|high>\n");
      const colon = startWave(sandbox, "s:1=low");
      assert.equal(colon.exit, 1);
      assert.equal(colon.stderr, "oso-state: wave start refused: s:1=low is not <slice>=<low|high>\n");
      const repeated = startWave(sandbox, "s1=low", "s1=high");
      assert.equal(repeated.exit, 1);
      assert.equal(repeated.stderr, "oso-state: wave start refused: slice s1 is listed twice\n");
      assert.deepEqual(sandbox.read(WAVES_LOG), { kind: "absent" });
      assert.deepEqual(sandbox.read(VERDICTS_LOG), { kind: "absent" });
    });
  });
});

describe("oso-state launch-token", () => {
  test("registers a batch token of up to 3 low-risk wave slices and a solo token for a high-risk one", () => {
    withStateSandbox("workspace", (sandbox) => {
      startWave(sandbox, "s1=low", "s2=low", "s3=low", "s4=high");
      assert.equal(oso(sandbox, "launch-token", "wave-1", "tok-a", "s1", "s2", "s3").exit, 0);
      assert.equal(oso(sandbox, "launch-token", "wave-1", "tok-b", "s4").exit, 0);
      const tokens = linesOf(sandbox, WAVES_LOG)
        .filter((entry) => entry["kind"] === "token")
        .map(({ time, ...named }) => named);
      assert.deepEqual(tokens, [
        { kind: "token", wave: "wave-1", token: "tok-a", slices: ["s1", "s2", "s3"], session: SESSION },
        { kind: "token", wave: "wave-1", token: "tok-b", slices: ["s4"], session: SESSION },
      ]);
    });
  });

  test("refuses a batch token naming a high-risk slice", () => {
    withStateSandbox("workspace", (sandbox) => {
      startWave(sandbox, "s1=low", "s2=high");
      const refused = oso(sandbox, "launch-token", "wave-1", "tok-a", "s1", "s2");
      assert.equal(refused.exit, 1);
      assert.equal(refused.stderr, "oso-state: launch-token refused: slice s2 is high risk and is verified solo\n");
      assert.equal(linesOf(sandbox, WAVES_LOG).filter((entry) => entry["kind"] === "token").length, 0);
    });
  });

  test("refuses a batch token with 4 ids", () => {
    withStateSandbox("workspace", (sandbox) => {
      startWave(sandbox, "s1=low", "s2=low", "s3=low", "s4=low");
      const refused = oso(sandbox, "launch-token", "wave-1", "tok-a", "s1", "s2", "s3", "s4");
      assert.equal(refused.exit, 1);
      assert.equal(refused.stderr, "oso-state: launch-token refused: a batch holds at most 3 slices, not 4\n");
      assert.equal(linesOf(sandbox, WAVES_LOG).filter((entry) => entry["kind"] === "token").length, 0);
    });
  });

  test("refuses an id outside the armed wave, an unknown wave, a repeated id, a repeated token and no ids", () => {
    withStateSandbox("workspace", (sandbox) => {
      startWave(sandbox, "s1=low", "s2=low");
      assert.equal(
        oso(sandbox, "launch-token", "wave-1", "tok-a", "s9").stderr,
        "oso-state: launch-token refused: slice s9 is not in wave-1\n",
      );
      assert.equal(
        oso(sandbox, "launch-token", "wave-7", "tok-a", "s1").stderr,
        "oso-state: launch-token refused: no wave-7 was started\n",
      );
      assert.equal(
        oso(sandbox, "launch-token", "wave-1", "tok-a", "s1", "s1").stderr,
        "oso-state: launch-token refused: slice s1 is listed twice\n",
      );
      assert.equal(oso(sandbox, "launch-token", "wave-1", "tok-a", "s1").exit, 0);
      assert.equal(
        oso(sandbox, "launch-token", "wave-1", "tok-a", "s2").stderr,
        "oso-state: launch-token refused: token tok-a is already registered\n",
      );
      assert.equal(oso(sandbox, "launch-token", "wave-1", "tok-b").exit, 1);
      assert.equal(linesOf(sandbox, WAVES_LOG).filter((entry) => entry["kind"] === "token").length, 1);
    });
  });
});

describe("oso-state mark inside a wave", () => {
  test("a mark naming slice A is counted for A and never against slice B", () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({ [STATE_FILE]: "mode=plan\nactive_slice=wave-1\nverify_green=false\nauto_change=alpha\n" });
      startWave(sandbox, "s1=low", "s2=low");
      assert.equal(oso(sandbox, "mark", "empty-result", "s1").exit, 0);
      assert.equal(oso(sandbox, "mark", "diagnosed", "s1").exit, 0);
      const markers = linesOf(sandbox, VERDICTS_LOG).filter((entry) => entry["kind"] !== "arm");
      assert.deepEqual(
        markers.map(({ time, ...named }) => named),
        [
          { kind: "empty-result", slice: "s1", session: SESSION, change: "alpha" },
          { kind: "diagnosed", slice: "s1", session: SESSION, change: "alpha" },
        ],
      );
    });
  });

  test("a slice id outside the wave is refused and writes no marker", () => {
    withStateSandbox("workspace", (sandbox) => {
      startWave(sandbox, "s1=low");
      const refused = oso(sandbox, "mark", "diagnosed", "s9");
      assert.equal(refused.exit, 1);
      assert.equal(refused.stderr, "oso-state: mark diagnosed refused: slice s9 is not in the armed wave\n");
      assert.equal(linesOf(sandbox, VERDICTS_LOG).filter((entry) => entry["kind"] !== "arm").length, 0);
    });
  });
});
