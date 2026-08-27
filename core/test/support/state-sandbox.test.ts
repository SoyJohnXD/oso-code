import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { nativizeRootedPaths, withStateSandbox } from "./state-sandbox.ts";

const WINDOWS_HOME = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\oso-test-sandbox-z8i11o\\temp\\oso-state-p4Eo20\\home";
const POSIX_HOME = "/tmp/oso-state-p4Eo20/home";
const REPO_DIGEST = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const PLAN_DIGEST = "d3f0dbd7d1c0f9e0e2ed69b9b3b30a3c1f5e6fbef5db1cf4c7fdc23c4a8e0dcb";

function planStateLines(home: string): string {
  return (
    `plan_snapshot_file=${home}/.local/state/oso-code/plans/${REPO_DIGEST}/presented-${PLAN_DIGEST}.md\n` +
    `plan_current_file=${home}/.local/state/oso-code/plans/${REPO_DIGEST}/current.md\n`
  );
}

function suffixesAfter(root: string, text: string): string[] {
  return text
    .split(root)
    .slice(1)
    .map((chunk) => chunk.split(/\s/)[0] ?? "");
}

test("a {home}-prefixed state line seeded with a Windows-shaped native root comes out as one native-separator run, not a mix of both", () => {
  const nativized = nativizeRootedPaths(planStateLines(WINDOWS_HOME), WINDOWS_HOME);
  const suffixes = suffixesAfter(WINDOWS_HOME, nativized);
  assert.equal(suffixes.length, 2);
  for (const suffix of suffixes) {
    assert.ok(!suffix.includes("/"), `${WINDOWS_HOME}${suffix} still mixes \\ and /`);
  }
  assert.equal(
    nativized,
    `plan_snapshot_file=${path.win32.join(WINDOWS_HOME, ".local", "state", "oso-code", "plans", REPO_DIGEST, `presented-${PLAN_DIGEST}.md`)}\n` +
      `plan_current_file=${path.win32.join(WINDOWS_HOME, ".local", "state", "oso-code", "plans", REPO_DIGEST, "current.md")}\n`,
  );
});

test("the same {home}-prefixed state line seeded with a POSIX root stays forward-slash joined", () => {
  const nativized = nativizeRootedPaths(planStateLines(POSIX_HOME), POSIX_HOME);
  assert.equal(
    nativized,
    `plan_snapshot_file=${path.posix.join(POSIX_HOME, ".local", "state", "oso-code", "plans", REPO_DIGEST, `presented-${PLAN_DIGEST}.md`)}\n` +
      `plan_current_file=${path.posix.join(POSIX_HOME, ".local", "state", "oso-code", "plans", REPO_DIGEST, "current.md")}\n`,
  );
  assert.equal(nativized, planStateLines(POSIX_HOME));
});

test("a root with no following path segments passes through unchanged", () => {
  const text = `repo_path=${WINDOWS_HOME}\n`;
  assert.equal(nativizeRootedPaths(text, WINDOWS_HOME), text);
});

test("StateSandbox.expand() resolves a {home}-prefixed plan_snapshot_file template to the exact path planPaths() joins on this platform", () => {
  withStateSandbox("workspace", (sandbox) => {
    const expanded = sandbox.expand(`{home}/.local/state/oso-code/plans/{repo}/presented-${PLAN_DIGEST}.md`);
    const producedByPlanPaths = path.join(
      sandbox.home,
      ".local",
      "state",
      "oso-code",
      "plans",
      sandbox.repositoryKey,
      `presented-${PLAN_DIGEST}.md`,
    );
    assert.equal(expanded, producedByPlanPaths);
  });
});
