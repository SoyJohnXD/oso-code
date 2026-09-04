import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { provedSomething } from "./proved.ts";
import { posixRelativeTo, posixRepositoryPath, posixSpelled } from "./repository-paths.ts";
import { repositoryRoot } from "./state-sandbox.ts";
import { trackedRepositoryFiles } from "./tracked-files.ts";

const NESTED_SEGMENTS = ["bootstrap", "lib", "opencode-verification.sh"] as const;

const tracked = trackedRepositoryFiles();

provedSomething(
  `${tracked.length} tracked file(s) were listed to compare this module's spelling against git's own`,
  tracked.length > 0,
  "git ls-files named no file, so the spelling below would be compared against an empty list",
);

describe(
  "the one place a repo-relative path is spelled for comparison against a slash-spelled literal: every case here is " +
    "written against the separator the running platform joins with, so it reads as a tautology on linux and as the whole " +
    "point on win32, rather than being skipped on one leg",
  () => {
    test("posixSpelled turns the separator this platform joins with into a forward slash", () => {
      assert.equal(posixSpelled(NESTED_SEGMENTS.join(path.sep)), "bootstrap/lib/opencode-verification.sh");
    });

    test("posixSpelled leaves an already slash-spelled path alone, so a mixed run cannot survive it", () => {
      assert.equal(posixSpelled("bootstrap/lib/opencode-verification.sh"), "bootstrap/lib/opencode-verification.sh");
    });

    test("posixRelativeTo spells a nested target under an arbitrary root in forward slashes", () => {
      const root = path.join(repositoryRoot, "fixture-root");
      assert.equal(posixRelativeTo(root, path.join(root, ...NESTED_SEGMENTS)), "bootstrap/lib/opencode-verification.sh");
    });

    test("posixRepositoryPath spells this very file exactly as git ls-files spells it, which is the comparison the class kept losing", () => {
      const spelled = posixRepositoryPath(import.meta.filename);
      assert.equal(spelled, "core/test/support/repository-paths.test.ts");
      assert.ok(tracked.includes(spelled), `git ls-files does not carry ${spelled}, so the two spellings disagree`);
    });

    test("no spelling this module returns carries a backslash, whichever separator the platform joined with", () => {
      const spellings = [
        posixSpelled(NESTED_SEGMENTS.join(path.sep)),
        posixRelativeTo(repositoryRoot, path.join(repositoryRoot, ...NESTED_SEGMENTS)),
        posixRepositoryPath(import.meta.filename),
      ];
      assert.deepEqual(spellings.filter((spelling) => spelling.includes("\\")), []);
    });
  },
);
