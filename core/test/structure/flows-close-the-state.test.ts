import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readTrackedText } from "../support/tracked-files.ts";

const CLOSING_FLOWS = ["plan", "quick", "debug"] as const;
const CLOSE_VERB = /`oso-state close`/;
const CLEAR_VERB = /`oso-state clear`/;
const ABANDON_WORDING = /\b(?:abandon|walks? away)/i;

function abandonSentencesRoutingToClear(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter((sentence) => ABANDON_WORDING.test(sentence) && CLEAR_VERB.test(sentence));
}

describe("plan, quick and debug release the gates with oso-state close", () => {
  for (const flow of CLOSING_FLOWS) {
    const { text } = readTrackedText(`plugin/skills/${flow}/SKILL.md`);

    test(`${flow} names close, and its abandon route no longer sends the flow to clear`, () => {
      assert.match(text, CLOSE_VERB, `${flow} never names oso-state close`);
      assert.deepEqual(abandonSentencesRoutingToClear(text), [], `${flow} still routes its abandon through oso-state clear`);
    });
  }
});
