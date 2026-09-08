import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CODEX_STOP_CONTINUED_MESSAGE,
  CODEX_STOP_FIRST_MESSAGE,
  type CodexStopProbeExecution,
  runCodexStopProbe,
  validateCodexStopProbe,
} from "./codex-stop-drive.ts";

function nativeStream(messages: readonly string[]): string {
  return [
    JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
    ...messages.map((text, index) =>
      JSON.stringify({ type: "item.completed", item: { id: `item-${index}`, type: "agent_message", text } }),
    ),
  ].join("\n");
}

function stopEvents(count: number): string {
  return Array.from({ length: count }, (_, index) =>
    JSON.stringify({
      index: index + 1,
      event: "Stop",
      active: index === 1,
      first: index === 0,
      second: index === 1,
    }),
  ).join("\n");
}

function execution(overrides: Partial<CodexStopProbeExecution> = {}): CodexStopProbeExecution {
  return {
    status: 0,
    signal: null,
    timedOut: false,
    spawnFailure: undefined,
    stdout: nativeStream([CODEX_STOP_FIRST_MESSAGE, CODEX_STOP_CONTINUED_MESSAGE]),
    stderr: "",
    stopEvents: stopEvents(2),
    ...overrides,
  };
}

test("the native Codex response and Stop observations certify one continuation without user input", () => {
  const result = validateCodexStopProbe(execution());
  assert.equal(result.kind, "measured");
});

test("the authenticated Codex probe refuses to run without both certification gates", () => {
  for (const environment of [{}, { OSO_CERTIFY: "1" }]) {
    const result = runCodexStopProbe(environment);
    assert.equal(result.kind, "not-run");
    if (result.kind === "not-run") assert.match(result.reason, /is required/);
  }
});

test("extra or incorrect messages cannot certify the native route", () => {
  for (const messages of [
    [CODEX_STOP_FIRST_MESSAGE, CODEX_STOP_CONTINUED_MESSAGE, "extra"],
    [CODEX_STOP_CONTINUED_MESSAGE, CODEX_STOP_FIRST_MESSAGE],
  ]) {
    assert.equal(validateCodexStopProbe(execution({ stdout: nativeStream(messages) })).kind, "invalid");
  }
});

test("malformed, extra, or incorrect Stop observations cannot certify the native route", () => {
  for (const observations of [
    "not-json",
    "null",
    "{}",
    stopEvents(3),
    stopEvents(2).replace('"active":true', '"active":false'),
    stopEvents(2).replace('"event":"Stop"', '"event":"Other"'),
  ]) {
    assert.equal(validateCodexStopProbe(execution({ stopEvents: observations })).kind, "invalid");
  }
});

test("a hook that never ran cannot certify the continuation", () => {
  const result = validateCodexStopProbe(execution({ stopEvents: "" }));
  assert.equal(result.kind, "invalid");
  if (result.kind === "invalid") assert.match(result.reason, /Stop hook ran 0 time/);
});

test("a first response without its continuation cannot certify the native route", () => {
  const result = validateCodexStopProbe(execution({ stdout: nativeStream([CODEX_STOP_FIRST_MESSAGE]), stopEvents: stopEvents(1) }));
  assert.equal(result.kind, "invalid");
  if (result.kind === "invalid") assert.match(result.reason, /carried 1 agent messages/);
});

test("a missing second Stop observation cannot certify the native route", () => {
  const result = validateCodexStopProbe(execution({ stopEvents: stopEvents(1) }));
  assert.equal(result.kind, "invalid");
  if (result.kind === "invalid") assert.match(result.reason, /Stop hook ran 1 time/);
});

test("a malformed native stream cannot certify the route", () => {
  const result = validateCodexStopProbe(execution({ stdout: "not-json\n" }));
  assert.equal(result.kind, "invalid");
  if (result.kind === "invalid") assert.match(result.reason, /stream line 1 was not JSON/);
});

test("a nonzero native process cannot certify the route", () => {
  const result = validateCodexStopProbe(execution({ status: 1 }));
  assert.equal(result.kind, "invalid");
  if (result.kind === "invalid") assert.match(result.reason, /codex exec exited 1/);
});

test("a timed-out native process cannot certify the route", () => {
  const result = validateCodexStopProbe(execution({ timedOut: true }));
  assert.equal(result.kind, "invalid");
  if (result.kind === "invalid") assert.match(result.reason, /exceeded its/);
});

test("malformed JSON retains the parser cause and stream line context", () => {
  const malformed = "{";
  let parserCause = "";
  try {
    JSON.parse(malformed);
  } catch (error) {
    assert.ok(error instanceof SyntaxError);
    parserCause = error.message;
  }
  assert.notEqual(parserCause, "");
  for (const [field, stream] of [
    ["stdout", "native stream"],
    ["stopEvents", "Stop observation"],
  ] as const) {
    const result = validateCodexStopProbe(execution({ [field]: `\n  \n${malformed}` }));
    assert.deepEqual(result, { kind: "invalid", reason: `${stream} line 3 was not JSON: ${parserCause}` });
  }
});
