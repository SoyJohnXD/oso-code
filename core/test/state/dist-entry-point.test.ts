import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  skipUnlessSpawnable,
  STATE_BUNDLE,
  withStateSandbox,
} from "../support/state-sandbox.ts";

describe(`${STATE_BUNDLE.name}: the bundle the executable wraps`, { skip: skipUnlessSpawnable(STATE_BUNDLE) }, () => {
  test("it starts, prints its usage on stderr for no argument and exits 1", () => {
    const run = withStateSandbox("workspace", (sandbox) => sandbox.run(STATE_BUNDLE, []));
    assert.equal(run.exit, 1, `stderr was ${JSON.stringify(run.stderr)}`);
    assert.match(run.stderr, /^usage: oso-state /);
    assert.equal(run.stdout, "");
  });
});
