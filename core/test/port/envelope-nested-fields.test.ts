import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { jsonField } from "../../src/hosts/envelope.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";

type FieldReading = Readonly<{ payload: string; field: string; value: string }>;

const A_DECOY_UNDER_THE_TOOL_INPUT =
  '{"session_id":"s1","cwd":"/r","hook_event_name":"PreToolUse","tool_name":"Bash",' +
  '"tool_input":{"x":{"command":"echo benign"},"command":"vercel deploy --prod"}}';

const PARENT_BEFORE_CHILD: readonly FieldReading[] = [
  { payload: A_DECOY_UNDER_THE_TOOL_INPUT, field: "command", value: "vercel deploy --prod" },
  {
    payload: '{"a":{"b":{"command":"echo benign"}},"tool_input":{"command":"vercel deploy --prod"}}',
    field: "command",
    value: "echo benign",
  },
  {
    payload: '{"command":"vercel deploy --prod","tool_input":{"command":"echo benign"}}',
    field: "command",
    value: "vercel deploy --prod",
  },
  {
    payload: '{"command":42,"tool_input":{"command":"vercel deploy --prod"}}',
    field: "command",
    value: "vercel deploy --prod",
  },
  {
    payload: '{"command":null,"tool_input":{"command":"vercel deploy --prod"}}',
    field: "command",
    value: "vercel deploy --prod",
  },
  {
    payload: '{"command":{"nested":"object"},"tool_input":{"command":"vercel deploy --prod"}}',
    field: "command",
    value: "vercel deploy --prod",
  },
  {
    payload: '{"content":[{"noise":"n"},{"command":"vercel deploy --prod"}]}',
    field: "command",
    value: "vercel deploy --prod",
  },
  { payload: '{"session_id":"s1","cwd":"/r"}', field: "command", value: "" },
  {
    payload: '{"outer":{"session_id":"nested"},"session_id":"outer"}',
    field: "session_id",
    value: "outer",
  },
  {
    payload: '{"tool_input":{"deep":{"prompt":"decoy"}},"prompt":"the real prompt"}',
    field: "prompt",
    value: "the real prompt",
  },
  {
    payload: '{"tool_input":{"command":"carriage\\r\\nreturn"}}',
    field: "command",
    value: "carriage\nreturn",
  },
];

const NESTING_PAST_THE_RECURSION = 20000;

function nestedUnder(depth: number, leaf: string): string {
  return `${'{"nested":'.repeat(depth)}${leaf}${"}".repeat(depth)}`;
}

const A_BURIED_DECOY = nestedUnder(NESTING_PAST_THE_RECURSION, '{"command":"the decoy"}');

const A_COMMAND_BURIED_PAST_THE_RECURSION =
  `{"tool_input":${nestedUnder(NESTING_PAST_THE_RECURSION, '{"command":"vercel deploy --prod"}')}}`;

const A_DECOY_BURIED_UNDER_THE_REAL_COMMAND =
  `{"tool_input":{"command":"the real command","deeper":${A_BURIED_DECOY}}}`;

const A_DECOY_BURIED_IN_AN_EARLIER_SIBLING =
  `{"earlier":${A_BURIED_DECOY},"tool_input":{"command":"the real command"}}`;

const AN_INTEGER_KEY_JAVASCRIPT_HOISTS: readonly FieldReading[] = [
  {
    payload: '{"1":{"command":"the decoy"},"command":"the real command"}',
    field: "command",
    value: "the real command",
  },
  {
    payload: '{"tool_input":{"1":{"command":"the decoy"},"command":"the real command"}}',
    field: "command",
    value: "the real command",
  },
  {
    payload: '{"7":{"deep":{"prompt":"the decoy"}},"a":{"prompt":"the real prompt"},"prompt":"the outer prompt"}',
    field: "prompt",
    value: "the outer prompt",
  },
];

const A_PAYLOAD_JSON_PARSE_REFUSES = '{"tool_input":{"x":{"command":"echo benign"},"command":"vercel deploy --prod"}';

describe(
  "core/src/hosts/envelope.ts: a field is the first string that key carries in a parent-before-child walk of " +
    "the parsed payload, which is what the bash reader's jq took wherever the platform had jq " +
    "(plugin/hooks/lib.sh:320-327), never the first textual occurrence in the raw bytes",
  () => {
    for (const { payload, field, value } of PARENT_BEFORE_CHILD) {
      test(`${JSON.stringify(field)} reads ${JSON.stringify(value)} out of ${JSON.stringify(payload)}`, () => {
        assert.equal(jsonField(payload, field), value);
      });
    }

    test("a nested decoy no longer wins the command line the production boundary lexes", () => {
      assert.equal(spawnedEnvelope(A_DECOY_UNDER_THE_TOOL_INPUT, {}).commandLine, "vercel deploy --prod");
    });
  },
);

describe(
  "core/src/hosts/envelope.ts: a payload JSON.parse refuses falls back to the byte-ordered pattern reader, " +
    "which is the jq-absent branch of plugin/hooks/lib.sh:320-327 and the reading the payload-unparseable " +
    "allow path is built on",
  () => {
    test("the truncated payload still yields the pattern reader's first textual occurrence", () => {
      assert.equal(jsonField(A_PAYLOAD_JSON_PARSE_REFUSES, "command"), "echo benign");
    });

    test("a payload that is not JSON at all names no field", () => {
      assert.equal(jsonField("this payload is not JSON", "command"), "");
    });
  },
);

describe(
  "core/src/hosts/envelope.ts: the escaped fields stay on the pattern reader whatever the payload parses to, " +
    "because plugin/hooks/lib.sh:336-343 read them that way with jq present and absent alike",
  () => {
    test("the escaped prompt keeps the byte-first reading the parsed prompt no longer takes", () => {
      const payload = '{"tool_input":{"prompt":"decoy prompt"},"prompt":"the real prompt"}';
      const envelope = spawnedEnvelope(payload, {});
      assert.deepEqual(
        { prompt: envelope.prompt, escaped: envelope.escapedPrompt },
        { prompt: "the real prompt", escaped: "decoy prompt" },
      );
    });
  },
);

describe(
  "core/src/hosts/envelope.ts: the walk carries no recursion, so nesting deeper than any call stack reads the " +
    "same field the shallow payloads above read rather than throwing past every gate's own error handling",
  () => {
    test(`a command buried ${NESTING_PAST_THE_RECURSION} level(s) deep still reads`, () => {
      assert.equal(jsonField(A_COMMAND_BURIED_PAST_THE_RECURSION, "command"), "vercel deploy --prod");
    });

    test(`a decoy buried ${NESTING_PAST_THE_RECURSION} level(s) under the real command loses to it`, () => {
      assert.equal(jsonField(A_DECOY_BURIED_UNDER_THE_REAL_COMMAND, "command"), "the real command");
    });

    test(`a decoy buried ${NESTING_PAST_THE_RECURSION} level(s) in an earlier sibling wins, as jq's walk has it`, () => {
      assert.equal(jsonField(A_DECOY_BURIED_IN_AN_EARLIER_SIBLING, "command"), "the decoy");
    });
  },
);

describe(
  "core/src/hosts/envelope.ts: a node's own field is read before any descendant of it, which is what keeps " +
    "JavaScript's hoisting of integer-like keys ahead of their siblings — an ordering jq does not share — off " +
    "every field a hook payload names at a fixed place",
  () => {
    for (const { payload, field, value } of AN_INTEGER_KEY_JAVASCRIPT_HOISTS) {
      test(`${JSON.stringify(field)} reads ${JSON.stringify(value)} out of ${JSON.stringify(payload)}`, () => {
        assert.equal(jsonField(payload, field), value);
      });
    }
  },
);
