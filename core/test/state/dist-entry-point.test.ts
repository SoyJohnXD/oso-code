import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import {
  repositoryRoot,
  skipUnlessSpawnable,
  withStateSandbox,
  type StateSubject,
} from "../support/state-sandbox.ts";

const DIST_ENTRY_POINT: StateSubject = {
  name: "node plugin/dist/oso-state.js",
  command: ["node", path.join(repositoryRoot, "plugin", "dist", "oso-state.js")],
};

describe(`${DIST_ENTRY_POINT.name}: the bundle the executable wraps`, { skip: skipUnlessSpawnable(DIST_ENTRY_POINT) }, () => {
  test("it starts, prints its usage on stderr for no argument and exits 1", () => {
    const run = withStateSandbox("workspace", (sandbox) => sandbox.run(DIST_ENTRY_POINT, []));
    assert.equal(run.exit, 1, `stderr was ${JSON.stringify(run.stderr)}`);
    assert.match(run.stderr, /^usage: oso-state /);
    assert.equal(run.stdout, "");
  });
});
