import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { versionLineReadingOf } from "../../src/install/version-line.ts";

const CODEX_CLI_VERSION_LINE = /^codex-cli\s+(\d+(?:\.\d+)*)\s*$/;
const CLAUDE_VERSION_LINE = /^(\d+(?:\.\d+)*) \(Claude Code\)$/;

describe("versionLineReadingOf: one shared matcher over any host's own anchored version-line shape", () => {
  test("a two-line mise/codex banner keeps the codex-cli line as the version and reports the mise line", () => {
    const reading = versionLineReadingOf(
      "mise ~/.config/mise/config.toml tools: codex@0.152.0\ncodex-cli 0.152.0\n",
      CODEX_CLI_VERSION_LINE,
    );
    assert.deepEqual(reading, {
      kind: "matched",
      version: "0.152.0",
      discarded: ["mise ~/.config/mise/config.toml tools: codex@0.152.0"],
    });
  });

  test("a two-line mise/claude banner is read the same way, proving the matcher is not tuned to Codex's wording", () => {
    const reading = versionLineReadingOf(
      "mise ~/.config/mise/config.toml tools: claude@2.1.250\n2.1.250 (Claude Code)\n",
      CLAUDE_VERSION_LINE,
    );
    assert.deepEqual(reading, {
      kind: "matched",
      version: "2.1.250",
      discarded: ["mise ~/.config/mise/config.toml tools: claude@2.1.250"],
    });
  });

  test("a generic dotted-number pattern would have matched the mise banner line, which is exactly why the anchored codex-cli pattern must not", () => {
    const bannerLine = "mise ~/.config/mise/config.toml tools: codex@0.152.0";
    const genericDottedNumber = /\d+(\.\d+)*/;
    assert.equal(genericDottedNumber.test(bannerLine), true);
    assert.equal(CODEX_CLI_VERSION_LINE.test(bannerLine), false);
  });

  test("output with no line shaped like the pattern is unmatched, and the raw output is kept rather than guessed at", () => {
    const raw = "codex: command not found\n";
    assert.deepEqual(versionLineReadingOf(raw, CODEX_CLI_VERSION_LINE), { kind: "unmatched", raw });
  });

  test("two lines both shaped like the version line is a loud ambiguous failure rather than a silent pick", () => {
    const raw = "codex-cli 0.146.0\ncodex-cli 0.152.0\n";
    assert.deepEqual(versionLineReadingOf(raw, CODEX_CLI_VERSION_LINE), {
      kind: "ambiguous",
      matches: ["codex-cli 0.146.0", "codex-cli 0.152.0"],
    });
  });
});
