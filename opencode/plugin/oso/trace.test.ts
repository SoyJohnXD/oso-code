import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TRACE_SINK_ORDER, recordTrace } from "./trace.ts";

function fixtureDir(): string {
  return mkdtempSync(join(tmpdir(), "oso-trace-test-"));
}

function eventsLogUnder(dir: string): string {
  return join(dir, "state", "events.jsonl");
}

function stateRootTheSinkCanWrite(dir: string): string {
  return join(dir, "state");
}

function stateRootNoDirectoryCanBe(dir: string): string {
  const blocking = join(dir, "a-regular-file");
  writeFileSync(blocking, "");
  return join(blocking, "state");
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

test("every sink is attempted in that order and reported back, the state one writing the run's own event log", () => {
  const dir = fixtureDir();
  const toastCalls: unknown[] = [];
  const client = { tui: { showToast: (input: unknown) => { toastCalls.push(input); } } };
  const results = withEnv("OSO_STATE_DIR", stateRootTheSinkCanWrite(dir), () =>
    withConsoleError(() =>
      recordTrace({ origin: "test-origin", detail: "test-detail", sessionID: "ses-1", client }),
    ),
  );
  assert.deepEqual(results.map((r) => r.sink), ["state", "log", "toast"]);
  assert.equal(results.every((r) => r.ok), true);
  assert.equal(toastCalls.length, 1);
  assert.match(readFileSync(eventsLogUnder(dir), "utf8"), /"event":"test-origin"[\s\S]*"session":"ses-1"/);
  rmSync(dir, { recursive: true, force: true });
});

test("a missing sessionID leaves the state sink unavailable without writing anything", () => {
  const dir = fixtureDir();
  const results = withEnv("OSO_STATE_DIR", stateRootTheSinkCanWrite(dir), () =>
    withConsoleError(() => recordTrace({ origin: "install-check", detail: "no session yet" })),
  );
  const stateResult = results.find((r) => r.sink === "state");
  assert.equal(stateResult?.ok, false);
  assert.equal(existsSync(eventsLogUnder(dir)), false);
  rmSync(dir, { recursive: true, force: true });
});

test("a state sink that cannot write is reported once on the log line, never retried", () => {
  const dir = fixtureDir();
  const lines = withEnv("OSO_STATE_DIR", stateRootNoDirectoryCanBe(dir), () =>
    withConsoleError((captured) => {
      recordTrace({ origin: "test-origin", detail: "boom", sessionID: "ses-1" });
      return captured;
    }),
  );
  assert.equal(existsSync(eventsLogUnder(dir)), false);
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
