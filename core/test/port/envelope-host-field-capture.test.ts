import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hostEnvelope, type HookCaller, type HookEnvelope } from "../../src/hosts/envelope.ts";

type HookTextField = keyof Omit<HookEnvelope, "caller" | "payloadRead" | "stopHookActive">;

const A_HOST_COMPOSING_A_GATE_CALL: HookCaller = {
  host: "opencode",
  agentSession: "ses-owner",
  stateBin: "/usr/local/bin/oso-state",
};

const PRODUCTION_DEPLOY = "vercel deploy --prod";

function everyTextFieldCarrying(value: string): Readonly<Record<HookTextField, string>> {
  return {
    sessionId: value,
    cwd: value,
    toolName: value,
    filePath: value,
    commandLine: value,
    source: value,
    agentId: value,
    agentType: value,
    permissionMode: value,
    transcriptPath: value,
    turnId: value,
    lastAssistantMessage: value,
    escapedLastAssistantMessage: value,
    prompt: value,
    escapedPrompt: value,
  };
}

const TEXT_FIELDS_A_HOST_NAMES = Object.keys(everyTextFieldCarrying(PRODUCTION_DEPLOY)).length;

const THE_ENVELOPE_THE_GATES_READ: HookEnvelope = {
  ...everyTextFieldCarrying(PRODUCTION_DEPLOY),
  caller: A_HOST_COMPOSING_A_GATE_CALL,
  payloadRead: "json",
  stopHookActive: false,
};

type SmuggledShape = Readonly<{ shape: string; smuggled: string }>;

const SHAPES_THE_CAPTURE_DROPS: readonly SmuggledShape[] = [
  { shape: "a trailing NUL", smuggled: `${PRODUCTION_DEPLOY}\0` },
  { shape: "a NUL inside a token", smuggled: "vercel dep\0loy --prod" },
  { shape: "a leading NUL", smuggled: `\0${PRODUCTION_DEPLOY}` },
  { shape: "a NUL ahead of a trailing newline", smuggled: `${PRODUCTION_DEPLOY}\0\n` },
  { shape: "a trailing carriage return", smuggled: `${PRODUCTION_DEPLOY}\r` },
  { shape: "a trailing CRLF", smuggled: `${PRODUCTION_DEPLOY}\r\n` },
  { shape: "trailing newlines", smuggled: `${PRODUCTION_DEPLOY}\n\n` },
];

describe(
  "core/src/hosts/envelope.ts: hostEnvelope hands the gates every text field a host names already read as " +
    "the command substitution readEnvelope reads a spawned payload through, so the door a host composes in " +
    "process strips the shapes the spawned door strips — a NUL or a carriage return a model puts in a tool " +
    "argument meets a deny pattern as the plain text it wraps, never as the near-miss that walked past it",
  () => {
    for (const { shape, smuggled } of SHAPES_THE_CAPTURE_DROPS) {
      test(
        `${shape}, ${JSON.stringify(smuggled)}, reaches the gates as ${JSON.stringify(PRODUCTION_DEPLOY)} in ` +
          `each of the ${TEXT_FIELDS_A_HOST_NAMES} text field(s) a host names`,
        () => {
          assert.deepEqual(
            hostEnvelope(A_HOST_COMPOSING_A_GATE_CALL, everyTextFieldCarrying(smuggled)),
            THE_ENVELOPE_THE_GATES_READ,
          );
        },
      );
    }
  },
);
