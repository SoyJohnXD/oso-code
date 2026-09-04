import path from "node:path";
import { lexerCorpus, type ArgvProbe, type EquivalenceProbe } from "./lexer-corpus.ts";
import { CONSTRUCTS_EXCLUDED_BY_CONSTRUCTION } from "./shell-constructs.ts";
import {
  argvOfEachTracedCommand,
  shellVocabularyOfTheRealShell,
  tracedThroughTheRealShell,
  type ShellVocabulary,
  type TracedProbe,
} from "./shell-xtrace.ts";
import { repositoryRoot } from "./state-sandbox.ts";

export const LEXER_DIFFERENTIAL_FIXTURE = path.join(
  repositoryRoot,
  "core",
  "test",
  "fixtures",
  "shell",
  "lexer-differential.json",
);

export const THE_ORACLE = "bash, running the : builtin under set -x, which parses and expands but runs nothing";

export type ObservedArgvProbe = ArgvProbe & Readonly<{ commands: readonly (readonly string[])[] }>;
export type ObservedEquivalence = EquivalenceProbe & Readonly<{ trace: readonly string[] }>;
export type LexerDifferential = Readonly<{
  oracle: string;
  vocabulary: ShellVocabulary;
  excluded: readonly string[];
  argvProbes: readonly ObservedArgvProbe[];
  equivalences: readonly ObservedEquivalence[];
}>;

export function lexerDifferentialFromTheRealShell(): LexerDifferential {
  const { argvProbes, equivalences } = lexerCorpus();
  const escaped = equivalences.map((pair) => pair.escaped);
  const literal = equivalences.map((pair) => pair.literal);
  const traced = tracedThroughTheRealShell([...argvProbes.map((probe) => probe.line), ...escaped, ...literal]);

  return {
    oracle: THE_ORACLE,
    vocabulary: shellVocabularyOfTheRealShell(),
    excluded: CONSTRUCTS_EXCLUDED_BY_CONSTRUCTION.map((construct) => construct.named),
    argvProbes: argvProbes.map((probe, index) => ({
      ...probe,
      commands: argvOfEachTracedCommand(traceAt(traced, index)),
    })),
    equivalences: equivalences.map((pair, index) =>
      observedEquivalence(
        pair,
        traceAt(traced, argvProbes.length + index),
        traceAt(traced, argvProbes.length + equivalences.length + index),
      ),
    ),
  };
}

function traceAt(traced: readonly TracedProbe[], index: number): readonly string[] {
  const probe = traced[index];
  if (probe === undefined) throw new Error(`the oracle returned no trace for probe ${index}`);
  return probe.trace;
}

function observedEquivalence(
  pair: EquivalenceProbe,
  escaped: readonly string[],
  literal: readonly string[],
): ObservedEquivalence {
  if (escaped.join("\n") !== literal.join("\n")) {
    throw new Error(
      `the shell reads ${JSON.stringify(pair.escaped)} and ${JSON.stringify(pair.literal)} differently ` +
        `(${escaped.join(" / ")} against ${literal.join(" / ")}), so they are no equivalence pair`,
    );
  }
  return { ...pair, trace: escaped };
}
