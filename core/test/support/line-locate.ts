export function firstLineContaining(text: string, needle: string): number | undefined {
  const index = text.split("\n").findIndex((line) => line.includes(needle));
  return index === -1 ? undefined : index + 1;
}
