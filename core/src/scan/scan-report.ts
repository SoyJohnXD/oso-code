import type { ScanLanguage } from "./languages.ts";

export type ScanHit = Readonly<{ file: string; line: number; note: string }>;

export function renderScan(hits: readonly ScanHit[], coverage: string): string {
  const cited = hits.map(({ file, line, note }) => `${file}:${line}: ${note}\n`).join("");
  return `${cited}${headlineOf(hits.length)}; ${coverage}\n`;
}

export function readingClause(readFiles: number, languages: readonly ScanLanguage[]): string {
  if (readFiles === 0) return "read no changed file";
  return `read ${readFiles} changed file(s) as ${languages.join(", ")}`;
}

export function unreadClause(unread: readonly string[]): string {
  if (unread.length === 0) return "every changed file was read";
  return `${unread.length} changed file(s) were not read: ${unread.join(", ")}`;
}

function headlineOf(count: number): string {
  if (count === 0) return "no hit";
  return count === 1 ? "1 hit" : `${count} hits`;
}
