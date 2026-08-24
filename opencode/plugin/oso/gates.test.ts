import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { routes, type OpenCodeGateRoute } from "../../hooks/routes.ts";
import {
  assertGateRoutesCompile,
  checkHarnessInstalled,
  composeEnvelope,
  matchesTool,
  resolveHookScript,
  resolveStateBin,
  runGate,
  type GateVerdict,
  type ToolExecuteInput,
  type ToolExecuteOutput,
} from "./gates.ts";
import { publishIdentity } from "./identity.ts";

function fixtureDir(): string {
  return mkdtempSync(join(tmpdir(), "oso-gates-test-"));
}

function repositoryShapedDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "oso-gates-repo-"));
  mkdirSync(join(dir, ".git", "objects"), { recursive: true });
  writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
  return dir;
}

const ENVELOPE_READ = 'envelope="$(cat)"\n';

function writeGate(dir: string, name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, `${ENVELOPE_READ}${body}`, { mode: 0o755 });
  return path;
}

function writeGateVerbatim(dir: string, name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, body, { mode: 0o755 });
  return path;
}

const DENY_JSON =
  '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"the remedy"}}';

const route = (script: string, allow: readonly string[] = []): OpenCodeGateRoute => ({
  hook: "tool.execute.before",
  gate: "test",
  script,
  matcher: ".*",
  allow,
});

const input: ToolExecuteInput = { tool: "bash", sessionID: "ses-test", callID: "call-1", cwd: tmpdir() };
const output: ToolExecuteOutput = { args: {} };

function denyEchoingGate(dir: string, name: string, envelopeVar: string): void {
  writeGate(
    dir,
    name,
    `printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\\n' "${envelopeVar}"\nexit 0\n`,
  );
}

function run(dir: string, r: OpenCodeGateRoute, i = input, o = output): GateVerdict {
  return runGate(r, i, o, { hooksDir: dir, timeoutMs: 2_000 });
}

test("deny: exit 0 with a deny JSON throws a deny verdict carrying the reason", () => {
  const dir = fixtureDir();
  writeGate(dir, "deny.sh", `printf '%s\n' '${DENY_JSON}'\nexit 0\n`);
  const verdict = run(dir, route("deny.sh"));
  assert.equal(verdict.kind, "deny");
  assert.equal(verdict.message, "the remedy");
  rmSync(dir, { recursive: true, force: true });
});

test("allow: exit 0 with empty stdout is a pass-through", () => {
  const dir = fixtureDir();
  writeGate(dir, "allow.sh", "exit 0\n");
  const verdict = run(dir, route("allow.sh"));
  assert.equal(verdict.kind, "allow");
  rmSync(dir, { recursive: true, force: true });
});

test("allow: exit 0 with non-decision stdout is a pass-through", () => {
  const dir = fixtureDir();
  writeGate(dir, "noise.sh", "printf 'not a verdict\\n'\nexit 0\n");
  const verdict = run(dir, route("noise.sh"));
  assert.equal(verdict.kind, "allow");
  rmSync(dir, { recursive: true, force: true });
});

test("block: exit 2 with stderr is a block carrying the stderr message", () => {
  const dir = fixtureDir();
  writeGate(dir, "block.sh", "printf 'oso-code: gate exploded\\n' >&2\nexit 2\n");
  const verdict = run(dir, route("block.sh"));
  assert.equal(verdict.kind, "block");
  assert.equal(verdict.message, "oso-code: gate exploded");
  rmSync(dir, { recursive: true, force: true });
});

test("unexpected exit blocks fail-closed with the stderr message", () => {
  const dir = fixtureDir();
  writeGate(dir, "crash.sh", "printf 'boom\\n' >&2\nexit 3\n");
  const verdict = run(dir, route("crash.sh"));
  assert.equal(verdict.kind, "block");
  assert.equal(verdict.message, "boom");
  rmSync(dir, { recursive: true, force: true });
});

test("unexpected exit with no stderr blocks fail-closed with a named message", () => {
  const dir = fixtureDir();
  writeGate(dir, "silent-crash.sh", "exit 3\n");
  const verdict = run(dir, route("silent-crash.sh"));
  assert.equal(verdict.kind, "block");
  assert.match(verdict.message, /silent-crash\.sh/);
  assert.match(verdict.message, /exit 3/);
  rmSync(dir, { recursive: true, force: true });
});

test("a timed-out gate blocks", () => {
  const dir = fixtureDir();
  writeGate(dir, "hang.sh", "sleep 30\n");
  const verdict = run(dir, route("hang.sh"));
  assert.equal(verdict.kind, "block");
  rmSync(dir, { recursive: true, force: true });
});

const A_COMMAND_TOO_LONG_FOR_THE_PIPE_BUFFER = "x".repeat(2_000_000);

const oversizedCall: ToolExecuteOutput = { args: { command: A_COMMAND_TOO_LONG_FOR_THE_PIPE_BUFFER } };

test("a gate that dies whenever it is handed an envelope blocks at every command length", () => {
  const dir = fixtureDir();
  writeGateVerbatim(dir, "dies-on-its-envelope.sh", 'if IFS= read -r -n1 _; then kill -9 $$; fi\nexit 0\n');
  const shortCommand = run(dir, route("dies-on-its-envelope.sh"), input, { args: { command: "git commit -m x" } });
  const longCommand = run(dir, route("dies-on-its-envelope.sh"), input, oversizedCall);
  assert.deepEqual([shortCommand.kind, longCommand.kind], ["block", "block"]);
  rmSync(dir, { recursive: true, force: true });
});

test("a gate that exits 0 without reading its envelope decided on nothing, so it blocks rather than allows", () => {
  const dir = fixtureDir();
  writeGateVerbatim(dir, "unread.sh", "exit 0\n");
  const verdict = run(dir, route("unread.sh"), input, oversizedCall);
  assert.equal(verdict.kind, "block");
  assert.match(verdict.message, /before reading its envelope/);
  rmSync(dir, { recursive: true, force: true });
});

test("a missing gate script blocks fail-closed", () => {
  const verdict = runGate(route("absent.sh"), input, output, {
    hooksDir: fixtureDir(),
    timeoutMs: 2_000,
  });
  assert.equal(verdict.kind, "block");
  assert.match(verdict.message, /not found/);
});

test("envelope: the bash command line becomes the command field", () => {
  const envelope = composeEnvelope(input, { args: { script: "git commit -m x" } });
  assert.equal(envelope.command, "git commit -m x");
  assert.equal(envelope.session_id, "ses-test");
  assert.equal(envelope.cwd, input.cwd);
  assert.equal(envelope.tool_name, "bash");
});

test("envelope: a command-bearing tool without a script keeps its command", () => {
  const envelope = composeEnvelope(input, { args: { command: "apply_patch x" } });
  assert.equal(envelope.command, "apply_patch x");
});

test("envelope: filePath maps to file_path", () => {
  const envelope = composeEnvelope(input, { args: { filePath: "/repo/src/a.ts" } });
  assert.equal(envelope.file_path, "/repo/src/a.ts");
});

test("envelope: a missing filePath stays absent from the envelope", () => {
  const envelope = composeEnvelope(input, { args: {} });
  assert.equal("file_path" in envelope, false);
});

test("envelope: cwd falls back to the process working directory", () => {
  const envelope = composeEnvelope({ tool: "bash", sessionID: "s" }, { args: {} });
  assert.equal(envelope.cwd, process.cwd());
});

test("matcher: an edits matcher applies to the native writers and nothing else", () => {
  const matcher = "edit|write|fallow_fix_apply|apply_patch";
  assert.equal(matchesTool(matcher, "edit"), true);
  assert.equal(matchesTool(matcher, "write"), true);
  assert.equal(matchesTool(matcher, "apply_patch"), true);
  assert.equal(matchesTool(matcher, "bash"), false);
  assert.equal(matchesTool(matcher, "read"), false);
});

test("matcher: a catch-all matcher applies to any tool", () => {
  assert.equal(matchesTool(".*", "anything_else"), true);
});

test("matcher: a matcher no regular expression compiles from is a broken route table, never an empty match set", () => {
  assert.throws(() => matchesTool("(unclosed", "bash"), /gate route table/);
});

test("matcher: every route the installed table carries is compiled before any tool call reaches it", () => {
  assert.throws(
    () => assertGateRoutesCompile([route("any.sh"), { ...route("any.sh"), matcher: "(unclosed" }]),
    /\(unclosed/,
  );
  assert.doesNotThrow(() => assertGateRoutesCompile(routes));
});

test("allow list: the unknown-tool gate receives its route allow list", () => {
  const dir = fixtureDir();
  writeGate(
    dir,
    "allowcheck.sh",
    'if [ "${1:-}" = --allow ] && [ "${2:-}" = "edit|write" ]; then exit 0; fi\nprintf \'%s\\n\' \'' + DENY_JSON + "'\nexit 0\n",
  );
  const allowed = run(dir, route("allowcheck.sh", ["edit", "write"]));
  assert.equal(allowed.kind, "allow");
  const without = run(dir, route("allowcheck.sh"));
  assert.equal(without.kind, "deny");
  rmSync(dir, { recursive: true, force: true });
});

test("harness install check: every referenced script present is installed", () => {
  const dir = fixtureDir();
  writeGate(dir, "a.sh", "exit 0\n");
  writeGate(dir, "b.sh", "exit 0\n");
  const status = checkHarnessInstalled([route("a.sh"), route("b.sh")], { hooksDir: dir });
  assert.equal(status.installed, true);
  assert.deepEqual(status.missing, []);
  rmSync(dir, { recursive: true, force: true });
});

test("harness install check: a missing script is reported and not installed", () => {
  const dir = fixtureDir();
  writeGate(dir, "a.sh", "exit 0\n");
  const status = checkHarnessInstalled([route("a.sh"), route("absent.sh")], { hooksDir: dir });
  assert.equal(status.installed, false);
  assert.match(status.missing[0] ?? "", /absent\.sh$/);
  rmSync(dir, { recursive: true, force: true });
});

test("harness install check: the same missing script referenced by two routes is reported once", () => {
  const dir = fixtureDir();
  const status = checkHarnessInstalled([route("absent.sh"), route("absent.sh")], { hooksDir: dir });
  assert.equal(status.installed, false);
  assert.equal(status.missing.length, 1);
  rmSync(dir, { recursive: true, force: true });
});

test("the gate reads the envelope it is handed", () => {
  const dir = fixtureDir();
  writeGate(
    dir,
    "reads.sh",
    'case "$envelope" in *"\\"command\\":\\"git commit\\""*"\\"session_id\\":\\"ses-test\\""*) exit 0 ;; *) exit 2 ;;\nesac\n',
  );
  const verdict = run(dir, route("reads.sh"), input, { args: { script: "git commit" } });
  assert.equal(verdict.kind, "allow");
  rmSync(dir, { recursive: true, force: true });
});

test("the gate is spawned with its process cwd set to the call's cwd", () => {
  const dir = fixtureDir();
  const callCwd = mkdtempSync(join(tmpdir(), "oso-gates-cwd-"));
  denyEchoingGate(dir, "cwd.sh", "$PWD");
  const verdict = run(dir, route("cwd.sh"), { ...input, cwd: callCwd });
  assert.equal(verdict.kind, "deny");
  assert.equal(verdict.message, callCwd);
  rmSync(dir, { recursive: true, force: true });
  rmSync(callCwd, { recursive: true, force: true });
});

test("the gate is spawned with OSO_AGENT set to the call directory's root session id, never the host's own", () => {
  const dir = fixtureDir();
  const callCwd = repositoryShapedDir();
  denyEchoingGate(dir, "agent.sh", "$OSO_AGENT");
  const verdict = run(dir, route("agent.sh"), { ...input, sessionID: "ses-agent-check", cwd: callCwd });
  assert.equal(verdict.kind, "deny");
  assert.equal(verdict.message, publishIdentity(callCwd).OSO_AGENT);
  assert.notEqual(verdict.message, "ses-agent-check");
  rmSync(dir, { recursive: true, force: true });
  rmSync(callCwd, { recursive: true, force: true });
});

test("the gate is spawned with OSO_HOST naming this host, so shared prose picks this host's spelling", () => {
  const dir = fixtureDir();
  denyEchoingGate(dir, "host.sh", "$OSO_HOST");
  const verdict = run(dir, route("host.sh"));
  assert.equal(verdict.kind, "deny");
  assert.equal(verdict.message, "opencode");
  rmSync(dir, { recursive: true, force: true });
});

test("the gate is spawned with OSO_STATE_BIN resolved to the sibling bin/oso-state of the gate tree", () => {
  const dir = fixtureDir();
  denyEchoingGate(dir, "statebin.sh", "$OSO_STATE_BIN");
  const verdict = run(dir, route("statebin.sh"));
  assert.equal(verdict.kind, "deny");
  assert.equal(verdict.message, resolve(dir, "..", "bin", "oso-state"));
  rmSync(dir, { recursive: true, force: true });
});

test("resolveStateBin: resolves to the sibling bin/oso-state of an explicit hooks directory", () => {
  const dir = fixtureDir();
  assert.equal(resolveStateBin(dir), resolve(dir, "..", "bin", "oso-state"));
  rmSync(dir, { recursive: true, force: true });
});

test("resolveStateBin: with no hooksDir, it resolves through the same fallback resolveHookScript uses", () => {
  const expectedHooksDir = dirname(resolveHookScript("cross-check-probe.sh"));
  assert.equal(resolveStateBin(), resolve(expectedHooksDir, "..", "bin", "oso-state"));
});

test("resolveHookScript: with no hooksDir and no OSO_HOOKS_DIR, it lands on this module's own installed-layout hooks sibling", () => {
  const previousHooksDir = process.env.OSO_HOOKS_DIR;
  delete process.env.OSO_HOOKS_DIR;
  const thisTestFileDir = dirname(fileURLToPath(import.meta.url));
  const installedConfigRoot = dirname(dirname(thisTestFileDir));
  const expected = join(installedConfigRoot, "hooks", "cross-check-probe.sh");
  assert.equal(resolveHookScript("cross-check-probe.sh"), expected);
  if (previousHooksDir === undefined) {
    delete process.env.OSO_HOOKS_DIR;
  } else {
    process.env.OSO_HOOKS_DIR = previousHooksDir;
  }
});
