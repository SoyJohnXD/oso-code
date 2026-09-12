import assert from "node:assert/strict";
import { chmodSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { logEvent, writeStateValues } from "../../src/state/store.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { STATE_ROOT_THESE_TESTS_SPELL, withStateSandbox } from "../support/state-sandbox.ts";
import { skipUnlessMkdirHonoursOwnerOnlyMode } from "../support/win32-skip-guards.ts";

const OWNER_ONLY_DIRECTORY = 0o700;
const GROUP_AND_OTHER_WRITABLE = 0o775;
const READ_EXECUTE_ONLY_DIRECTORY = 0o555;
const OWNER_READ_EXECUTE_ONLY = 0o500;
const SHARING_UMASK = 0o002;
const SESSION = "state-root-mode-probe";

type StateRootWrite = (cwd: string) => void;
type ProbedStateRoot = Readonly<{ mode: number; refusal: string }>;

const ARM_A_SLICE: StateRootWrite = (cwd) => writeStateValues(cwd, SESSION, ["mode=plan", "active_slice=s7"]);
const LOG_AN_EVENT: StateRootWrite = () => logEvent({ event: "probe", session: SESSION });

function refusalOf(write: () => void): string {
  try {
    write();
    return "";
  } catch (error) {
    return String(error);
  }
}

function probeStateRoot(seeded: number | "absent", write: StateRootWrite): ProbedStateRoot {
  return withStateSandbox("workspace", (sandbox) => {
    const stateRoot = path.join(sandbox.home, ...STATE_ROOT_THESE_TESTS_SPELL.split("/"));
    if (seeded !== "absent") {
      mkdirSync(stateRoot, { recursive: true });
      chmodSync(stateRoot, seeded);
    }
    const sharing = process.umask(SHARING_UMASK);
    try {
      const refusal = withHookEnvironment(sandbox.hookEnvironment(), () => refusalOf(() => write(sandbox.cwd)));
      return { mode: statSync(stateRoot).mode & 0o777, refusal };
    } finally {
      process.umask(sharing);
    }
  });
}

describe(
  "core/src/state/store.ts: the state root is owner-only by its own property, never by whichever verb happened " +
    "to reach it first — it holds the <digest>.state files the commit and edits gates read, so a mode a sharing " +
    "umask decided is a forged plan_approval away from a same-group local user",
  { skip: skipUnlessMkdirHonoursOwnerOnlyMode() },
  () => {
    test("arming a slice creates the absent root owner-only under a umask that would otherwise share it", () => {
      assert.deepEqual(probeStateRoot("absent", ARM_A_SLICE), { mode: OWNER_ONLY_DIRECTORY, refusal: "" });
    });

    test("logging an event creates the absent root owner-only under that same umask", () => {
      assert.deepEqual(probeStateRoot("absent", LOG_AN_EVENT), { mode: OWNER_ONLY_DIRECTORY, refusal: "" });
    });

    test("a root already open to group and other is narrowed by the next write rather than left as found", () => {
      assert.deepEqual(probeStateRoot(GROUP_AND_OTHER_WRITABLE, ARM_A_SLICE), { mode: OWNER_ONLY_DIRECTORY, refusal: "" });
    });

    test("that narrowing only ever removes access, so a root its owner cannot write still refuses the write", () => {
      const probed = probeStateRoot(READ_EXECUTE_ONLY_DIRECTORY, ARM_A_SLICE);
      assert.equal(probed.mode, OWNER_READ_EXECUTE_ONLY);
      assert.match(probed.refusal, /EACCES|EPERM|EROFS/);
    });
  },
);
