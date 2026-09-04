import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { codexPathsFor } from "../../src/install/codex.ts";
import { VerifyReport } from "../../src/install/report.ts";
import { CODEX_HOOKS_MANIFEST, RENDERED_HOOKS_DIR_TOKEN, checkPublishedRuntimeBytes, unrenderedHooksManifest } from "../../src/install/verify-codex.ts";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";

const sandbox = mkdtempSync(path.join(tmpdir(), "oso-codex-trust-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

const PUBLISHED_MANIFEST = readFileSync(path.join(repositoryRoot, ...CODEX_HOOKS_MANIFEST.split("/")), "utf8");

provedSomething(
  `the published ${CODEX_HOOKS_MANIFEST} carries the ${RENDERED_HOOKS_DIR_TOKEN} the installer substitutes away`,
  PUBLISHED_MANIFEST.includes(RENDERED_HOOKS_DIR_TOKEN),
  `${CODEX_HOOKS_MANIFEST} holds no ${RENDERED_HOOKS_DIR_TOKEN}, so nothing below measures a substitution at all`,
);

describe(
  "the installed Codex hooks manifest is hashed with the runtime path substituted back, the way the bash hashed it — " +
    "read from `bootstrap/verify-codex.sh` lines 190-200 at `2bc77ad`",
  () => {
    test("a correctly installed manifest is verified rather than reported as a mismatch", () => {
      const paths = installedFixture();
      const report = new VerifyReport();
      checkPublishedRuntimeBytes(report, paths, repositoryRoot);
      assert.ok(!report.render().includes(`${CODEX_HOOKS_MANIFEST}: mismatch`), report.render());
    });

    test("a manifest carrying a foreign hooks directory is still a mismatch, so the substitution is not a blanket pass", () => {
      const paths = installedFixture("/somewhere/else/dist");
      const report = new VerifyReport();
      checkPublishedRuntimeBytes(report, paths, repositoryRoot);
      assert.ok(report.render().includes(`${CODEX_HOOKS_MANIFEST}: mismatch`), report.render());
    });

    test("the substitution replaces every occurrence and leaves a manifest that never held the path alone", () => {
      assert.equal(unrenderedHooksManifest("a /rt/dist b /rt/dist c", "/rt"), `a ${RENDERED_HOOKS_DIR_TOKEN} b ${RENDERED_HOOKS_DIR_TOKEN} c`);
      assert.equal(unrenderedHooksManifest("nothing to undo", "/rt"), "nothing to undo");
    });
  },
);

let fixtureCounter = 0;

function installedFixture(renderedDirectory?: string): ReturnType<typeof codexPathsFor> {
  fixtureCounter += 1;
  const home = path.join(sandbox, `home-${fixtureCounter}`);
  const environment = { CODEX_HOME: path.join(home, ".codex") };
  const paths = codexPathsFor(home, environment);
  mkdirSync(paths.codexHome, { recursive: true });
  const dist = renderedDirectory ?? path.posix.join(paths.runtimeRoot, "dist");
  writeFileSync(path.join(paths.codexHome, "hooks.json"), PUBLISHED_MANIFEST.replaceAll(RENDERED_HOOKS_DIR_TOKEN, dist));
  return paths;
}
