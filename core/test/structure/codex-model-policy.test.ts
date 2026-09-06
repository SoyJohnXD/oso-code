import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { AGENT_ROLES } from "../../src/prose/routes.ts";
import { repositoryRoot } from "../support/state-sandbox.ts";

const CODEX_AGENT_DIRECTORY = path.join(repositoryRoot, "codex", "agents");
const ROLE_NAMES = [
  "oso-applier",
  "oso-debt-sweep",
  "oso-doubt-pass",
  "oso-integrator",
  "oso-security-reviewer",
  "oso-triage",
  "oso-verifier",
] as const;

function roleFile(name: string): string {
  return readFileSync(path.join(CODEX_AGENT_DIRECTORY, `${name}.toml`), "utf8");
}

function assignment(text: string, key: string): string | undefined {
  return text.split("\n").find((line) => line.startsWith(`${key} = `))?.slice(key.length + 3);
}

describe("Codex model policy stays launch-selectable where the binding owns the choice", () => {
  test("the shipped Codex agent inventory remains exactly seven roles", () => {
    assert.deepEqual(
      readdirSync(CODEX_AGENT_DIRECTORY)
        .filter((name) => name.endsWith(".toml"))
        .map((name) => name.slice(0, -5))
        .sort(),
      [...ROLE_NAMES].sort(),
    );
    assert.deepEqual(AGENT_ROLES.map((role) => role.id).sort(), [...ROLE_NAMES].sort());
  });

  test("the applier and verifier have no file-level model or effort override", () => {
    for (const name of ["oso-applier", "oso-verifier"]) {
      const text = roleFile(name);
      assert.equal(assignment(text, "model"), undefined, name);
      assert.equal(assignment(text, "model_reasoning_effort"), undefined, name);
    }
  });

  test("the separate debt and security judges stay on Astra with low effort", () => {
    for (const name of ["oso-debt-sweep", "oso-security-reviewer"]) {
      const text = roleFile(name);
      assert.equal(assignment(text, "model"), '"gpt-6-astra"', name);
      assert.equal(assignment(text, "model_reasoning_effort"), '"low"', name);
    }
  });

  test("the integrator, doubt-pass, and triage role pins remain unchanged", () => {
    for (const name of ["oso-integrator", "oso-doubt-pass", "oso-triage"]) {
      const text = roleFile(name);
      assert.equal(assignment(text, "model"), '"gpt-5.5"', name);
      assert.equal(assignment(text, "model_reasoning_effort"), '"xhigh"', name);
    }
  });

  test("the shared binding carries the exact launch policy and reports unsupported selection", () => {
    const binding = readFileSync(path.join(repositoryRoot, "plugin", "skills", "_shared", "references", "codex.md"), "utf8");
    assert.match(binding, /model="gpt-5\.6-luna".*reasoning_effort="max"/);
    assert.match(binding, /model="gpt-5\.6-terra".*reasoning_effort="high"/);
    assert.match(binding, /explicit.*chat.*choice/i);
    assert.match(binding, /announce.*model.*reasoning_effort/i);
    assert.match(binding, /verifier.*(?:never runs below|at or above|not below|floor)/i);
    assert.match(binding, /fork_turns="none"/);
    assert.match(binding, /unavailable.*fallback|fallback.*unavailable/i);
  });
});
