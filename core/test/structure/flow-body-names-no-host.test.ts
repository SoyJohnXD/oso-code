import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SKILL_STUBS, flowBody, skillFlowPath } from "../../src/prose/render.ts";
import { readTextAtCommit } from "../support/prose-inventory.ts";
import { provedSomething } from "../support/proved.ts";
import { readTrackedText } from "../support/tracked-files.ts";

const RED_COMMIT = "188cfce";
const HOST_NAME_PATTERN = /\bClaude(?: Code)?\b|\bCodex\b|\bOpenCode\b/g;
const SHARED_FLOW_FILES = ["plugin/skills/_shared/unattended.md", "plugin/skills/_shared/parallel.md"];
const FLOW_FILES_FLOOR = 11;
const FLOW_FILES_FLOOR_DERIVATION =
  "the 9 plugin/skills/<skill>/SKILL.md flows core/src/prose/routes.ts's SKILL_STUBS names, plus the 2 shared bodies " +
  "C5-D2 names by hand: _shared/unattended.md, _shared/parallel.md";

const flowFiles = [...SKILL_STUBS.map((stub) => skillFlowPath(stub)), ...SHARED_FLOW_FILES];

function hostNameHits(file: string, rawFlowText: string): string[] {
  return [...flowBody(rawFlowText).matchAll(HOST_NAME_PATTERN)].map((match) => `${file}: "${match[0]}"`);
}

provedSomething(
  `${flowFiles.length} flow file(s) had their body scanned for a host name`,
  flowFiles.length >= FLOW_FILES_FLOOR,
  `only ${flowFiles.length} file(s) were found, under the ${FLOW_FILES_FLOOR}-file floor (${FLOW_FILES_FLOOR_DERIVATION})`,
);

describe("a flow body names no host — the reference file is where a host name belongs, never the flow itself", () => {
  test(`RED at ${RED_COMMIT}: the sites C5-D2 found still carry a host name in their own blobs`, () => {
    const hits = flowFiles.flatMap((file) => hostNameHits(file, readTextAtCommit(RED_COMMIT, file)));
    assert.equal(hits.length, 4, hits.join("\n"));
  });

  test("GREEN on the tracked tree: no flow body carries a host name", () => {
    const hits = flowFiles.flatMap((file) => hostNameHits(file, readTrackedText(file).text));
    assert.deepEqual(hits, [], hits.join("\n"));
  });
});
