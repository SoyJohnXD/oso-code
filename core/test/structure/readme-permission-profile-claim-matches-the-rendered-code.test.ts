import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderOsoPermissionProfile } from "../../src/install/codex-config.ts";
import { readTrackedText } from "../support/tracked-files.ts";

const NETWORK_TABLE_HEADING = "[permissions.oso.network]";
const FILESYSTEM_DENY_MARKER = '= "deny"';
const DENYLIST_STILL_APPLIES_PATTERN = /secret denylist\b(?:(?!\.).)*\bstill appl(?:y|ies)\b/is;

function filesystemSectionOf(renderedTables: string): string {
  const networkHeadingIndex = renderedTables.indexOf(NETWORK_TABLE_HEADING);
  assert.notEqual(networkHeadingIndex, -1, "renderOsoPermissionProfile no longer renders a network table to split on");
  return renderedTables.slice(0, networkHeadingIndex);
}

describe("README's secret-denylist claim about the oso permission profile matches what the code actually renders", () => {
  test("the rendered profile denies a file only if README claims a secret denylist still applies", () => {
    const codeDeniesAFile = filesystemSectionOf(renderOsoPermissionProfile("/home/example").tables).includes(FILESYSTEM_DENY_MARKER);
    const readmeClaimsActiveDenylist = DENYLIST_STILL_APPLIES_PATTERN.test(readTrackedText("README.md").text);
    assert.equal(
      codeDeniesAFile,
      readmeClaimsActiveDenylist,
      `the rendered profile denies a file: ${codeDeniesAFile}, but README's secret-denylist-still-applies claim reads: ${readmeClaimsActiveDenylist}`,
    );
  });
});
