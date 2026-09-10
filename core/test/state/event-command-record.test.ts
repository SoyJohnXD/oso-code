import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MAX_LEXED_INPUT_BYTES } from "../../src/shell/lexer.ts";
import { logEvent } from "../../src/state/store.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";
import { withStateSandbox } from "../support/state-sandbox.ts";

const THE_HEAD_THIS_RECORD_ONCE_KEPT = 120;
const FIELDS_AN_EXISTING_READER_NAMES = ["ts", "event", "command", "session", "client", "schema"];

const A_SET_THEN_COMMIT_LINE =
  '"${OSO_STATE_BIN:-oso-state}" --session 01234567-89ab-cdef-0123-456789abcdef set mode=plan ' +
  'active_slice=S3 verify_green=true && git commit -m "feat(gates): close the production residue hole"';

type RecordedEvent = Readonly<Record<string, unknown>>;

function recordOf(command: string): RecordedEvent {
  return withStateSandbox("workspace", (sandbox) =>
    withHookEnvironment({ HOME: sandbox.home }, () => {
      logEvent({ event: "residue-allowed", session: "test-session", command });
      const [line] = sandbox.eventLogLines();
      return JSON.parse(line as string) as RecordedEvent;
    }),
  );
}

describe("core/src/state/store.ts: the event record holds every byte the boundary could have read", () => {
  test(`a ${Buffer.byteLength(A_SET_THEN_COMMIT_LINE)}-byte set-then-commit line is recorded whole, not as its head`, () => {
    assert.ok(Buffer.byteLength(A_SET_THEN_COMMIT_LINE) > THE_HEAD_THIS_RECORD_ONCE_KEPT);
    const record = recordOf(A_SET_THEN_COMMIT_LINE);
    assert.equal(record["command"], A_SET_THEN_COMMIT_LINE);
    assert.deepEqual(Object.keys(record), FIELDS_AN_EXISTING_READER_NAMES);
    assert.equal(record["schema"], 2);
  });

  test("a line past the bound is cut, and the record names the length it was cut from", () => {
    const command = "x".repeat(MAX_LEXED_INPUT_BYTES + 100);
    const record = recordOf(command);
    assert.equal(Buffer.byteLength(record["command"] as string), MAX_LEXED_INPUT_BYTES);
    assert.equal(record["command_bytes"], MAX_LEXED_INPUT_BYTES + 100);
    assert.deepEqual(Object.keys(record), [...FIELDS_AN_EXISTING_READER_NAMES, "command_bytes"]);
  });

  test("a cut landing inside a multi-byte character keeps the record valid UTF-8", () => {
    const head = "x".repeat(MAX_LEXED_INPUT_BYTES - 1);
    const record = recordOf(`${head}é tail`);
    assert.equal(record["command"], head);
    assert.equal(record["command_bytes"], Buffer.byteLength(`${head}é tail`));
  });
});
