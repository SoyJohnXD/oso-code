import assert from "node:assert/strict";
import { test } from "node:test";
import { readTrackedText } from "../support/tracked-files.ts";

const VERIFIER_CONTRACTS = [
  "core/src/prose/agents/oso-verifier/body.md",
  "plugin/agents/oso-verifier.md",
  "opencode/agents/oso-verifier.md",
];

const FLOWS = [
  { mode: "plan", files: ["plugin/skills/plan/SKILL.md", "opencode/skills/oso-plan/SKILL.md"], store: "the ledger" },
  { mode: "debug", files: ["plugin/skills/debug/SKILL.md", "opencode/skills/oso-debug/SKILL.md"], store: "the diagnosis" },
];

test("the rubric makes the operator's recorded answer binding and keeps the secret exception", () => {
  const { text } = readTrackedText("plugin/skills/_shared/rubric.md");
  assert.match(text, /The operator's answer binds once recorded as an `Operator ruling`/);
  assert.match(text, /except for a hardcoded secret, credential, token or private key/);
});

test("the verifier contract admits a ruling inside the decision block and still fails a hardcoded secret", () => {
  for (const file of VERIFIER_CONTRACTS) {
    const { text } = readTrackedText(file);
    assert.match(text, /may include an `Operator ruling`/, file);
    assert.match(text, /a standing ruling outside that decision block or diagnosis/, file);
    assert.match(text, /`held — operator ruling <id>`/, file);
    assert.match(text, /never a hardcoded secret, credential, token or private key/, file);
  }
});

test("the plan and debug flows record a ruling verbatim, dated, and relaunch a fresh verifier", () => {
  for (const { mode, files, store } of FLOWS) {
    for (const file of files) {
      const { text } = readTrackedText(file);
      assert.match(text, /(?:rules?|may rule) to keep (?:the finding|it)/, `${file} (${mode})`);
      assert.match(text, /verbatim as a dated `Operator ruling` amendment/, file);
      assert.ok(text.includes(`amendment to ${store} via \`mem_update\``), file);
      assert.match(text, /then relaunch a FRESH verifier/, file);
    }
  }
});
