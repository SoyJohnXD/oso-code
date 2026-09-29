import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import {
  REPOSITORY_RUNS_DIR,
  repositoryRoot,
  STATE_FILE,
  type StateSandbox,
  type StateSubject,
  withStateSandbox,
} from "../support/state-sandbox.ts";

const CLI_SUBJECT: StateSubject = {
  name: "core/src/bin/oso-state.ts",
  command: [process.execPath, "--experimental-strip-types", path.join(repositoryRoot, "core", "src", "bin", "oso-state.ts")],
};

const VERDICTS_LOG = `${REPOSITORY_RUNS_DIR}/verdicts.jsonl`;
const SESSION = "ses-receipt";
const ARMED_STATE = `mode=plan\nactive_slice=1\nverify_green=false\nsession=${SESSION}\n`;
const GREEN_PAIRS = ["mode=plan", "active_slice=none", "verify_green=true"];
const UNRECEIPTED_EVENT = '"event":"verify-green-unreceipted"';

function armMarker(slice: string, time: string): string {
  return JSON.stringify({ kind: "arm", slice, session: SESSION, change: "alpha", time });
}

function verifierRecord(slice: string, time: string, verdict: string, verdictShape = "valid"): string {
  return JSON.stringify({
    time,
    host: "claude",
    session: SESSION,
    change: "alpha",
    slice,
    attempt: 1,
    role: "verifier",
    model: "opus",
    verdict,
    verdict_shape: verdictShape,
    escalated: false,
  });
}

function seedArmedSlice(sandbox: StateSandbox, verdictLines: readonly string[]): void {
  sandbox.seed({ [STATE_FILE]: ARMED_STATE, [VERDICTS_LOG]: verdictLines.map((line) => `${line}\n`).join("") });
}

function stateContent(sandbox: StateSandbox): string {
  const state = sandbox.read(STATE_FILE);
  return state.kind === "file" ? state.content : "";
}

for (const verb of ["set", "close-slice"] as const) {
  const argv = verb === "set" ? ["--session", SESSION, "set", ...GREEN_PAIRS] : ["--session", SESSION, "close-slice", "1"];
  const refusalPrefix = verb === "set" ? "oso-state: set refused: " : "oso-state: close-slice 1 refused: ";

  describe(`oso-state ${verb} writes verify_green=true only over a receipt from the slice's verifier`, () => {
    for (const [verdict, shape] of [
      ["fail", "valid"],
      ["blocked", "valid"],
      ["none", "malformed"],
    ] as const) {
      test(`refuses over a newest ${shape === "malformed" ? "malformed" : verdict} record, naming the record line and changing nothing`, () => {
        withStateSandbox("workspace", (sandbox) => {
          const refusing = verifierRecord("1", "2026-09-01T10:10:00Z", verdict, shape);
          seedArmedSlice(sandbox, [
            armMarker("1", "2026-09-01T10:00:00Z"),
            verifierRecord("1", "2026-09-01T10:05:00Z", "pass"),
            refusing,
          ]);
          const refused = sandbox.run(CLI_SUBJECT, argv);
          assert.equal(refused.exit, 1);
          assert.ok(refused.stderr.startsWith(refusalPrefix), refused.stderr);
          assert.ok(refused.stderr.includes(refusing), refused.stderr);
          assert.equal(refused.stdout, "");
          assert.equal(stateContent(sandbox), ARMED_STATE);
          assert.ok(!sandbox.eventLogLines().some((line) => line.includes("verify_green=true")));
        });
      });
    }

    test("allows the write over a newest pass, with no unreceipted event", () => {
      withStateSandbox("workspace", (sandbox) => {
        seedArmedSlice(sandbox, [
          armMarker("1", "2026-09-01T10:00:00Z"),
          verifierRecord("1", "2026-09-01T10:05:00Z", "fail"),
          verifierRecord("1", "2026-09-01T10:10:00Z", "pass"),
        ]);
        const allowed = sandbox.run(CLI_SUBJECT, argv);
        assert.equal(allowed.exit, 0, allowed.stderr);
        assert.match(stateContent(sandbox), /^active_slice=none$/m);
        assert.match(stateContent(sandbox), /^verify_green=true$/m);
        assert.ok(!sandbox.eventLogLines().some((line) => line.includes(UNRECEIPTED_EVENT)));
      });
    });

    test("allows the write over no record and logs verify-green-unreceipted naming the slice", () => {
      withStateSandbox("workspace", (sandbox) => {
        seedArmedSlice(sandbox, [armMarker("1", "2026-09-01T10:00:00Z")]);
        const allowed = sandbox.run(CLI_SUBJECT, argv);
        assert.equal(allowed.exit, 0, allowed.stderr);
        assert.match(stateContent(sandbox), /^verify_green=true$/m);
        const unreceipted = sandbox.eventLogLines().filter((line) => line.includes(UNRECEIPTED_EVENT));
        assert.equal(unreceipted.length, 1);
        assert.match(unreceipted[0] ?? "", /"command":"1"/);
        assert.match(unreceipted[0] ?? "", new RegExp(`"session":"${SESSION}"`));
      });
    });

    test("a fail from before the slice's newer arm marker, or another slice's fail, never refuses", () => {
      withStateSandbox("workspace", (sandbox) => {
        seedArmedSlice(sandbox, [
          armMarker("1", "2026-09-01T10:00:00Z"),
          verifierRecord("1", "2026-09-01T10:05:00Z", "fail"),
          armMarker("1", "2026-09-01T11:00:00Z"),
          armMarker("2", "2026-09-01T11:01:00Z"),
          verifierRecord("2", "2026-09-01T11:05:00Z", "fail"),
        ]);
        const allowed = sandbox.run(CLI_SUBJECT, argv);
        assert.equal(allowed.exit, 0, allowed.stderr);
        assert.match(stateContent(sandbox), /^verify_green=true$/m);
        assert.equal(sandbox.eventLogLines().filter((line) => line.includes(UNRECEIPTED_EVENT)).length, 1);
      });
    });
  });
}

describe("the receipt stands aside where no slice is armed", () => {
  test("a green written over active_slice=none is never refused and logs no unreceipted event", () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({
        [STATE_FILE]: `mode=quick\nactive_slice=none\nverify_green=false\nsession=${SESSION}\n`,
        [VERDICTS_LOG]: `${verifierRecord("none", "2026-09-01T10:05:00Z", "fail")}\n`,
      });
      const allowed = sandbox.run(CLI_SUBJECT, ["--session", SESSION, "set", "mode=quick", "active_slice=none", "verify_green=true"]);
      assert.equal(allowed.exit, 0, allowed.stderr);
      assert.ok(!sandbox.eventLogLines().some((line) => line.includes(UNRECEIPTED_EVENT)));
    });
  });

  test("a set that writes no verify_green=true is never refused over a fail", () => {
    withStateSandbox("workspace", (sandbox) => {
      seedArmedSlice(sandbox, [armMarker("1", "2026-09-01T10:00:00Z"), verifierRecord("1", "2026-09-01T10:05:00Z", "fail")]);
      const allowed = sandbox.run(CLI_SUBJECT, ["--session", SESSION, "set", "auto_wait=none"]);
      assert.equal(allowed.exit, 0, allowed.stderr);
    });
  });
});

describe("the receipt guards the green that closes a wave, never a slice's window inside it", () => {
  const WAVE_STATE = `mode=plan\nactive_slice=wave-1\nverify_green=false\nsession=${SESSION}\n`;

  function seedWaveWithANewestFail(sandbox: StateSandbox): void {
    sandbox.seed({
      [STATE_FILE]: WAVE_STATE,
      [VERDICTS_LOG]: [
        armMarker("wave-1", "2026-09-01T10:00:00Z"),
        verifierRecord("wave-1", "2026-09-01T10:05:00Z", "pass"),
        verifierRecord("wave-1", "2026-09-01T10:06:00Z", "fail"),
      ]
        .map((line) => `${line}\n`)
        .join(""),
    });
  }

  test("a window that keeps the wave armed is allowed over the wave's newest fail and logged unreceipted", () => {
    withStateSandbox("workspace", (sandbox) => {
      seedWaveWithANewestFail(sandbox);
      const allowed = sandbox.run(CLI_SUBJECT, ["--session", SESSION, "set", "mode=plan", "active_slice=wave-1", "verify_green=true"]);
      assert.equal(allowed.exit, 0, allowed.stderr);
      assert.match(stateContent(sandbox), /^verify_green=true$/m);
      const unreceipted = sandbox.eventLogLines().filter((line) => line.includes(UNRECEIPTED_EVENT));
      assert.equal(unreceipted.length, 1);
      assert.match(unreceipted[0] ?? "", /"command":"wave-1"/);
    });
  });

  for (const pairs of [["mode=plan", "active_slice=none", "verify_green=true"], ["verify_green=true"]]) {
    test(`a green written as ${pairs.join(" ")} over the wave's newest fail is refused`, () => {
      withStateSandbox("workspace", (sandbox) => {
        seedWaveWithANewestFail(sandbox);
        const refused = sandbox.run(CLI_SUBJECT, ["--session", SESSION, "set", ...pairs]);
        assert.equal(refused.exit, 1);
        assert.ok(refused.stderr.startsWith("oso-state: set refused: "), refused.stderr);
        assert.equal(stateContent(sandbox), WAVE_STATE);
      });
    });
  }

  test("a sequential slice that names itself again is refused over its own newest fail, never taken for a window", () => {
    withStateSandbox("workspace", (sandbox) => {
      seedArmedSlice(sandbox, [armMarker("1", "2026-09-01T10:00:00Z"), verifierRecord("1", "2026-09-01T10:05:00Z", "fail")]);
      const refused = sandbox.run(CLI_SUBJECT, ["--session", SESSION, "set", "active_slice=1", "verify_green=true"]);
      assert.equal(refused.exit, 1);
      assert.ok(refused.stderr.startsWith("oso-state: set refused: "), refused.stderr);
      assert.equal(stateContent(sandbox), ARMED_STATE);
    });
  });
});

describe("oso-state report counts the greens the receipt logged unreceipted", () => {
  test("one green over no record reads as one unreceipted green, and a receipted one adds none", () => {
    withStateSandbox("workspace", (sandbox) => {
      seedArmedSlice(sandbox, [armMarker("1", "2026-09-01T10:00:00Z")]);
      assert.equal(sandbox.run(CLI_SUBJECT, ["--session", SESSION, "set", ...GREEN_PAIRS]).exit, 0);
      assert.equal(sandbox.run(CLI_SUBJECT, ["--session", SESSION, "set", "active_slice=2", "verify_green=false"]).exit, 0);
      const pass = verifierRecord("2", "2099-01-01T00:00:00Z", "pass");
      const verdicts = sandbox.read(VERDICTS_LOG);
      sandbox.seed({ [VERDICTS_LOG]: `${verdicts.kind === "file" ? verdicts.content : ""}${pass}\n` });
      assert.equal(sandbox.run(CLI_SUBJECT, ["--session", SESSION, "set", ...GREEN_PAIRS]).exit, 0);
      const table = sandbox.run(CLI_SUBJECT, ["report"]);
      assert.equal(table.exit, 0, table.stderr);
      assert.match(table.stdout, /^unreceipted greens\s+1$/m);
    });
  });
});
