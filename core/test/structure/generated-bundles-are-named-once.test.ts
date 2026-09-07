import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { GENERATED_BUNDLES } from "../../src/routes/routes.ts";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText, trackedRepositoryFiles } from "../support/tracked-files.ts";

const THE_ONE_LIST = "core/src/routes/routes.ts";
const BUILD_SCRIPTS_THAT_WRITE_THEM = ["core/scripts/build-oso-state.mjs", "core/scripts/build-oso.mjs"];
const ESBUILD_SOURCE_BANNER = /^\/\/ (?:core|opencode)\/[\w./-]+\.ts$/m;
const PATH_LITERALS_THE_ONE_LIST_OWNS = ["plugin", "dist", "bin", "bootstrap", "oso-state.js", "oso.js", "package.json"];

function trackedFilesCarryingABundlerBanner(): string[] {
  return trackedRepositoryFiles()
    .map(readTrackedText)
    .filter(({ text }) => ESBUILD_SOURCE_BANNER.test(text))
    .map(({ file }) => file);
}

function quotedLiteralsIn(text: string): Set<string> {
  return new Set([...text.matchAll(/"([^"\n]*)"/g)].map((quoted) => quoted[1] as string));
}

const bundlesOnDisk = trackedFilesCarryingABundlerBanner();

provedSomething(
  `${trackedRepositoryFiles().length} tracked file(s) were read before ${bundlesOnDisk.length} of them were called bundles`,
  trackedRepositoryFiles().length > GENERATED_BUNDLES.length && bundlesOnDisk.length > 0,
  "the tracked listing or the banner search came back empty, so a sweep that read nothing would agree with any list",
);

describe(
  `${THE_ONE_LIST} names every generated bundle in the tree exactly once, and the build scripts that write them read ` +
    "that list instead of spelling their own output paths",
  () => {
    test("the bundles the tree carries and the bundles the list names are the same set", () => {
      assert.deepEqual(
        [...bundlesOnDisk].sort(),
        [...GENERATED_BUNDLES].sort(),
        "a tracked file carries a bundler source banner that the list does not name, or the list names a path no " +
          "bundle occupies — either way the abstraction scan counts a generated copy as a use site",
      );
    });

    test("no path is named twice", () => {
      assert.deepEqual([...GENERATED_BUNDLES], [...new Set(GENERATED_BUNDLES)]);
    });

    for (const script of BUILD_SCRIPTS_THAT_WRITE_THEM) {
      test(`${script} imports ${THE_ONE_LIST} and spells no output path of its own`, () => {
        const { text } = readTrackedText(script);
        assert.ok(text.includes(THE_ONE_LIST), `${script} never reads ${THE_ONE_LIST}, so its outputs are its own secret`);
        const owned = PATH_LITERALS_THE_ONE_LIST_OWNS.filter((literal) => quotedLiteralsIn(text).has(literal));
        assert.deepEqual(
          owned,
          [],
          `${script} still spells ${owned.join(", ")} itself, so the list and the build can drift apart silently`,
        );
      });
    }
  },
);
