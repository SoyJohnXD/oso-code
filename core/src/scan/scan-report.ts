import type { ScanLanguage } from "./languages.ts";
import type { ReadFailure } from "./changed-lines.ts";

export type ScanHit = Readonly<{
  file: string;
  line: number;
  note: string;
  category?: "registered-generated-output-candidate";
}>;

export function renderScan(hits: readonly ScanHit[], coverage: string): string {
  const cited = hits
    .map(({ file, line, note, category }) => {
      const label = category === "registered-generated-output-candidate" ? "[registered generated-output candidate] " : "";
      return `${file}:${line}: ${label}${note}\n`;
    })
    .join("");
  const candidates = hits.filter(({ category }) => category === "registered-generated-output-candidate").length;
  const candidateEvidence =
    candidates === 0
      ? ""
      : `; ${candidates} registered generated-output candidate${candidates === 1 ? "" : "s"} require exact regeneration evidence`;
  return `${cited}${headlineOf(hits.length)}${candidateEvidence}; ${coverage}\n`;
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
