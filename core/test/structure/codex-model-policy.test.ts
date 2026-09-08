import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { AGENT_ROLES } from "../../src/prose/routes.ts";
import { repositoryRoot, withStateSandbox } from "../support/state-sandbox.ts";

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

const reference = readFileSync(path.join(repositoryRoot, "codex/skills/security-pass/references/codex.md"), "utf8");
const role = readFileSync(path.join(repositoryRoot, "codex/agents/oso-security-reviewer.toml"), "utf8");
const wrapper = readFileSync(path.join(repositoryRoot, "codex/skills/security-pass/SKILL.md"), "utf8");

test("direct Git acquisition preserves pending and committed evidence, literal untracked paths, and the index", () => {
  withStateSandbox("workspace", (sandbox) => {
    const cwd = sandbox.seedGitRepository("review", { "tracked.txt": "before\n", ".gitignore": "ignored.txt\n" });
    const options = { cwd, encoding: "utf8" as const };
    const prefix = ["--no-optional-locks", "--literal-pathspecs"];
    const base = execFileSync("git", [...prefix, "rev-parse", "--verify", "--end-of-options", "HEAD^{commit}"], options).trim();
    writeFileSync(path.join(cwd, "tracked.txt"), "committed\n");
    execFileSync("git", ["commit", "-qam", "fixture range"], options);
    const head = execFileSync("git", [...prefix, "rev-parse", "--verify", "--end-of-options", "HEAD^{commit}"], options).trim();
    assert.equal(execFileSync("git", [...prefix, "merge-base", "--all", head, base], options).trim(), base);
    writeFileSync(path.join(cwd, "tracked.txt"), "staged\n");
    execFileSync("git", ["add", "--", "tracked.txt"], options);
    writeFileSync(path.join(cwd, "tracked.txt"), "staged\nunstaged\n");
    const untracked = "--literal [name].txt";
    writeFileSync(path.join(cwd, untracked), "untracked evidence\n");
    writeFileSync(path.join(cwd, "ignored.txt"), "ignored fixture\n");
    const index = readFileSync(path.join(cwd, ".git", "index"));
    const pending = execFileSync("git", [...prefix, "diff", "--no-ext-diff", "--no-textconv", "--binary", head, "--"], options);
    assert.match(pending, /\+staged\n\+unstaged/);
    assert.match(execFileSync("git", [...prefix, "diff", "--no-ext-diff", "--no-textconv", "--binary", base, head, "--"], options), /\+committed/);
    assert.equal(execFileSync("git", [...prefix, "ls-files", "--others", "--exclude-standard", "-z"], options), `${untracked}\0`);
    assert.equal(readFileSync(path.join(cwd, untracked), "utf8"), "untracked evidence\n");
    assert.deepEqual(readFileSync(path.join(cwd, ".git", "index")), index);
  });
});

test("rendered Codex security judges directly in a read-only role with the existing terminal and handoff contract", () => {
  assert.match(role, /sandbox_mode = "read-only"/);
  assert.match(role, /model = "gpt-6-astra"/);
  assert.match(role, /model_reasoning_effort = "low"/);
  assert.match(role, /oso-handoff: v=1 slice=<ID> attempt=<N>/);
  assert.match(reference, /Security Pass: direct — covered: staged, unstaged, and untracked changes/);
  assert.match(reference, /Security Pass: direct — covered: merge base of HEAD and <base-ref> through HEAD, plus staged, unstaged, and untracked changes/);
  assert.doesNotMatch(reference + role, /codex review|danger-full-access|nested authenticated CLI/);
  assert.match(wrapper, /\*\*Host-declared direct path\*\*/);
  for (const verdict of ["clean", "findings", "blocked"]) assert.ok(wrapper.includes(`Security Pass: ${verdict}`));
});

test("direct acquisition requires complete safe fresh evidence on both routes", () => {
  for (const contract of [
    "git --no-optional-locks --literal-pathspecs",
    "--no-ext-diff --no-textconv",
    "ls-files --others --exclude-standard -z",
    "rev-parse --verify --end-of-options",
    "merge-base --all",
    "NUL",
    "unchanged caller",
    "symbolic links",
    "opaque",
    "denied",
    "fingerprints",
    "paginate",
    "never write the index",
  ]) assert.ok(reference.includes(contract), contract);
});
