import assert from "node:assert/strict";
import { test } from "node:test";
import { readTrackedText } from "../support/tracked-files.ts";

const VERSION_PINS = "core/src/install/pins.ts";
const PARITY_LEDGER = "docs/parity-opencode.md";

test("the OpenCode parity ledger names exactly the version pinned by the installer", () => {
  const pins = readTrackedText(VERSION_PINS).text;
  const ledger = readTrackedText(PARITY_LEDGER).text;
  const pin = pins.match(/^export const SUPPORTED_OPENCODE_VERSION = "(.*)";$/m)?.[1];
  assert.ok(pin !== undefined, `${VERSION_PINS} carries no OpenCode version pin`);

  const named = [...ledger.matchAll(/OpenCode (\d+\.\d+\.\d+)/g)].map((match) => match[1]);
  const unique = [...new Set(named)];
  assert.deepEqual(unique, [pin]);
});
