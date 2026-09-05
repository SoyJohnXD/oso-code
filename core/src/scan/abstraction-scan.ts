import { changedFilesSince, trackedAndUntrackedFiles, type ChangedFile, type SourceFile } from "./changed-lines.ts";
import { partitionByLanguage, REFERENCE_COUNT_LANGUAGES } from "./languages.ts";
import { readingClause, renderScan, unreadClause, type ScanHit } from "./scan-report.ts";

type ExportedName = Readonly<{ file: string; line: number; name: string }>;

type CodeLine = Readonly<{ file: string; line: number; text: string }>;

const USE_SITES_AN_EXPORT_MUST_REACH = 2;
const EXPORTED_VALUE_DECLARATION =
  /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|class|enum)\s+([A-Za-z_$][\w$]*)/;
const MODULE_STATEMENT_OPENING = /^\s*(?:import\b|export\s*[*{])/;
const MODULE_SPECIFIER = /\bfrom\s*["'][^"']*["']|^\s*import\s*["'][^"']*["']|;\s*$/;

export function abstractionScanReport(cwd: string, ref: string): string {
  const tree = changedFilesSince(cwd, ref);
  const changed = partitionByLanguage(tree.files, REFERENCE_COUNT_LANGUAGES);
  const project = partitionByLanguage(trackedAndUntrackedFiles(cwd), REFERENCE_COUNT_LANGUAGES);
  const useSiteLines = project.read.flatMap(useSiteLinesOf);
  const hits = changed.read.flatMap(exportsAddedIn).flatMap((exported) => thinlyUsedHitFor(exported, useSiteLines));
  const notRead = [...changed.unread, ...tree.unreadable].sort();
  const coverage =
    `${readingClause(changed.read.length, changed.languages)}, counting use sites across ${project.read.length} ` +
    `project file(s) and reading no type or interface declaration; ${unreadClause(notRead)}`;
  return renderScan(hits, coverage);
}

function exportsAddedIn({ file, text, addedLines }: ChangedFile): ExportedName[] {
  return text.split("\n").flatMap((lineText, index) => {
    const declared = EXPORTED_VALUE_DECLARATION.exec(lineText);
    if (declared === null || !addedLines.has(index + 1)) return [];
    return [{ file, line: index + 1, name: declared[1] as string }];
  });
}

function thinlyUsedHitFor(exported: ExportedName, useSiteLines: readonly CodeLine[]): ScanHit[] {
  const uses = useSiteCountOf(exported, useSiteLines);
  if (uses >= USE_SITES_AN_EXPORT_MUST_REACH) return [];
  const note = `${exported.name} is exported with ${uses} use site${uses === 1 ? "" : "s"} outside its declaration`;
  return [{ file: exported.file, line: exported.line, note }];
}

function useSiteCountOf({ file, line, name }: ExportedName, useSiteLines: readonly CodeLine[]): number {
  const mentions = new RegExp(`(?<![\\w$])${name.replaceAll("$", "\\$")}(?![\\w$])`, "g");
  return useSiteLines
    .filter((candidate) => candidate.file !== file || candidate.line !== line)
    .reduce((total, candidate) => total + [...candidate.text.matchAll(mentions)].length, 0);
}

function useSiteLinesOf({ file, text }: SourceFile): CodeLine[] {
  const lines: CodeLine[] = [];
  let insideModuleStatement = false;
  for (const [index, lineText] of text.split("\n").entries()) {
    if (insideModuleStatement || MODULE_STATEMENT_OPENING.test(lineText)) {
      insideModuleStatement = !MODULE_SPECIFIER.test(lineText);
      continue;
    }
    lines.push({ file, line: index + 1, text: lineText });
  }
  return lines;
}
