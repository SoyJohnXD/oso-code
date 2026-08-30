import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { provedSomething } from "./proved.ts";
import {
  skipUnlessChmodChangesFileMode,
  skipUnlessChmodDeniesDirectoryWrites,
  skipUnlessChmodMakesFilesUnreadable,
  skipUnlessDiskBlocksAreAllocated,
  skipUnlessKernelRunsScriptFixtures,
  skipUnlessMkdirHonoursOwnerOnlyMode,
  skipUnlessPathResolvesExtensionlessNames,
} from "./win32-skip-guards.ts";

const everyGuard = [
  skipUnlessChmodMakesFilesUnreadable,
  skipUnlessChmodChangesFileMode,
  skipUnlessChmodDeniesDirectoryWrites,
  skipUnlessMkdirHonoursOwnerOnlyMode,
  skipUnlessDiskBlocksAreAllocated,
  skipUnlessKernelRunsScriptFixtures,
  skipUnlessPathResolvesExtensionlessNames,
];

provedSomething(
  `all ${everyGuard.length} win32 skip guard(s) were read on ${process.platform}`,
  everyGuard.length > 0,
  "no guard was read, so a suite could name any guard it liked and skip on every leg unnoticed",
);

describe("every POSIX oracle a win32 guard removes is still proved on the leg the divergence does not reach", () => {
  test(
    process.platform === "win32"
      ? "each guard names the win32 divergence it skips for, so no suite skips here without a stated reason"
      : `each guard is off on ${process.platform}, so the oracles they cover are proved on this leg rather than skipped on both`,
    () => {
      for (const guard of everyGuard) {
        const outcome = guard();
        if (process.platform === "win32") {
          assert.equal(typeof outcome, "string", `${guard.name} skips nothing on win32, where its divergence is the whole reason it exists`);
          assert.notEqual(outcome, "", `${guard.name} skips on win32 without naming the divergence`);
          continue;
        }
        assert.equal(outcome, false, `${guard.name} skipped on ${process.platform}, where its win32 divergence does not apply`);
      }
    },
  );
});
