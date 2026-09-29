import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText, trackedRepositoryFiles } from "../support/tracked-files.ts";

const PROSE_SOURCE_PREFIX = "core/src/prose/";
const OPENCODE_PROSE_SOURCE_SUFFIX = "opencode.md";
const OPENCODE_RENDERED_PREFIXES = ["opencode/skills/", "opencode/commands/"];

const OPENCODE_PROSE_FILES_FLOOR = 12;

const RETIRED_MECHANISMS: readonly RegExp[] = [
  /unattended-run\.ts/,
  /\b45[- ]minute/i,
  /\.waiting/,
  /auto_wait/,
  /journal growth/i,
  /moved the (run )?journal/i,
];

const openCodeProseFiles = trackedRepositoryFiles().filter(
  (file) =>
    file.endsWith(".md") &&
    ((file.startsWith(PROSE_SOURCE_PREFIX) && file.endsWith(OPENCODE_PROSE_SOURCE_SUFFIX)) ||
      OPENCODE_RENDERED_PREFIXES.some((prefix) => file.startsWith(prefix))),
);

provedSomething(
  `${openCodeProseFiles.length} OpenCode prose file(s) were scanned for retired mechanisms`,
  openCodeProseFiles.length >= OPENCODE_PROSE_FILES_FLOOR,
  `only ${openCodeProseFiles.length} file(s) were found, under the ${OPENCODE_PROSE_FILES_FLOOR}-file floor`,
);

function retiredMechanismHits(file: string, text: string): string[] {
  return text
    .split("\n")
    .flatMap((line, index) =>
      RETIRED_MECHANISMS.filter((pattern) => pattern.test(line)).map((pattern) => `${file}:${index + 1}: ${pattern}`),
    );
}

describe("OpenCode prose names no mechanism this host retired", () => {
  test("no OpenCode prose source or rendered copy spells a retired mechanism", () => {
    const hits = openCodeProseFiles.flatMap((file) => retiredMechanismHits(file, readTrackedText(file).text));
    assert.deepEqual(hits, [], hits.join("\n"));
  });

  test("the scan catches each retired mechanism when one is planted", () => {
    const planted = [
      "read by opencode/plugin/oso/unattended-run.ts",
      "a 45-minute bound",
      "a 45 minute bound",
      "the .waiting sidecar",
      "the auto_wait key",
      "journal growth resets it",
      "a turn that moved the run journal nowhere",
    ];
    for (const line of planted) {
      assert.equal(retiredMechanismHits("planted.md", line).length, 1, line);
    }
    assert.deepEqual(retiredMechanismHits("clean.md", "progress is a commit or a child completion"), []);
  });
});
