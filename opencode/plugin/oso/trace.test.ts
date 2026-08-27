import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TRACE_SINK_ORDER, recordTrace } from "./trace.ts";

function fixtureDir(): string {
  return mkdtempSync(join(tmpdir(), "oso-trace-test-"));
}

function fakeStateBin(dir: string, exitCode: number): string {
  const path = join(dir, "oso-state");
  const callsFile = join(dir, "calls");
  const script = [
    `const { appendFileSync } = require("node:fs");`,
    `appendFileSync(${JSON.stringify(callsFile)}, process.argv.slice(2).join(" ") + "\\n");`,
    `process.exit(${exitCode});`,
    "",
  ].join("\n");
  writeFileSync(path, script);
  return path;
}

function withConsoleError<T>(run: (lines: string[]) => T): T {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    return run(lines);
  } finally {
    console.error = original;
  }
}

function withEnv<T>(key: string, value: string | undefined, run: () => T): T {
  const original = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  try {
    return run();
  } finally {
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
}

test("sink precedence is state, then log, then toast", () => {
  assert.deepEqual(TRACE_SINK_ORDER, ["state", "log", "toast"]);
});

test("every sink is attempted in that order and reported back", () => {
  const dir = fixtureDir();
  const bin = fakeStateBin(dir, 0);
  const toastCalls: unknown[] = [];
  const client = { tui: { showToast: (input: unknown) => { toastCalls.push(input); } } };
  const results = withEnv("OSO_STATE_BIN", bin, () =>
    withConsoleError(() =>
      recordTrace({ origin: "test-origin", detail: "test-detail", sessionID: "ses-1", client }),
    ),
  );
  assert.deepEqual(results.map((r) => r.sink), ["state", "log", "toast"]);
  assert.equal(results.every((r) => r.ok), true);
  assert.equal(toastCalls.length, 1);
  rmSync(dir, { recursive: true, force: true });
});

test("a missing sessionID leaves the state sink unavailable without spawning anything", () => {
  const dir = fixtureDir();
  const bin = fakeStateBin(dir, 0);
  const results = withEnv("OSO_STATE_BIN", bin, () =>
    withConsoleError(() => recordTrace({ origin: "install-check", detail: "no session yet" })),
  );
  const stateResult = results.find((r) => r.sink === "state");
  assert.equal(stateResult?.ok, false);
  assert.throws(() => readFileSync(join(dir, "calls"), "utf8"));
  rmSync(dir, { recursive: true, force: true });
});

test("a failing state sink is never retried, and the log line records the state failure once", () => {
  const dir = fixtureDir();
  const bin = fakeStateBin(dir, 1);
  const lines = withEnv("OSO_STATE_BIN", bin, () =>
    withConsoleError((captured) => {
      recordTrace({ origin: "test-origin", detail: "boom", sessionID: "ses-1" });
      return captured;
    }),
  );
  const calls = readFileSync(join(dir, "calls"), "utf8").trim().split("\n");
  assert.equal(calls.length, 1);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /state sink also failed/);
  rmSync(dir, { recursive: true, force: true });
});

test("the toast variant follows severity: enforcement is error, advisory is warning", () => {
  const toastCalls: { body: { variant: string } }[] = [];
  const client = { tui: { showToast: (input: { body: { variant: string } }) => { toastCalls.push(input); } } };
  withConsoleError(() =>
    recordTrace({ origin: "install-check", detail: "not installed", severity: "enforcement", client }),
  );
  withConsoleError(() =>
    recordTrace({ origin: "lifecycle.sweep", detail: "unreadable repo", severity: "advisory", client }),
  );
  assert.equal(toastCalls[0]?.body.variant, "error");
  assert.equal(toastCalls[1]?.body.variant, "warning");
});

test("a client with no toast surface leaves the toast sink unavailable without throwing", () => {
  const results = withConsoleError(() => recordTrace({ origin: "shell.env", detail: "no client here" }));
  const toastResult = results.find((r) => r.sink === "toast");
  assert.equal(toastResult?.ok, false);
});

test("a throwing toast function never escapes recordTrace", () => {
  const client = { tui: { showToast: () => { throw new Error("toast exploded"); } } };
  const results = withConsoleError(() => recordTrace({ origin: "chat.message", detail: "boom", client }));
  const toastResult = results.find((r) => r.sink === "toast");
  assert.equal(toastResult?.ok, false);
});
