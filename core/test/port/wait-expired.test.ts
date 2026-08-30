import assert from "node:assert/strict";
import { test } from "node:test";
import { waitExpired } from "../../src/gates/delegation.ts";

const CEILING_SECONDS = 45 * 60;
const NOW = 1_000_000;

test(
  "waitExpired reports false one second under the 45-minute ceiling (port of plugin/hooks/auto-continue.sh:91, no parity fixture)",
  () => {
    assert.equal(waitExpired(NOW, NOW - (CEILING_SECONDS - 1)), false);
  },
);

test(
  "waitExpired reports true exactly at the 45-minute ceiling (port of plugin/hooks/auto-continue.sh:91, no parity fixture)",
  () => {
    assert.equal(waitExpired(NOW, NOW - CEILING_SECONDS), true);
  },
);

test(
  "waitExpired reports true well past the ceiling (port of plugin/hooks/auto-continue.sh:91, no parity fixture)",
  () => {
    assert.equal(waitExpired(NOW, NOW - CEILING_SECONDS * 10), true);
  },
);

test("waitExpired reports false for a mark made this instant", () => {
  assert.equal(waitExpired(NOW, NOW), false);
});
