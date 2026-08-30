import assert from "node:assert/strict";
import { test } from "node:test";

export function provedSomething(claim: string, provedAnything: boolean, unprovenReport: string): void {
  test(`${claim}, or this suite proved nothing`, () => {
    assert.ok(provedAnything, unprovenReport);
  });
}
