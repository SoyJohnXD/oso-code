import assert from "node:assert/strict";
import { homedir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { homeDirectoryFrom, stateRootDirectory } from "../../src/state/store.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { provedSomething } from "../support/proved.ts";

const MSYS_HOME = "/c/Users/oso";
const NATIVE_PROFILE = "C:\\Users\\oso";
const BOTH_PROVENANCES: NodeJS.ProcessEnv = { HOME: MSYS_HOME, USERPROFILE: NATIVE_PROFILE };

provedSomething(
  "the two home provenances this check compares name different directories",
  path.win32.join(MSYS_HOME, ".local") !== path.win32.join(NATIVE_PROFILE, ".local"),
  `${MSYS_HOME} and ${NATIVE_PROFILE} join to one directory on win32, so no divergence could be observed`,
);

describe(
  "core/src/state/store.ts: the state root's provenance, driven for BOTH platforms here so neither branch " +
    "depends on the platform this suite happens to run on",
  () => {
    test("win32 takes USERPROFILE over a HOME Git Bash spells the MSYS way", () => {
      assert.equal(homeDirectoryFrom("win32", BOTH_PROVENANCES), NATIVE_PROFILE);
    });

    test("posix takes HOME and ignores a USERPROFILE the shell happened to export", () => {
      assert.equal(homeDirectoryFrom("linux", BOTH_PROVENANCES), MSYS_HOME);
    });

    test("win32 without USERPROFILE falls back to the profile directory the platform itself names", () => {
      assert.equal(homeDirectoryFrom("win32", {}), homedir());
    });

    test("posix without HOME names the variable it needed", () => {
      assert.throws(() => homeDirectoryFrom("linux", {}), /HOME is not set/);
    });

    test("win32 with an empty USERPROFILE names the variable it needed", () => {
      assert.throws(() => homeDirectoryFrom("win32", { USERPROFILE: "" }), /USERPROFILE is not set/);
    });

    test("OSO_STATE_DIR overrides whichever provenance the platform would otherwise have used", () => {
      const override = path.join(MSYS_HOME, "elsewhere");
      assert.equal(withHookEnvironment({ HOME: MSYS_HOME, OSO_STATE_DIR: override }, stateRootDirectory), override);
    });

    test("with no override the state root is the harness directory under the resolved home", () => {
      const resolved = homeDirectoryFrom(process.platform, { HOME: MSYS_HOME, USERPROFILE: MSYS_HOME });
      assert.equal(
        withHookEnvironment({ HOME: MSYS_HOME }, stateRootDirectory),
        path.join(resolved, ".local", "state", "oso-code"),
      );
    });
  },
);
