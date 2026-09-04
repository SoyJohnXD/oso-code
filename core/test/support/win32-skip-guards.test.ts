import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { provedSomething } from "./proved.ts";
import * as guardModule from "./win32-skip-guards.ts";

const GUARD_MODULE = "core/test/support/win32-skip-guards.ts";

const NON_GUARD_EXPORTS: ReadonlyMap<string, string> = new Map([
  ["WIN32_DIRECTORY_ENTRY_MARGIN_KIB", "the KiB margin core/test/install/backup.test.ts holds over win32's directory-entry delta, read by a guard rather than being one"],
]);

type Win32SkipGuard = () => false | string;

const everyGuard = Object.entries(guardModule)
  .filter((entry): entry is [string, Win32SkipGuard] => typeof entry[1] === "function")
  .map(([name, guard]) => ({ name, guard }));

const unreadExports = Object.entries(guardModule)
  .filter(([name, value]) => typeof value !== "function" && !NON_GUARD_EXPORTS.has(name))
  .map(([name]) => name);

const staleClassifications = [...NON_GUARD_EXPORTS.keys()].filter((name) => !(name in guardModule));

provedSomething(
  `all ${everyGuard.length} guard(s) this net reads were derived from ${GUARD_MODULE}'s own exports rather than named here, so a guard added there cannot be added outside this net`,
  everyGuard.length > 0,
  `${GUARD_MODULE} exported no guard function, so a suite could name any guard it liked and skip on every leg unnoticed`,
);

describe("every POSIX oracle a win32 guard removes is still proved on the leg the divergence does not reach", () => {
  test(`every export of ${GUARD_MODULE} is either a guard read below or a classified non-guard`, () => {
    assert.deepEqual(unreadExports, [], `unclassified export(s) of ${GUARD_MODULE}, neither read as a guard nor recorded as a non-guard: ${unreadExports.join(", ")}`);
  });

  test("every classified non-guard is still exported, so the classification cannot outlive its reason", () => {
    assert.deepEqual(staleClassifications, [], staleClassifications.map((name) => `${name}: ${NON_GUARD_EXPORTS.get(name)}`).join("\n"));
  });

  test(
    process.platform === "win32"
      ? "each guard names the win32 divergence it skips for, so no suite skips here without a stated reason"
      : `each guard is off on ${process.platform}, so the oracles they cover are proved on this leg rather than skipped on both`,
    () => {
      for (const { name, guard } of everyGuard) {
        const outcome = guard();
        if (process.platform === "win32") {
          assert.equal(typeof outcome, "string", `${name} skips nothing on win32, where its divergence is the whole reason it exists`);
          assert.notEqual(outcome, "", `${name} skips on win32 without naming the divergence`);
          continue;
        }
        assert.equal(outcome, false, `${name} skipped on ${process.platform}, where its win32 divergence does not apply`);
      }
    },
  );
});
