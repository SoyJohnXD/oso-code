const HEADING_LINE = /^#{1,6}\s/;
const SENTENCE_BOUNDARY = /(?<=[.!?])\s+/;

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
