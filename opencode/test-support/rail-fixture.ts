import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveRootId } from "../plugin/oso/identity.ts";
import { underFixtureHomeAsync } from "./state-fixture.ts";

export interface RailFixture {
  base: string;
  repo: string;
  home: string;
  owner: string;
}

export function seedRailFixture(label: string): RailFixture {
  const base = mkdtempSync(join(tmpdir(), `${label}-`));
  const repo = join(base, "repo");
  const home = join(base, "home");
  mkdirSync(repo);
  mkdirSync(home);
  const init = spawnSync("git", ["init", "-b", "main"], { cwd: repo, encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr ?? "");
  return { base, repo, home, owner: deriveRootId(repo) };
}

export function underRailFixtureHome<T>(fixture: RailFixture, run: () => Promise<T>): Promise<T> {
  return underFixtureHomeAsync(fixture.home, run);
}
