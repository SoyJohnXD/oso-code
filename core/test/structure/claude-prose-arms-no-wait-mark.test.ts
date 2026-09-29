import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText, trackedRepositoryFiles } from "../support/tracked-files.ts";

const CLAUDE_LOADED_PREFIX = "plugin/skills/";
const OPENCODE_REFERENCE_SUFFIX = "/references/opencode.md";
const CLAUDE_SHARED_REFERENCE = "plugin/skills/_shared/references/claude.md";

const RETIRED_WAIT_WORDING = [/auto_wait=/, /\b45[- ]minute/i];

const WATCH_COMMAND = '"${OSO_STATE_BIN:-oso-state}" --session "${CLAUDE_CODE_SESSION_ID}" watch';

const CLAUDE_LOADED_FILES_FLOOR = 20;

const claudeLoadedFiles = trackedRepositoryFiles().filter(
  (file) => file.startsWith(CLAUDE_LOADED_PREFIX) && file.endsWith(".md") && !file.endsWith(OPENCODE_REFERENCE_SUFFIX),
);

provedSomething(
  `${claudeLoadedFiles.length} Claude-loaded prose file(s) were scanned for the retired wait mark`,
  claudeLoadedFiles.length >= CLAUDE_LOADED_FILES_FLOOR,
  `only ${claudeLoadedFiles.length} file(s) were found under ${CLAUDE_LOADED_PREFIX}, under the ${CLAUDE_LOADED_FILES_FLOOR}-file floor`,
);

function retiredWaitHits(file: string): string[] {
  return readTrackedText(file)
    .text.split("\n")
    .flatMap((line, index) =>
      RETIRED_WAIT_WORDING.filter((pattern) => pattern.test(line)).map((pattern) => `${file}:${index + 1}: ${pattern}`),
    );
}

function paragraphsOf(file: string): string[] {
  return readTrackedText(file).text.split(/\n\s*\n/);
}

describe("no Claude-loaded prose arms the retired auto_wait mark or its 45-minute bound", () => {
  test("no line under plugin/skills/ outside an OpenCode reference spells auto_wait=<label> or the 45-minute mark", () => {
    const hits = claudeLoadedFiles.flatMap(retiredWaitHits);
    assert.deepEqual(hits, [], hits.join("\n"));
  });
});

describe("the Claude shared reference binds the watchdog wake in place of the wait mark", () => {
  const paragraphs = paragraphsOf(CLAUDE_SHARED_REFERENCE);

  test("one paragraph starts the watch verb as a background Bash task and ends the turn", () => {
    const watchRule = paragraphs.filter(
      (paragraph) =>
        paragraph.includes(WATCH_COMMAND) && paragraph.includes("run_in_background") && /end the turn/i.test(paragraph),
    );
    assert.equal(watchRule.length, 1, `paragraphs naming the watch rule: ${watchRule.length}`);
  });

  test("one paragraph routes exit 3 to a journal line and a stream line naming the id, and never calls a delegation lost", () => {
    const exitThreeRule = paragraphs.filter(
      (paragraph) =>
        /\bexits? 3\b/i.test(paragraph) &&
        paragraph.includes("oso-state journal") &&
        /stream/.test(paragraph) &&
        /\bid\b/.test(paragraph) &&
        paragraph.includes("agent_type") &&
        /never call[^.]*\blost\b/i.test(paragraph),
    );
    assert.equal(exitThreeRule.length, 1, `paragraphs naming the exit-3 rule: ${exitThreeRule.length}`);
  });
});
