import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { VerifyReport } from "../../src/install/report.ts";

describe("VerifyReport renders the verify report grammar the bash verifier established", () => {
  test("a pass line is six-space-padded ok: plus the name and the value in parentheses", () => {
    const report = new VerifyReport();
    report.check("widget installed", "1", "1");
    assert.equal(report.render(), "ok:   widget installed (1)\n----\npassed: 1, failed: 0\n");
  });

  test("a fail line states expected and got, with no fix suffix when none is given", () => {
    const report = new VerifyReport();
    report.check("widget installed", "1", "0");
    assert.equal(report.render(), "FAIL: widget installed — expected 1, got 0\n----\npassed: 0, failed: 1\n");
  });

  test("a fail line appends the optional fix suffix verbatim", () => {
    const report = new VerifyReport();
    report.check("widget installed", "1", "0", "run the installer");
    assert.equal(report.render(), "FAIL: widget installed — expected 1, got 0 — fix: run the installer\n----\npassed: 0, failed: 1\n");
  });

  test("note, skip and detail lines carry their own prefix", () => {
    const report = new VerifyReport();
    report.note("nothing to see here");
    report.skip("slow probe — OSO_VERIFY_SKIP_SLOW");
    report.detail("extra: value");
    assert.equal(
      report.render(),
      "note: nothing to see here\nskip: slow probe — OSO_VERIFY_SKIP_SLOW\n      extra: value\n----\npassed: 0, failed: 0\n",
    );
  });

  test("the exit code is 0 only once every check passed", () => {
    const allPassing = new VerifyReport();
    allPassing.check("a", "1", "1");
    assert.equal(allPassing.exitCode, 0);

    const oneFailing = new VerifyReport();
    oneFailing.check("a", "1", "1");
    oneFailing.check("b", "1", "0");
    assert.equal(oneFailing.exitCode, 1);
  });
});
