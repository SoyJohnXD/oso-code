import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readTrackedText } from "../support/tracked-files.ts";

const rubric = readTrackedText("plugin/skills/_shared/rubric.md").text;
const applierContract = readTrackedText("core/src/prose/agents/oso-applier/body.md").text;
const verifierContract = readTrackedText("core/src/prose/agents/oso-verifier/body.md").text;

describe("registered generated-output comments remain visible candidates", () => {
  test("the rubric distinguishes builder annotations from source comments and manual output", () => {
    assert.match(rubric, /verified builder-inserted annotation in a registered generated output/);
    assert.match(rubric, /exact regeneration/i);
    assert.match(rubric, /source-authored comments remain debt/i);
    assert.match(rubric, /unregistered or manually edited outputs receive no exemption/);
  });

  test("the applier report names registered generated-output candidates as evidence-limited hits", () => {
    assert.match(applierContract, /registered generated-output candidates/);
    assert.match(applierContract, /regeneration evidence/);
    assert.match(applierContract, /verified builder-inserted annotation/);
    assert.match(applierContract, /source-authored comments remain debt/i);
    assert.match(applierContract, /unregistered or manually edited outputs receive no exemption/);
  });

  test("the verifier keeps the generated-output distinction inside gate 7 and preserves nine gates", () => {
    const gate7 = verifierContract.match(/^7\. (.+)$/m)?.[1] ?? "";
    assert.match(gate7, /registered generated-output hits separately as candidates/);
    assert.match(gate7, /exact regeneration/);
    assert.match(gate7, /source-authored comments/);
    assert.match(gate7, /manually edited outputs/);
    assert.equal([...verifierContract.matchAll(/^\d+\. /gm)].length, 9);
  });
});
