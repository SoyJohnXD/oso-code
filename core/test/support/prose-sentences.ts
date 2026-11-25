export function wordCountOf(sentence: string): number {
  return sentence.split(/\s+/).filter((token) => token !== "").length;
}
