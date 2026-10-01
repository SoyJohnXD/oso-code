import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { lexShellCommands, MAX_LEXED_INPUT_BYTES, type LexRecord } from "../../src/shell/lexer.ts";

const READABLE_COMMAND_BYTES = MAX_LEXED_INPUT_BYTES - "\n".length;
const HALF_THE_BOUND = Math.floor(READABLE_COMMAND_BYTES / 2);
const TWO_RUNS_CEILING_MS = 1000;
const A_LINE_LEFT_UNREAD: readonly LexRecord[] = [{ kind: "unreadPayload" }];

type WorstShape = Readonly<{ named: string; line: string }>;

const WORST_SHAPES: readonly WorstShape[] = [
  { named: "a line of short words", line: filledTo(READABLE_COMMAND_BYTES, "echo", " a") },
  { named: "a heredoc a shell reads", line: filledTo(READABLE_COMMAND_BYTES, "bash <<EOF\n", "echo a\n") },
  {
    named: "three nested substitutions, repeated",
    line: filledTo(READABLE_COMMAND_BYTES, "echo", " $(echo $(echo $(echo a)))"),
  },
  { named: "coproc words, then brace words", line: bracesBehind("coproc", " coproc") },
  { named: "option-shaped words, then brace words", line: bracesBehind("-", " -") },
  { named: "assignments, then brace words", line: bracesBehind("X=1", " X=1") },
  { named: "a timeout prefix run", line: filledTo(READABLE_COMMAND_BYTES, "timeout", " 1") },
  { named: "a sudo option run", line: filledTo(READABLE_COMMAND_BYTES, "sudo", " -n") },
];

describe(`the lexer reads its worst shapes at the ${MAX_LEXED_INPUT_BYTES}-byte bound in linear time`, () => {
  for (const { named, line } of WORST_SHAPES) {
    test(`two runs over ${named} are read and finish under ${TWO_RUNS_CEILING_MS} ms`, () => {
      const started = performance.now();
      const runs = [lexShellCommands(line), lexShellCommands(line)];
      const elapsedMs = performance.now() - started;
      for (const records of runs) assert.notDeepEqual(records, A_LINE_LEFT_UNREAD, `${named} came back unread`);
      assert.ok(elapsedMs < TWO_RUNS_CEILING_MS, `${named} took ${elapsedMs.toFixed(0)} ms for two runs`);
    });
  }
});

function bracesBehind(head: string, prefixWord: string): string {
  return filledTo(READABLE_COMMAND_BYTES, filledTo(HALF_THE_BOUND, head, prefixWord), " {a");
}

function filledTo(bytes: number, head: string, unit: string): string {
  return head + unit.repeat(Math.floor((bytes - head.length) / unit.length));
}
