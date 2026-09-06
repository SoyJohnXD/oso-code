import { changedFilesSince, trackedAndUntrackedFiles, type ChangedFile, type SourceFile } from "./changed-lines.ts";
import { partitionByLanguage, REFERENCE_COUNT_LANGUAGES } from "./languages.ts";
import { readingClause, renderScan, unreadClause, type ScanHit } from "./scan-report.ts";
import { GENERATED_BUNDLES } from "../routes/routes.ts";

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
  const projectTree = trackedAndUntrackedFiles(cwd);
  const project = partitionByLanguage(projectTree.files, REFERENCE_COUNT_LANGUAGES);
  const sourceFiles = project.read.filter((candidate) => !isGeneratedBundle(candidate.file));
  const generatedBundles = project.read.filter((candidate) => isGeneratedBundle(candidate.file));
  const useSiteLines = sourceFiles.flatMap(useSiteLinesOf);
  const hits = changed.read.flatMap(exportsAddedIn).flatMap((exported) => thinlyUsedHitFor(exported, useSiteLines));
  const changedNotRead = [...changed.unread, ...tree.unreadable];
  const coverage =
    `${readingClause(changed.read.length, changed.languages)}, counting use sites across ${sourceFiles.length} ` +
    `project file(s) and reading no type or interface declaration; ${unreadClause(changedNotRead)}` +
    `${projectTree.unreadable.length === 0 ? "" : `; ${unreadClause(projectTree.unreadable, "project file")}`}` +
    `${generatedBundleClause(generatedBundles)}`;
  return renderScan(hits, coverage);
}

function isGeneratedBundle(file: string): boolean {
  return GENERATED_BUNDLES.includes(file);
}

function generatedBundleClause(generatedBundles: readonly SourceFile[]): string {
  if (generatedBundles.length === 0) return "";
  return `; ${generatedBundles.length} generated bundle(s) were not counted: ${generatedBundles
    .map(({ file }) => file)
    .join(", ")}`;
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
