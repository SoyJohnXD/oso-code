export type ReportLine = Readonly<{ kind: string; key: string }>;

export const DETAIL_INDENT = "      ";
export const SUMMARY_RULE = "----";
export const SMOKE_SECTION = "authenticated smoke:";

const VERDICT_PREFIXES = [
  { prefix: "ok:   ", kind: "ok" },
  { prefix: "FAIL: ", kind: "FAIL" },
  { prefix: "skip: ", kind: "skip" },
  { prefix: "note: ", kind: "note" },
  { prefix: "unverified: ", kind: "unverified" },
] as const;

export function reportLines(text: string): ReportLine[] {
  return text
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith(DETAIL_INDENT))
    .map(classify);
}

export function withoutTheSmokeSection(lines: readonly ReportLine[]): ReportLine[] {
  const smokeAt = lines.findIndex((line) => line.kind === "section" && line.key === SMOKE_SECTION);
  if (smokeAt === -1) return [...lines];
  const tail = lines.slice(smokeAt).filter((line) => line.kind === "summary");
  return [...lines.slice(0, smokeAt), ...tail];
}

function classify(line: string): ReportLine {
  if (line === SUMMARY_RULE || line.startsWith("passed: ")) return { kind: "summary", key: line === SUMMARY_RULE ? SUMMARY_RULE : "counts" };
  for (const { prefix, kind } of VERDICT_PREFIXES) {
    if (!line.startsWith(prefix)) continue;
    return { kind, key: subjectOf(line.slice(prefix.length), kind) };
  }
  return { kind: "section", key: line };
}

function subjectOf(body: string, kind: string): string {
  if (kind === "ok") return body.replace(/ \([^()]*\)$/, "");
  const [subject] = body.split(" — ");
  return (subject ?? body).trim();
}
