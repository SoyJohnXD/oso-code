import { changedFilesSince, type ChangedFile } from "./changed-lines.ts";
import { commentOpeningsIn } from "./comment-openings.ts";
import { COMMENT_SCAN_LANGUAGES, partitionByLanguage, type ScanLanguage } from "./languages.ts";
import { readingClause, renderScan, unreadClause, type ScanHit } from "./scan-report.ts";
import { GENERATED_BUNDLES } from "../routes/routes.ts";

type ReadableChange = ChangedFile & Readonly<{ language: ScanLanguage }>;

export function commentScanReport(cwd: string, ref: string): string {
  const changed = changedFilesSince(cwd, ref);
  const { read, unread, languages } = partitionByLanguage(changed.files, COMMENT_SCAN_LANGUAGES);
  const hits = read.flatMap(inlineCommentsAddedIn);
  const notRead = [...unread, ...changed.unreadable];
  return renderScan(hits, `${readingClause(read.length, languages)}; ${unreadClause(notRead)}`);
}

function inlineCommentsAddedIn({ file, text, addedLines, language }: ReadableChange): ScanHit[] {
  const category = GENERATED_BUNDLES.includes(file) ? "registered-generated-output-candidate" : undefined;
  return commentOpeningsIn(language, text)
    .filter((opening) => opening.form === "inline" && addedLines.has(opening.line))
    .map((opening) => ({ file, line: opening.line, note: opening.text, ...(category === undefined ? {} : { category }) }));
}
