import { flowBody } from "../../src/prose/render.ts";
import { sentencesOf } from "./prose-sentences.ts";

export const FLOW_PROSE_ROOT = "plugin/skills/";
export const HOST_BINDING_DIRECTORY = "references";

const DELEGATE_ROLE = /oso-applier|oso-verifier|oso-integrator/;

export type DelegateSentence = Readonly<{ file: string; lineIndex: number; sentence: string; followOn: string }>;

export function flowProseAmong(files: readonly string[]): string[] {
  return files
    .filter((file) => file.startsWith(FLOW_PROSE_ROOT) && file.endsWith(".md") && !file.includes(`/${HOST_BINDING_DIRECTORY}/`))
    .sort();
}

export function flowBodyLines(rawFlowText: string): string[] {
  return flowBody(rawFlowText).split("\n");
}

export function sentencesLineByLine(rawFlowText: string): string[][] {
  return flowBodyLines(rawFlowText).map(sentencesOf);
}

export function delegateSentencesIn(file: string, rawFlowText: string): DelegateSentence[] {
  return sentencesLineByLine(rawFlowText).flatMap((sentences, lineIndex) =>
    sentences
      .map((sentence, index) => ({ file, lineIndex, sentence, followOn: sentences[index + 1] ?? "" }))
      .filter(({ sentence }) => DELEGATE_ROLE.test(sentence)),
  );
}
