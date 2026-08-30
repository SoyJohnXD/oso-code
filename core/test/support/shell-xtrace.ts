import { spawnSync } from "node:child_process";
import { probesCarryingAnExcludedConstruct } from "./shell-constructs.ts";

export const INERT_VERB = ":";

const TRACE_PREFIX = "+ ";
const PROBE_SENTINEL = "__oso_lexer_probe__";
const ANSI_C_TRACE_OPENING = "$'";
const RESERVED_WORD_COMPLETIONS = "-k";
const BUILTIN_COMPLETIONS = "-b";

export type TracedProbe = Readonly<{ line: string; trace: readonly string[] }>;
export type ShellVocabulary = Readonly<{ reservedWords: readonly string[]; builtins: readonly string[] }>;

export function tracedThroughTheRealShell(lines: readonly string[]): readonly TracedProbe[] {
  refuseTheProbesTheOracleMustNeverRun(lines);
  const run = spawnUnderBash(probeScript(lines));
  if (run.error !== undefined) {
    throw new Error(`bash could not be spawned as the lexer oracle: ${run.error.message}`);
  }
  return probesSplitAtSentinels(run.stderr.split("\n"), lines);
}

function spawnUnderBash(script: string) {
  return spawnSync("bash", ["-c", script], { encoding: "utf8", env: { PATH: process.env["PATH"] ?? "" } });
}

function refuseTheProbesTheOracleMustNeverRun(lines: readonly string[]): void {
  const carried = probesCarryingAnExcludedConstruct(lines);
  if (carried.length === 0) return;
  throw new Error(
    `the oracle refuses to spawn a shell over ${carried.length} probe(s) it excludes by construction, ` +
      `because running them is the side effect the exclusion exists to prevent: ${carried.join("; ")}`,
  );
}

export function shellVocabularyOfTheRealShell(): ShellVocabulary {
  return {
    reservedWords: wordsTheShellCompletes(RESERVED_WORD_COMPLETIONS),
    builtins: wordsTheShellCompletes(BUILTIN_COMPLETIONS),
  };
}

function wordsTheShellCompletes(completionFlag: string): readonly string[] {
  const run = spawnUnderBash(`compgen ${completionFlag}`);
  if (run.error !== undefined) {
    throw new Error(`bash could not be spawned to read its own vocabulary: ${run.error.message}`);
  }
  return run.stdout.split("\n").filter((word) => word !== "").sort();
}

export function shellSpawnsForTracing(): boolean {
  const probe = spawnUnderBash(INERT_VERB);
  return probe.error === undefined && probe.status === 0;
}

export function argvOfEachTracedCommand(trace: readonly string[]): readonly (readonly string[])[] {
  return trace.map(tracedArgv);
}

function tracedArgv(traceLine: string): readonly string[] {
  if (!traceLine.startsWith(TRACE_PREFIX)) {
    throw new Error(`the shell traced a line this reader does not recognise: ${JSON.stringify(traceLine)}`);
  }
  return tracedWords(traceLine.slice(TRACE_PREFIX.length));
}

function tracedWords(traced: string): readonly string[] {
  const words: string[] = [];
  let word = "";
  let open = false;
  let at = 0;
  while (at < traced.length) {
    const character = traced[at] as string;
    if (character === " ") {
      if (open) words.push(word);
      word = "";
      open = false;
      at += 1;
      continue;
    }
    if (traced.startsWith(ANSI_C_TRACE_OPENING, at)) {
      throw new Error(
        `the shell re-quoted a word this reader cannot read plainly (${JSON.stringify(traced)}) — ` +
          "a probe whose words carry a character bash renders as $'…' belongs to the equivalence corpus",
      );
    }
    open = true;
    const segment = tracedSegmentAt(traced, at);
    word += segment.text;
    at += segment.length;
  }
  if (open) words.push(word);
  return words;
}

function tracedSegmentAt(traced: string, at: number): Readonly<{ text: string; length: number }> {
  const character = traced[at] as string;
  if (character === "'") {
    const closing = traced.indexOf("'", at + 1);
    if (closing === -1) throw new Error(`the shell traced an unclosed quote: ${JSON.stringify(traced)}`);
    return { text: traced.slice(at + 1, closing), length: closing - at + 1 };
  }
  if (character === "\\") return { text: traced.slice(at + 1, at + 2), length: 2 };
  return { text: character, length: 1 };
}

function probeScript(lines: readonly string[]): string {
  const body = lines.flatMap((line, index) => [`${INERT_VERB} ${PROBE_SENTINEL}${index}`, line]);
  return [`PS4='${TRACE_PREFIX}'`, "set -x", ...body, ""].join("\n");
}

function probesSplitAtSentinels(traced: readonly string[], lines: readonly string[]): TracedProbe[] {
  const sentinels = lines.map((_line, index) =>
    traced.indexOf(`${TRACE_PREFIX}${INERT_VERB} ${PROBE_SENTINEL}${index}`),
  );
  return lines.map((line, index) => {
    const opening = sentinels[index] as number;
    if (opening === -1) {
      throw new Error(`the shell never reached the probe ${JSON.stringify(line)}, so its trace is missing`);
    }
    const closing = sentinels[index + 1] ?? traced.length;
    return { line, trace: traced.slice(opening + 1, closing).filter((traceLine) => traceLine !== "") };
  });
}
