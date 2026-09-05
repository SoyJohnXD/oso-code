import path from "node:path";

export type ScanLanguage = "typescript" | "javascript" | "python" | "rust" | "shell";

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, ScanLanguage>> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".rs": "rust",
  ".sh": "shell",
  ".bash": "shell",
};

export const COMMENT_SCAN_LANGUAGES: readonly ScanLanguage[] = [...new Set(Object.values(LANGUAGE_BY_EXTENSION))];

export const REFERENCE_COUNT_LANGUAGES: readonly ScanLanguage[] = ["typescript", "javascript"];

export function languageOf(file: string): ScanLanguage | undefined {
  return LANGUAGE_BY_EXTENSION[path.posix.extname(file)];
}

export type LanguagePartition<T> = Readonly<{
  read: ReadonlyArray<T & Readonly<{ language: ScanLanguage }>>;
  unread: readonly string[];
  languages: readonly ScanLanguage[];
}>;

export function partitionByLanguage<T extends { file: string }>(
  files: readonly T[],
  accepted: readonly ScanLanguage[],
): LanguagePartition<T> {
  const read: Array<T & { language: ScanLanguage }> = [];
  const unread: string[] = [];
  for (const candidate of files) {
    const language = languageOf(candidate.file);
    if (language === undefined || !accepted.includes(language)) unread.push(candidate.file);
    else read.push({ ...candidate, language });
  }
  const present = new Set(read.map((candidate) => candidate.language));
  return { read, unread, languages: COMMENT_SCAN_LANGUAGES.filter((language) => present.has(language)) };
}
