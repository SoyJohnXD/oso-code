import assert from "node:assert/strict";
import type { Stats } from "node:fs";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { isExecutableRegularFile } from "../../scripts/lib/executable-file.mjs";

function fixtureDir(): string {
  return mkdtempSync(path.join(tmpdir(), "oso-executable-file-test-"));
}

function fakeRegularFileStat(mode: number): (target: string) => Stats {
  return () => ({ mode, isFile: () => true }) as Stats;
}

test("on a posix platform a file with exactly the owner-exec-group-exec-other-exec bits reads back executable", () => {
  assert.equal(
    isExecutableRegularFile("fake-path", { platform: "linux", statSync: fakeRegularFileStat(0o755) }),
    true,
  );
});

test("on a posix platform a file missing the executable bits reads back non-executable", () => {
  assert.equal(
    isExecutableRegularFile("fake-path", { platform: "linux", statSync: fakeRegularFileStat(0o644) }),
    false,
  );
});

test("on win32 the exact same non-executable-mode file degrades to exists-and-is-a-regular-file", () => {
  const dir = fixtureDir();
  const target = path.join(dir, "bin");
  writeFileSync(target, "#!/usr/bin/env node\n");
  chmodSync(target, 0o644);
  assert.equal(isExecutableRegularFile(target, { platform: "win32" }), true);
  rmSync(dir, { recursive: true, force: true });
});

test("on win32 a missing file is still not executable", () => {
  const dir = fixtureDir();
  const missing = path.join(dir, "missing-bin");
  assert.equal(isExecutableRegularFile(missing, { platform: "win32" }), false);
  rmSync(dir, { recursive: true, force: true });
});

test("a directory is never an executable regular file, on win32 or here", () => {
  const dir = fixtureDir();
  const sub = path.join(dir, "adir");
  mkdirSync(sub);
  assert.equal(isExecutableRegularFile(sub), false);
  assert.equal(isExecutableRegularFile(sub, { platform: "win32" }), false);
  rmSync(dir, { recursive: true, force: true });
});
