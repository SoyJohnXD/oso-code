import type { ScanLanguage } from "./languages.ts";
import type { ReadFailure } from "./changed-lines.ts";

export type ScanHit = Readonly<{ file: string; line: number; note: string }>;

export function renderScan(hits: readonly ScanHit[], coverage: string): string {
  const cited = hits.map(({ file, line, note }) => `${file}:${line}: ${note}\n`).join("");
  return `${cited}${headlineOf(hits.length)}; ${coverage}\n`;
}

export function readingClause(readFiles: number, languages: readonly ScanLanguage[]): string {
  if (readFiles === 0) return "read no changed file";
  return `read ${readFiles} changed file(s) as ${languages.join(", ")}`;
}

export function unreadClause(unread: readonly (string | ReadFailure)[], subject = "changed file"): string {
  if (unread.length === 0) return "every changed file was read";
  const paths = [...unread].sort(compareUnreadEntries).map(unreadPath);
  return `${unread.length} ${subject}(s) were not read: ${paths.join(", ")}`;
}

function compareUnreadEntries(left: string | ReadFailure, right: string | ReadFailure): number {
  return unreadPath(left).localeCompare(unreadPath(right));
}

function unreadPath(unread: string | ReadFailure): string {
  if (typeof unread === "string") return unread;
  return `${unread.file} (${unread.cause})`;
}

function headlineOf(count: number): string {
  if (count === 0) return "no hit";
  return count === 1 ? "1 hit" : `${count} hits`;
}
