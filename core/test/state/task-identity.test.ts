import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runGate } from "../../src/gates/dispatch.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { withHookEnvironment } from "../support/gate-fixture.ts";

const cli = fileURLToPath(new URL("../../src/bin/oso-state.ts", import.meta.url));
const SESSION = "identity-session";
const AGENT = "11111111-1111-4111-8111-111111111111";
const HANDOFF = ["--slice", "s4", "--attempt", "1", "--agent-id", AGENT, "--agent-type", "oso-applier"];
const GITFILE_THAT_IS_NOT_A_GITFILE = "[core]\n\trepositoryformatversion = 0\n";
const PLAN_DIGEST = "a".repeat(64);
const PLAN_DOCUMENT = "# Plan\n\nOne prose plan that opens no slice.\n";
const CARRIED_FAMILIES = ["deploy-deny", "profiles", "runs", "plans", ".handoffs"] as const;
const GATES_A_RED_RUN_DENIES = [
  { gate: "commit", command: "git commit -m x" },
  { gate: "proddeploy", command: "terraform apply" },
] as const;
const RACING_PROCESSES = 6;
const A_CARRY_LONG_ENOUGH_TO_RACE = 400000;

type Run = Readonly<{ exit: number | null; stdout: string; stderr: string }>;
type Where = Readonly<{ cwd?: string; env?: Readonly<Record<string, string>>; input?: string }>;
type GateCall = Readonly<{ gate: string; cwd: string; command: string; env?: Readonly<Record<string, string>> }>;

type Tree = Readonly<{
  root: string;
  stateRoot: string;
  declaredRoot: string;
  nested: string;
  plain: string;
  run: (argv: readonly string[], where?: Where) => Run;
  race: (argv: readonly string[], where?: Where) => Promise<Run>;
}>;

function git(cwd: string, argv: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("git", ["-C", cwd, ...argv], { encoding: "utf8" });
  if (result.error !== undefined) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function commonDirectoryOf(repository: string): string {
  const named = git(repository, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  assert.equal(named.status, 0, named.stderr);
  return named.stdout.trimEnd();
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stateFileNames(tree: Tree): string[] {
  return readdirSync(tree.stateRoot).filter((entry) => entry.endsWith(".state")).sort();
}

function journalOf(tree: Tree, identity: string): string {
  return path.join(tree.stateRoot, "runs", digest(identity), "run.log");
}

async function withTree(use: (tree: Tree) => void | Promise<void>): Promise<void> {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "oso-task-identity-")));
  try {
    await use(treeUnder(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function treeUnder(root: string): Tree {
  const declaredRoot = path.join(root, "MPA");
  const nested = path.join(declaredRoot, "bcs-mpa-core");
  const plain = path.join(root, "plain");
  mkdirSync(declaredRoot);
  writeFileSync(path.join(declaredRoot, ".git"), GITFILE_THAT_IS_NOT_A_GITFILE);
  for (const repository of [nested, plain]) {
    mkdirSync(repository, { recursive: true });
    assert.equal(git(repository, ["init", "--quiet"]).status, 0);
  }
  const stateRoot = path.join(root, "state");
  const ambient = { PATH: process.env["PATH"] ?? "", HOME: root, USERPROFILE: root, OSO_STATE_DIR: stateRoot };
  const spawnArguments = (argv: readonly string[], where: Where) =>
    [["--experimental-strip-types", cli, ...argv], { cwd: where.cwd ?? declaredRoot, env: { ...ambient, ...where.env } }] as const;
  const run = (argv: readonly string[], where: Where = {}): Run => {
    const [argumentList, options] = spawnArguments(argv, where);
    const result = spawnSync(process.execPath, argumentList, { ...options, encoding: "utf8", timeout: 30000, input: where.input });
    if (result.error !== undefined) throw result.error;
    return { exit: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  const race = (argv: readonly string[], where: Where = {}): Promise<Run> => {
    const [argumentList, options] = spawnArguments(argv, where);
    const child = spawn(process.execPath, argumentList, options);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    return new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (exit) => resolve({ exit, stdout, stderr }));
    });
  };
  return { root, stateRoot, declaredRoot, nested, plain, run, race };
}

function gateRun(tree: Tree, call: GateCall) {
  const payload = JSON.stringify({
    session_id: SESSION,
    cwd: call.cwd,
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: call.command },
  });
  return withHookEnvironment({ HOME: tree.root, OSO_STATE_DIR: tree.stateRoot, ...call.env }, () =>
    runGate([call.gate], spawnedEnvelope(payload, process.env)),
  );
}

function armLegacyTaskHoldingEveryArtifact(tree: Tree): string {
  const at = { cwd: tree.nested };
  for (const argv of [
    ["--session", SESSION, "set", "auto=running", "verify_green=false"],
    ["--session", SESSION, "deny-pattern", "add", "terraform apply"],
    ["journal", "legacy milestone"],
    ["handoff", "publish", ...HANDOFF, "--hook-session", AGENT],
  ]) {
    assert.equal(tree.run(argv, at).exit, 0, argv.join(" "));
  }
  assert.equal(tree.run(["--session", SESSION, "capture-plan", PLAN_DIGEST], { ...at, input: PLAN_DOCUMENT }).exit, 0);
  const legacy = commonDirectoryOf(tree.nested);
  mkdirSync(path.join(tree.stateRoot, "profiles"), { recursive: true });
  writeFileSync(path.join(tree.stateRoot, "profiles", `${digest(legacy)}.profile`), "tier=floor\n");
  return legacy;
}

function keysUnder(tree: Tree, family: string): string[] {
  return readdirSync(path.join(tree.stateRoot, family)).map((entry) => entry.split(".")[0] ?? "").sort();
}

function migrationsRecorded(tree: Tree): number {
  const events = readFileSync(path.join(tree.stateRoot, "events.jsonl"), "utf8").split("\n");
  return events.filter((line) => line.includes("identity-migrated")).length;
}

test("a declared root is one task identity from its own tree and from a repository nested inside it", () =>
  withTree((tree) => {
    const declared = { OSO_TASK_ROOT: tree.declaredRoot };
    const armed = tree.run(["--session", SESSION, "set", "verify_green=false"], { env: declared });
    assert.equal(armed.exit, 0, armed.stderr);
    const shown = tree.run(["--session", SESSION, "show"], { cwd: tree.nested, env: declared });
    assert.equal(shown.exit, 0, shown.stderr);
    assert.match(shown.stdout, /verify_green=false/);
    assert.deepEqual(stateFileNames(tree), [`${digest(tree.declaredRoot)}.state`]);
  }));

test("one repository keeps one identity from its root, from a subdirectory and from a linked worktree", () =>
  withTree((tree) => {
    const inner = path.join(tree.plain, "src", "deep");
    mkdirSync(inner, { recursive: true });
    const committed = git(tree.plain, ["-c", "user.name=t", "-c", "user.email=t@t.invalid", "commit", "-q", "--allow-empty", "-m", "base"]);
    assert.equal(committed.status, 0, committed.stderr);
    const worktree = path.join(tree.root, "linked");
    assert.equal(git(tree.plain, ["worktree", "add", "--quiet", "--detach", worktree]).status, 0);
    const armed = tree.run(["--session", SESSION, "set", "mode=plan"], { cwd: tree.plain });
    assert.equal(armed.exit, 0, armed.stderr);
    const journals = new Set<string>();
    for (const directory of [tree.plain, inner, worktree]) {
      const shown = tree.run(["--session", SESSION, "show"], { cwd: directory });
      assert.equal(shown.exit, 0, shown.stderr);
      assert.match(shown.stdout, /mode=plan/);
      journals.add(tree.run(["journal", "--path"], { cwd: directory }).stdout);
    }
    assert.equal(journals.size, 1);
    assert.deepEqual(stateFileNames(tree), [`${digest(commonDirectoryOf(tree.plain))}.state`]);
  }));

test("a declared root with no git of its own carries state, a journal and a receipt round trip", () =>
  withTree((tree) => {
    const notes = path.join(tree.root, "notes");
    mkdirSync(notes);
    const at = { cwd: notes, env: { OSO_TASK_ROOT: notes } };
    const armed = tree.run(["--session", SESSION, "set", "mode=quick"], at);
    assert.equal(armed.exit, 0, armed.stderr);
    assert.match(tree.run(["--session", SESSION, "show"], at).stdout, /mode=quick/);
    assert.equal(tree.run(["journal", "milestone one"], at).exit, 0);
    assert.match(readFileSync(tree.run(["journal", "--path"], at).stdout.trimEnd(), "utf8"), /milestone one/);
    assert.equal(tree.run(["handoff", "publish", ...HANDOFF, "--hook-session", AGENT], at).exit, 0);
    assert.match(tree.run(["handoff", "wait", ...HANDOFF, "--timeout", "0"], at).stdout, new RegExp(`agent_id=${AGENT}`));
    assert.match(tree.run(["handoff", "consume", ...HANDOFF], at).stdout, new RegExp(`agent_id=${AGENT}`));
    assert.deepEqual(stateFileNames(tree), [`${digest(notes)}.state`]);
  }));

test("git refusing with no declared root names the variable, the remedy and git's own cause, and guesses nothing", () =>
  withTree((tree) => {
    const refused = tree.run(["--session", SESSION, "set", "mode=plan"], { cwd: tree.declaredRoot });
    assert.equal(refused.exit, 1);
    assert.match(refused.stderr, /OSO_TASK_ROOT/);
    assert.ok(refused.stderr.includes(git(tree.declaredRoot, ["rev-parse", "--git-common-dir"]).stderr.trimEnd()), refused.stderr);
    assert.equal(existsSync(path.join(tree.stateRoot, `${digest(tree.declaredRoot)}.state`)), false);
  }));

test("a receipt published while git's own environment is exported lands where the same tree reads it", () =>
  withTree((tree) => {
    const underGitsEnvironment = { cwd: tree.nested, env: { GIT_DIR: path.join(tree.plain, ".git") } };
    const published = tree.run(["handoff", "publish", ...HANDOFF, "--hook-session", AGENT], underGitsEnvironment);
    assert.equal(published.exit, 0, published.stderr);
    const waited = tree.run(["handoff", "wait", ...HANDOFF, "--timeout", "0"], { cwd: tree.nested });
    assert.equal(waited.exit, 0, waited.stderr);
    assert.deepEqual(readdirSync(path.join(tree.stateRoot, ".handoffs")), [digest(commonDirectoryOf(tree.nested))]);
  }));

test("one legacy identity holding state migrates to the declared root, traceably, with the journal's provenance kept", () =>
  withTree((tree) => {
    const declared = { OSO_TASK_ROOT: tree.declaredRoot };
    assert.equal(tree.run(["--session", SESSION, "set", "verify_green=false"], { cwd: tree.nested }).exit, 0);
    assert.equal(tree.run(["journal", "legacy milestone"], { cwd: tree.nested }).exit, 0);
    assert.equal(tree.run(["journal", "declared milestone"], { env: declared }).exit, 0);
    const shown = tree.run(["--session", SESSION, "show"], { cwd: tree.nested, env: declared });
    assert.equal(shown.exit, 0, shown.stderr);
    assert.match(shown.stdout, /verify_green=false/);
    assert.deepEqual(stateFileNames(tree), [`${digest(tree.declaredRoot)}.state`]);
    assert.match(readFileSync(path.join(tree.stateRoot, "events.jsonl"), "utf8"), /identity-migrated/);
    const merged = readFileSync(journalOf(tree, tree.declaredRoot), "utf8").split("\n");
    assert.ok(merged.some((line) => line.includes("declared milestone")), merged.join("\n"));
    const carried = merged.find((line) => line.includes("legacy milestone"));
    assert.ok(carried !== undefined && carried.includes(commonDirectoryOf(tree.nested)), merged.join("\n"));
  }));

test("two identities holding state are refused with both candidates and what each holds, never merged", () =>
  withTree((tree) => {
    const declared = { OSO_TASK_ROOT: tree.declaredRoot };
    assert.equal(tree.run(["--session", SESSION, "set", "verify_green=true"], { env: declared }).exit, 0);
    assert.equal(tree.run(["--session", SESSION, "set", "verify_green=false"], { cwd: tree.nested }).exit, 0);
    const refused = tree.run(["--session", SESSION, "show"], { cwd: tree.nested, env: declared });
    assert.equal(refused.exit, 1);
    for (const named of [tree.declaredRoot, commonDirectoryOf(tree.nested), "verify_green=true", "verify_green=false"]) {
      assert.ok(refused.stderr.includes(named), refused.stderr);
    }
    assert.equal(stateFileNames(tree).length, 2);
  }));

test("a receipt collision refuses the migration rather than choosing between two agents' receipts", () =>
  withTree((tree) => {
    const declared = { OSO_TASK_ROOT: tree.declaredRoot };
    const publish = ["handoff", "publish", ...HANDOFF, "--hook-session", AGENT];
    assert.equal(tree.run(publish, { cwd: tree.nested }).exit, 0);
    assert.equal(tree.run(publish, { env: declared }).exit, 0);
    assert.equal(tree.run(["--session", SESSION, "set", "verify_green=false"], { cwd: tree.nested }).exit, 0);
    const refused = tree.run(["--session", SESSION, "show"], { cwd: tree.nested, env: declared });
    assert.equal(refused.exit, 1);
    assert.match(refused.stderr, /receipt/);
  }));

test("a gate that would have allowed because the identity moved denies instead and names the migration", () =>
  withTree((tree) => {
    assert.equal(tree.run(["--session", SESSION, "set", "mode=plan", "verify_green=false"], { cwd: tree.nested }).exit, 0);
    const declared = { OSO_TASK_ROOT: tree.declaredRoot };
    const run = gateRun(tree, { gate: "commit", cwd: tree.nested, command: "git commit -m x", env: declared });
    assert.equal(run.verdict.kind, "deny");
    assert.match(JSON.stringify(run.verdict), /OSO_TASK_ROOT/);
  }));

test("a declaration that does not contain the cwd leaves an unrelated repository resolving by git, untouched", () =>
  withTree((tree) => {
    const declared = { OSO_TASK_ROOT: tree.declaredRoot };
    const elsewhere = { cwd: tree.plain };
    assert.equal(tree.run(["--session", SESSION, "set", "mode=plan", "verify_green=false"], elsewhere).exit, 0);
    assert.equal(tree.run(["journal", "plain milestone"], elsewhere).exit, 0);
    const readVerb = tree.run(["--session", SESSION, "show"], { ...elsewhere, env: declared });
    assert.equal(readVerb.exit, 0, readVerb.stderr);
    assert.match(readVerb.stdout, /verify_green=false/);
    const own = commonDirectoryOf(tree.plain);
    assert.deepEqual(stateFileNames(tree), [`${digest(own)}.state`]);
    assert.match(readFileSync(journalOf(tree, own), "utf8"), /plain milestone/);
    assert.deepEqual(readdirSync(path.join(tree.stateRoot, "runs")), [digest(own)]);
    const denial = gateRun(tree, { gate: "commit", cwd: tree.plain, command: "git commit -m x", env: declared });
    assert.equal(denial.verdict.kind, "deny", JSON.stringify(denial.verdict));
  }));

test("two spellings of one declared root are one identity, one state file and one journal", () =>
  withTree((tree) => {
    const bySymlinkedAncestor = path.join(tree.root, "by-symlink");
    symlinkSync(tree.root, bySymlinkedAncestor, "dir");
    const spelled = path.join(bySymlinkedAncestor, path.basename(tree.declaredRoot));
    const first = { env: { OSO_TASK_ROOT: tree.declaredRoot } };
    const second = { cwd: spelled, env: { OSO_TASK_ROOT: spelled } };
    assert.equal(tree.run(["--session", SESSION, "set", "mode=quick"], first).exit, 0);
    assert.equal(tree.run(["journal", "milestone by its real name"], first).exit, 0);
    const shown = tree.run(["--session", SESSION, "show"], second);
    assert.equal(shown.exit, 0, shown.stderr);
    assert.match(shown.stdout, /mode=quick/);
    assert.equal(tree.run(["journal", "milestone by its linked name"], second).exit, 0);
    assert.deepEqual(stateFileNames(tree), [`${digest(tree.declaredRoot)}.state`]);
    assert.deepEqual(readdirSync(path.join(tree.stateRoot, "runs")), [digest(tree.declaredRoot)]);
  }));

test("an interruption at each carried family keeps every gate denying, and the next run resumes the carry", () =>
  withTree((tree) => {
    const legacy = armLegacyTaskHoldingEveryArtifact(tree);
    const declared = { OSO_TASK_ROOT: tree.declaredRoot };
    const at = { cwd: tree.nested, env: declared };
    const legacyStateFile = path.join(tree.stateRoot, `${digest(legacy)}.state`);
    for (const family of CARRIED_FAMILIES) {
      const blocked = path.join(tree.stateRoot, family);
      chmodSync(blocked, 0o500);
      const interrupted = tree.run(["--session", SESSION, "show"], at);
      chmodSync(blocked, 0o700);
      assert.equal(interrupted.exit, 1, `${family}: ${interrupted.stdout}`);
      assert.match(interrupted.stderr, /stopped partway/);
      assert.equal(existsSync(legacyStateFile), true, family);
      for (const { gate, command } of GATES_A_RED_RUN_DENIES) {
        const verdict = gateRun(tree, { gate, cwd: tree.nested, command, env: declared }).verdict;
        assert.equal(verdict.kind, "deny", `${gate} after ${family}: ${JSON.stringify(verdict)}`);
      }
    }
    const carried = tree.run(["--session", SESSION, "show"], at);
    assert.equal(carried.exit, 0, carried.stderr);
    const declaredKey = digest(tree.declaredRoot);
    const declaredStateFile = path.join(tree.stateRoot, `${declaredKey}.state`);
    writeFileSync(legacyStateFile, readFileSync(declaredStateFile, "utf8").replaceAll(declaredKey, digest(legacy)));
    rmSync(declaredStateFile);
    const resumedAtItsLastStep = tree.run(["--session", SESSION, "show"], at);
    assert.equal(resumedAtItsLastStep.exit, 0, resumedAtItsLastStep.stderr);
    assert.deepEqual(stateFileNames(tree), [`${declaredKey}.state`]);
    for (const family of CARRIED_FAMILIES) assert.deepEqual(keysUnder(tree, family), [declaredKey], family);
  }));

test("racing oso-state processes carry the state once, leaking no filesystem error and no false second identity", () =>
  withTree(async (tree) => {
    const declared = { OSO_TASK_ROOT: tree.declaredRoot };
    assert.equal(tree.run(["journal", "declared milestone"], { env: declared }).exit, 0);
    assert.equal(tree.run(["--session", SESSION, "set", "verify_green=false"], { cwd: tree.nested }).exit, 0);
    assert.equal(tree.run(["journal", "legacy milestone"], { cwd: tree.nested }).exit, 0);
    writeFileSync(journalOf(tree, commonDirectoryOf(tree.nested)), "legacy milestone\n".repeat(A_CARRY_LONG_ENOUGH_TO_RACE));
    const racing = await Promise.all(
      Array.from({ length: RACING_PROCESSES }, () =>
        tree.race(["--session", SESSION, "show"], { cwd: tree.nested, env: declared }),
      ),
    );
    for (const one of racing) {
      assert.equal(one.exit, 0, one.stderr);
      assert.match(one.stdout, /verify_green=false/);
      assert.doesNotMatch(one.stderr, /ENOENT|two task identities/);
    }
    assert.deepEqual(stateFileNames(tree), [`${digest(tree.declaredRoot)}.state`]);
    assert.equal(migrationsRecorded(tree), 1);
  }));

test("a pending plan survives the carry, so approve-plan still exits 0 under the declared identity", () =>
  withTree((tree) => {
    const declared = { OSO_TASK_ROOT: tree.declaredRoot };
    const at = { cwd: tree.nested, env: declared };
    armLegacyTaskHoldingEveryArtifact(tree);
    const approved = tree.run(["--session", SESSION, "approve-plan", PLAN_DIGEST], at);
    assert.equal(approved.exit, 0, approved.stderr);
    const declaredPlans = path.join(tree.stateRoot, "plans", digest(tree.declaredRoot));
    const shown = tree.run(["--session", SESSION, "show"], at);
    assert.ok(shown.stdout.includes(`plan_current_file=${path.join(declaredPlans, "current.md")}`), shown.stdout);
    assert.ok(shown.stdout.includes(`plan_snapshot_file=${path.join(declaredPlans, `approved-${PLAN_DIGEST}.md`)}`), shown.stdout);
  }));

test("durable artifacts standing at the inferred identity with no state file to announce them still carry over", () =>
  withTree((tree) => {
    const legacy = armLegacyTaskHoldingEveryArtifact(tree);
    rmSync(path.join(tree.stateRoot, `${digest(legacy)}.state`));
    const at = { cwd: tree.nested, env: { OSO_TASK_ROOT: tree.declaredRoot } };
    const carried = tree.run(["--session", SESSION, "show"], at);
    assert.equal(carried.exit, 0, carried.stderr);
    for (const family of CARRIED_FAMILIES) assert.deepEqual(keysUnder(tree, family), [digest(tree.declaredRoot)], family);
    assert.equal(tree.run(["--session", SESSION, "set", "auto=running"], at).exit, 0);
    const boundary = gateRun(tree, { gate: "proddeploy", cwd: tree.nested, command: "terraform apply", env: at.env });
    assert.equal(boundary.verdict.kind, "deny", JSON.stringify(boundary.verdict));
  }));

test("a declaration narrower than the repository is one identity with it, so a sibling tree of that repository is gated", () =>
  withTree((tree) => {
    const [api, web] = ["api", "web"].map((name) => path.join(tree.nested, name));
    for (const directory of [api, web]) mkdirSync(directory as string);
    const declared = { OSO_TASK_ROOT: api as string };
    const armed = tree.run(["--session", SESSION, "set", "auto=running", "verify_green=false"], { cwd: api, env: declared });
    assert.equal(armed.exit, 0, armed.stderr);
    const denial = gateRun(tree, { gate: "commit", cwd: web as string, command: "git commit -m x", env: declared });
    assert.equal(denial.verdict.kind, "deny", JSON.stringify(denial.verdict));
    assert.match(readFileSync(path.join(tree.stateRoot, "events.jsonl"), "utf8"), /identity-rekeyed/);
  }));

test("a run armed at a declared root above this directory gates a process that never saw the declaration", () =>
  withTree((tree) => {
    const armed = tree.run(["--session", SESSION, "set", "auto=running", "verify_green=false"], { env: { OSO_TASK_ROOT: tree.declaredRoot } });
    assert.equal(armed.exit, 0, armed.stderr);
    const undeclared = gateRun(tree, { gate: "proddeploy", cwd: tree.nested, command: "vercel deploy --prod" });
    assert.equal(undeclared.verdict.kind, "deny", JSON.stringify(undeclared.verdict));
    assert.ok(JSON.stringify(undeclared.verdict).includes(tree.declaredRoot), JSON.stringify(undeclared.verdict));
    assert.match(readFileSync(path.join(tree.stateRoot, "events.jsonl"), "utf8"), /boundary-unpatterned/);
  }));

test("a wave worktree outside the declared root is gated by the run armed over the repository it belongs to", () =>
  withTree((tree) => {
    const committed = git(tree.nested, ["-c", "user.name=t", "-c", "user.email=t@t.invalid", "commit", "-q", "--allow-empty", "-m", "base"]);
    assert.equal(committed.status, 0, committed.stderr);
    const worktree = path.join(tree.stateRoot, "worktrees", SESSION, "1");
    assert.equal(git(tree.nested, ["worktree", "add", "--quiet", "--detach", worktree]).status, 0);
    const armed = tree.run(["--session", SESSION, "set", "auto=running", "verify_green=false"], { cwd: tree.nested, env: { OSO_TASK_ROOT: tree.nested } });
    assert.equal(armed.exit, 0, armed.stderr);
    const fromTheWave = gateRun(tree, { gate: "proddeploy", cwd: worktree, command: "vercel deploy --prod" });
    assert.equal(fromTheWave.verdict.kind, "deny", JSON.stringify(fromTheWave.verdict));
  }));
