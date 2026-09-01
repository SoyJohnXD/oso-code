import { readFileSync } from "node:fs";
import path from "node:path";

export const CERTIFY_SUITE_HOSTS = {
  "opencode-contract-bar": "opencode",
  "opencode-behavior-bar": "opencode",
  "opencode-wave-runner-smoke": "opencode",
  "codex-authenticated-smoke": "codex",
};

const REGISTERED_ROW_COUNT_PATTERN = /^ok \d+ - at least (\d+) row\(s\)/m;
const NOT_RUN_LINE_PATTERN = /^\s*(?:not )?ok \d+ - (.+) # SKIP (not-run:.*)$/;

export function parseCertifySuiteTap(tapText) {
  const registeredMatch = tapText.match(REGISTERED_ROW_COUNT_PATTERN);
  const registered = registeredMatch === null ? 0 : Number(registeredMatch[1]);
  const notRun = tapText
    .split("\n")
    .map((line) => line.match(NOT_RUN_LINE_PATTERN))
    .filter((match) => match !== null)
    .map((match) => ({ row: match[1], reason: match[2] }));
  return { registered, notRun };
}

function emptyHostTotal() {
  return { registered: 0, notRunCount: 0, notRunLines: [] };
}

export function certifyHostTotals(suiteReports) {
  const perHost = new Map();
  for (const { suite, host, registered, notRun } of suiteReports) {
    const total = perHost.get(host) ?? emptyHostTotal();
    total.registered += registered;
    total.notRunCount += notRun.length;
    for (const { row, reason } of notRun) {
      total.notRunLines.push(`${suite}: ${row} -- ${reason}`);
    }
    perHost.set(host, total);
  }
  return perHost;
}

export function hostDroveZeroRows(total) {
  return total.notRunCount >= total.registered;
}

export function renderCertifySummary(suiteReports, tapDirectory) {
  if (suiteReports.length === 0) {
    return `::warning::no certify TAP files were found in ${tapDirectory ?? "(no directory given)"} — every certify suite is silent\n`;
  }
  const lines = [];
  for (const { suite, host, registered, notRun } of suiteReports) {
    lines.push(`${suite} (${host}): ${notRun.length} not-run of ${registered} certify row(s)`);
    for (const { row, reason } of notRun) lines.push(`    ${row} -- ${reason}`);
  }
  const perHost = certifyHostTotals(suiteReports);
  for (const [host, total] of perHost) {
    lines.push(`${host}: ${total.notRunCount} not-run of ${total.registered} certify row(s) total this run`);
    if (hostDroveZeroRows(total)) lines.push(`::warning::${host} drove zero certify rows this run — every row not-run`);
  }
  return `${lines.join("\n")}\n`;
}

export function suiteReportsFrom(tapDirectory) {
  return Object.entries(CERTIFY_SUITE_HOSTS)
    .map(([suite, host]) => ({ suite, host, tapFile: path.join(tapDirectory, `${suite}.tap`) }))
    .filter(({ tapFile }) => existsReadable(tapFile))
    .map(({ suite, host, tapFile }) => ({ suite, host, ...parseCertifySuiteTap(readFileSync(tapFile, "utf8")) }));
}

function existsReadable(file) {
  try {
    readFileSync(file, "utf8");
    return true;
  } catch {
    return false;
  }
}

export function certifySummaryFor(tapDirectory) {
  return renderCertifySummary(suiteReportsFrom(tapDirectory), tapDirectory);
}

function main() {
  const tapDirectory = process.argv[2];
  if (tapDirectory === undefined) {
    process.stderr.write("usage: certify-summary.mjs <tap-directory>\n");
    process.exit(1);
  }
  process.stdout.write(certifySummaryFor(tapDirectory));
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(new URL(import.meta.url).pathname)) main();
