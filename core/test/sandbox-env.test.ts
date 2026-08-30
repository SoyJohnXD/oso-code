import assert from "node:assert/strict";
import { userInfo } from "node:os";
import { test } from "node:test";

test("the test run's HOME is pinned away from the developer's real home", () => {
  assert.notEqual(process.env.HOME, userInfo().homedir);
});
