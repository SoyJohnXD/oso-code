import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { OPENCODE_PLUGIN_BUNDLE } from "../../src/routes/routes.ts";
import { provedSomething } from "../support/proved.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";

const OPENCODE_INSTALLER = "core/src/install/opencode-install.ts";
const BUNDLE_ENTRY_MARKER = "osoCode";
const STALE_SOURCE_PATTERN = /PLUGIN_SOURCE|opencode\/plugin\/oso\//;

const MINIMUM_INSTALLER_LINES = 300;
const MINIMUM_INSTALLER_LINES_DERIVATION = `wc -l ${OPENCODE_INSTALLER}, measured at C5-S5b-2: 549`;

function absolutePathOf(file: string): string {
  return path.join(repositoryRoot, file);
}

function installerLineCount(): number {
  const target = absolutePathOf(OPENCODE_INSTALLER);
  if (!existsSync(target)) return 0;
  return readFileSync(target, "utf8").split("\n").length - 1;
}

provedSomething(
  `${OPENCODE_INSTALLER} was read with a non-trivial line count before it was searched for a stale plugin-source citation`,
  installerLineCount() >= MINIMUM_INSTALLER_LINES,
  `${OPENCODE_INSTALLER} holds ${installerLineCount()} line(s), under the ${MINIMUM_INSTALLER_LINES}-line floor ` +
    `(${MINIMUM_INSTALLER_LINES_DERIVATION}), so a hollowed-out installer would report zero stale citations having searched nothing`,
);

describe(
  `the OpenCode host loads exactly one bundled file, ${OPENCODE_PLUGIN_BUNDLE}, and ${OPENCODE_INSTALLER} names no ` +
    "TypeScript plugin source beside it — this port's two assertions run independently, unlike this rule's bash " +
    `original, which returns before checking ${OPENCODE_INSTALLER} once ${OPENCODE_PLUGIN_BUNDLE} is missing or empty`,
  () => {
    test(`${OPENCODE_PLUGIN_BUNDLE} exists, is non-empty, and carries a ${BUNDLE_ENTRY_MARKER} entry`, () => {
      const bundlePath = absolutePathOf(OPENCODE_PLUGIN_BUNDLE);
      assert.ok(
        existsSync(bundlePath) && statSync(bundlePath).size > 0,
        `${OPENCODE_PLUGIN_BUNDLE} is missing or empty, so the one file the OpenCode host loads is not in the tree`,
      );
      const bundleText = readFileSync(bundlePath, "utf8");
      assert.ok(
        bundleText.includes(BUNDLE_ENTRY_MARKER),
        `${OPENCODE_PLUGIN_BUNDLE} carries no ${BUNDLE_ENTRY_MARKER} entry, so whatever it is the host would load nothing from it`,
      );
    });

    test(`${OPENCODE_INSTALLER} names no PLUGIN_SOURCE or opencode/plugin/oso/ import`, () => {
      const staleLines = readFileSync(absolutePathOf(OPENCODE_INSTALLER), "utf8")
        .split("\n")
        .flatMap((line, index) => (STALE_SOURCE_PATTERN.test(line) ? [`${OPENCODE_INSTALLER}:${index + 1}`] : []));
      assert.deepEqual(
        staleLines,
        [],
        `${staleLines.join(", ")} still name(s) a TypeScript plugin source, so the installed import graph is not ` +
          `the single ${OPENCODE_PLUGIN_BUNDLE} it must be`,
      );
    });
  },
);
