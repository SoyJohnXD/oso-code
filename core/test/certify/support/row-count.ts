import { test, type TestContext } from "node:test";
import { CERTIFY_GUARD } from "./certify-guard.ts";

export const CONTRACT_BAR_ROWS_PORTED = 7;

let registered = 0;

export function contractBarRowsRegistered(): number {
  return registered;
}

export function contractBarRow(name: string, run: (t: TestContext) => void | Promise<void>): void {
  registered += 1;
  test(name, CERTIFY_GUARD, run);
}
