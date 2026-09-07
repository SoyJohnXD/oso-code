const HEADING_LINE = /^#{1,6}\s/;
const SENTENCE_BOUNDARY = /(?<=[.!?])\s+/;
const LIST_ITEM_LINE = /^\s*(?:[-*+]|\d+\.)\s+/;
const TABLE_LINE = /^\s*\|/;
const SENTENCE_END = /[.!?](?:\*\*|`|\)|")*(?=\s|$)/g;

export type SentenceWordCount = Readonly<{ file: string; words: number; sentence: string }>;

export function sentencesOf(text: string): string[] {
  const prose = text
    .split("\n")
    .filter((line) => !HEADING_LINE.test(line))
    .join(" ");
  return prose
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
}

export function sentenceWordCountsIn(file: string, text: string): SentenceWordCount[] {
  return runsIn(text).flatMap((run) => sentencesIn(run).map((sentence) => ({ file, words: wordCountOf(sentence), sentence })));
}

function runsIn(text: string): string[] {
  const runs: string[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length > 0) runs.push(paragraph.join(" "));
    paragraph = [];
  };
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      flushParagraph();
      continue;
    }
    if (HEADING_LINE.test(line)) {
      flushParagraph();
      continue;
    }
    if (TABLE_LINE.test(line)) {
      flushParagraph();
      runs.push(line.trim());
      continue;
    }
    const listMarker = line.match(LIST_ITEM_LINE);
    if (listMarker !== null) {
      flushParagraph();
      runs.push(line.slice(listMarker[0].length).trim());
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  return runs;
}

export function sentencesIn(run: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (const match of run.matchAll(SENTENCE_END)) {
    const end = (match.index ?? 0) + match[0].length;
    sentences.push(run.slice(start, end).trim());
    start = end;
  }
  const remainder = run.slice(start).trim();
  if (remainder !== "") sentences.push(remainder);
  return sentences;
}

export function wordCountOf(sentence: string): number {
  return sentence.split(/\s+/).filter((token) => token !== "").length;
}
