import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText, trackedRepositoryFiles, type TrackedFileText } from "../support/tracked-files.ts";

const TEST_TREE_PREFIX = "core/test/";
const GUARD_MODULE = "core/test/support/win32-skip-guards.ts";
const PLATFORM_BRANCH_PATTERN = /(process\.platform\s*[!=]==?)|([!=]==?\s*process\.platform)|(switch\s*\(\s*process\.platform)/;

const BRANCHED_BESIDE_THE_GUARD_MODULE = [
  {
    file: "core/test/support/win32-skip-guards.test.ts",
    justification:
      "the guard module's own counter-proof, which must read the running platform to assert every guard is off on POSIX and names its divergence on win32",
  },
  {
    file: "core/test/support/gate-fixture.ts",
    justification:
      "the expected message a gate emits for a missing home directory, which names USERPROFILE on win32 and HOME elsewhere — an oracle the port must match on both legs, never a case skipped on one",
  },
] as const;

const EXEMPT_FILES = [GUARD_MODULE, ...BRANCHED_BESIDE_THE_GUARD_MODULE.map((entry) => entry.file)];

type PlatformBranch = Readonly<{ file: string; line: number; text: string }>;

function platformBranchesIn({ file, text }: TrackedFileText): PlatformBranch[] {
  return text
    .split("\n")
    .map((lineText, index) => ({ file, line: index + 1, text: lineText.trim() }))
    .filter((site) => PLATFORM_BRANCH_PATTERN.test(site.text));
}

const scanned = trackedRepositoryFiles()
  .filter((file) => file.startsWith(TEST_TREE_PREFIX) && file.endsWith(".ts") && !EXEMPT_FILES.includes(file))
  .map(readTrackedText);
const branches = scanned.flatMap(platformBranchesIn);

provedSomething(
  `${scanned.length} tracked *.ts file(s) under ${TEST_TREE_PREFIX} outside the ${EXEMPT_FILES.length} exempt file(s) were scanned for a platform branch`,
  scanned.length > 0,
  `only ${scanned.length} file(s) were scanned, so a walk that found nothing would report the same empty result as a clean tree`,
);

describe(
  `a POSIX oracle a test asserts against — du, chmod, a #! fixture — is skipped on win32 through a named guard in ${GUARD_MODULE}, ` +
    "never an inline platform branch that leaves the skip unnamed and unreadable from the guard table; the rest of " +
    `${TEST_TREE_PREFIX}support/ is no second home for one`,
  () => {
    test(`only ${GUARD_MODULE} and the ${BRANCHED_BESIDE_THE_GUARD_MODULE.length} justified file(s) beside it compare the running platform`, () => {
      assert.deepEqual(branches, [], branches.map((site) => `${site.file}:${site.line}: ${site.text}`).join("\n"));
    });

    test("every justified exemption still holds the branch it was written for, so the allowlist cannot outlive its reason", () => {
      const stale = BRANCHED_BESIDE_THE_GUARD_MODULE.filter((entry) => platformBranchesIn(readTrackedText(entry.file)).length === 0);
      assert.deepEqual(stale, [], stale.map((entry) => `${entry.file} branches nowhere: ${entry.justification}`).join("\n"));
    });
  },
);
