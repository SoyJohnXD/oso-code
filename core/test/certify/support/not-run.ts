import type { TestContext } from "node:test";

export function notRun(t: TestContext, reason: string): void {
  t.skip(`not-run: ${reason}`);
}
