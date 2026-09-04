import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import {
  certifyHostTotals,
  certifySummaryFor,
  hostDroveZeroRows,
  parseCertifySuiteTap,
  renderCertifySummary,
  suiteReportsFrom,
  type CertifyHostTotal,
} from "../../scripts/certify-summary.mjs";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-certify-summary-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

function hostTotalOrThrow(totals: Map<string, CertifyHostTotal>, host: string): CertifyHostTotal {
  const total = totals.get(host);
  if (total === undefined) throw new Error(`unreachable: a ${host} total was expected`);
  return total;
}

const ALL_NOT_RUN_TAP = [
  "TAP version 13",
  "ok 1 - row one # SKIP not-run: reason one",
  "ok 2 - row two # SKIP not-run: reason two",
  "ok 3 - at least 2 row(s) of a suite were registered in this file, or this suite proved nothing",
  "1..3",
  "",
].join("\n");

const PARTIALLY_RUN_TAP = [
  "TAP version 13",
  "ok 1 - row one",
  "ok 2 - row two # SKIP not-run: reason two",
  "ok 3 - at least 2 row(s) of another suite were registered in this file, or this suite proved nothing",
  "1..3",
  "",
].join("\n");

test("parseCertifySuiteTap reads the registered-row floor and every not-run line's row name and reason", () => {
  const parsed = parseCertifySuiteTap(ALL_NOT_RUN_TAP);
  assert.equal(parsed.registered, 2);
  assert.deepEqual(parsed.notRun, [
    { row: "row one", reason: "not-run: reason one" },
    { row: "row two", reason: "not-run: reason two" },
  ]);
});

test("parseCertifySuiteTap leaves a row that actually ran out of the not-run list", () => {
  const parsed = parseCertifySuiteTap(PARTIALLY_RUN_TAP);
  assert.equal(parsed.registered, 2);
  assert.deepEqual(parsed.notRun, [{ row: "row two", reason: "not-run: reason two" }]);
});

test("hostDroveZeroRows is true only once every registered row across a host's suites is not-run", () => {
  const zeroRowsHost = certifyHostTotals([
    { suite: "all-not-run", host: "codex", ...parseCertifySuiteTap(ALL_NOT_RUN_TAP) },
  ]);
  assert.equal(hostDroveZeroRows(hostTotalOrThrow(zeroRowsHost, "codex")), true);

  const partiallyDrivenHost = certifyHostTotals([
    { suite: "all-not-run", host: "opencode", ...parseCertifySuiteTap(ALL_NOT_RUN_TAP) },
    { suite: "partially-run", host: "opencode", ...parseCertifySuiteTap(PARTIALLY_RUN_TAP) },
  ]);
  assert.equal(hostDroveZeroRows(hostTotalOrThrow(partiallyDrivenHost, "opencode")), false);
});

test("renderCertifySummary lists every not-run line per host and warns only for the host that drove zero rows", () => {
  const rendered = renderCertifySummary([
    { suite: "all-not-run", host: "codex", ...parseCertifySuiteTap(ALL_NOT_RUN_TAP) },
    { suite: "partially-run", host: "opencode", ...parseCertifySuiteTap(PARTIALLY_RUN_TAP) },
  ]);
  assert.match(rendered, /all-not-run \(codex\): 2 not-run of 2 certify row\(s\)\n {4}row one -- not-run: reason one\n {4}row two -- not-run: reason two/);
  assert.match(rendered, /partially-run \(opencode\): 1 not-run of 2 certify row\(s\)\n {4}row two -- not-run: reason two/);
  assert.match(rendered, /::warning::codex drove zero certify rows this run/);
  assert.doesNotMatch(rendered, /::warning::opencode drove zero certify rows this run/);
});

test("a TAP directory that was never created names itself instead of rendering a blank line (IO seam)", () => {
  const missing = path.join(sandbox, "never-created");
  assert.deepEqual(suiteReportsFrom(missing), []);
  const rendered = certifySummaryFor(missing);
  assert.match(rendered, /::warning::no certify TAP files were found in/);
  assert.ok(rendered.includes(missing), rendered);
});

test("a TAP directory that exists but holds none of the suites' files also names itself, not a blank line (IO seam)", () => {
  const empty = mkdtempSync(path.join(sandbox, "empty-"));
  const rendered = certifySummaryFor(empty);
  assert.match(rendered, /::warning::no certify TAP files were found in/);
});

test("a suite's TAP that crashed before its row-count line still warns, rather than a zero floor hiding it (IO seam)", () => {
  const directory = mkdtempSync(path.join(sandbox, "red-floor-"));
  writeFileSync(path.join(directory, "opencode-contract-bar.tap"), "TAP version 13\nnot ok 1 - the harness crashed before any row ran\n1..1\n");
  const reports = suiteReportsFrom(directory);
  assert.equal(reports.length, 1);
  assert.equal(reports.find((report) => report.suite === "opencode-contract-bar")?.registered, 0);
  const rendered = certifySummaryFor(directory);
  assert.match(rendered, /::warning::opencode drove zero certify rows this run/);
});
