import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertQuiescent, identityIsLive, processIdentity, sessionMembers, waitForQuiescence } from "../../src/state/scratch/process.ts";
import { skipUnlessKernelRunsScriptFixtures } from "../support/win32-skip-guards.ts";
import { stateFileFor, writeStatePairs } from "../../src/state/store.ts";

const cli = fileURLToPath(new URL("../../src/bin/oso-state.ts", import.meta.url));
const SCRATCH_CLI_DEADLINE_MS = 180000;
const RUNNING_POLL_TRIES = 6000;

async function fixture(use: (root: string, source: string, invoke: (args: string[]) => ReturnType<typeof spawnSync>) => void | Promise<void>): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "oso-scratch-test-"));
  const source = path.join(root, "source");
  mkdirSync(source);
  writeFileSync(path.join(source, "check.mjs"), 'process.stdout.write("verified\\n");');
  writeFileSync(path.join(source, "recipe.json"), JSON.stringify({
    version: 1, foreground: true, cacheRouting: "node-only", source: ["check.mjs"], dependencies: [], exclusions: ["recipe.json"],
    headroomBytes: 4096, headroomInodes: 10,
    commands: [{ purpose: "check", argv: [process.execPath, "check.mjs"] }],
  }));
  const invoke = (args: string[]) => spawnSync(process.execPath, [cli, "scratch", ...args], {
    cwd: source, env: { PATH: process.env["PATH"], HOME: root, USERPROFILE: root, OSO_STATE_DIR: path.join(root, "state"), OSO_TASK_ROOT: source }, encoding: "utf8", timeout: SCRATCH_CLI_DEADLINE_MS,
  });
  try {
    if (skipUnlessKernelRunsScriptFixtures() !== false) {
      assert.match(String(invoke(create).stderr), /Linux/);
      assert.equal(existsSync(path.join(root, "state", "verification")), false);
      return;
    }
    await use(root, source, invoke);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

const create = ["create", "--owner", "owner-token-12345678901234567890", "--run", "run1", "--assignment", "slice1", "--role", "verifier", "--attempt", "1", "--recipe", "recipe.json"];
const owner = ["--owner", "owner-token-12345678901234567890"];

function created(invoke: (args: string[]) => ReturnType<typeof spawnSync>): string {
  const result = invoke(create);
  assert.equal(result.status, 0, String(result.stderr) + String(result.stdout));
  const id = String(result.stdout).trim();
  assert.match(id, /^[a-f0-9]{32}$/);
  return id;
}

function record(root: string, id: string): Record<string, any> {
  return JSON.parse(readFileSync(path.join(root, "state", "verification", id, "record.json"), "utf8"));
}

test("scratch lifecycle creates a private independent export, supervises a literal check, and closes only its opaque ID", () => fixture((root, source, invoke) => {
  const id = created(invoke);
  const before = readFileSync(path.join(source, "check.mjs"), "utf8");
  const opened = record(root, id);
  assert.equal(opened.version, 1);
  assert.equal(opened.sourceRoot, source);
  assert.equal(opened.ordinal, 1);
  assert.equal(opened.state, "ready");
  assert.equal(lstatSync(opened.root).mode & 0o777, 0o700);
  assert.equal(lstatSync(path.join(opened.root, "record.json")).mode & 0o777, 0o600);
  assert.notEqual(lstatSync(path.join(opened.root, "payload/work/check.mjs")).ino, lstatSync(path.join(source, "check.mjs")).ino);
  assert.notEqual(opened.environment.HOME, root);
  assert.equal(invoke(create).status, 1);
  const run = invoke(["run", "--id", id, ...owner, "--purpose", "check", "--timeout", "5", "--", process.execPath, "check.mjs"]);
  assert.equal(run.status, 0, String(run.stderr));
  assert.match(String(run.stdout), /verified/);
  assert.equal(invoke(["close", "--id", id, ...owner]).status, 0);
  assert.equal(existsSync(path.join(root, "state", "verification", id, "payload")), false);
  assert.equal(record(root, id).state, "closed");
  assert.equal(readFileSync(path.join(source, "check.mjs"), "utf8"), before);
}));

function injected(root: string, source: string, args: string[], injection: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module", "-e", `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module'; ${injection}; syncBuiltinESMExports(); process.argv=[process.execPath, ${JSON.stringify(cli)}, 'scratch', ...${JSON.stringify(args)}]; await import(${JSON.stringify(pathToFileURL(cli).href)});`], {
    cwd: source, env: { HOME: root, USERPROFILE: root, PATH: process.env["PATH"], OSO_STATE_DIR: path.join(root, "state"), OSO_TASK_ROOT: source }, encoding: "utf8", timeout: SCRATCH_CLI_DEADLINE_MS,
  });
}

test("scratch capacity distinguishes unavailable inodes, counts reservations, and cleans ENOSPC/EDQUOT without retry", () => fixture((root, source, invoke) => {
  const capacity = "fs.statfsSync=()=>({bavail: 2164276864n,bsize:1n,files:1000000n,ffree:1000000n})";
  const first = injected(root, source, create, capacity);
  assert.equal(first.status, 0, String(first.stderr));
  const second = [...create];
  second[second.indexOf("--attempt") + 1] = "2";
  const recipeFile = path.join(source, "recipe.json");
  const recipe = JSON.parse(readFileSync(recipeFile, "utf8"));
  recipe.headroomBytes = 12000;
  writeFileSync(recipeFile, JSON.stringify(recipe));
  assert.match(String(injected(root, source, second, capacity).stderr), /capacity refused/);
  const closed = invoke(["close", "--id", String(first.stdout).trim(), ...owner]);
  assert.equal(closed.status, 0, String(closed.stderr) + String(closed.stdout));
  assert.match(String(injected(root, source, second, "fs.statfsSync=()=>({bavail:999999999999n,bsize:1n,files:0n,ffree:0n})").stderr), /unavailable/);
  for (const code of ["ENOSPC", "EDQUOT"]) {
    const result = injected(root, source, second, `fs.copyFileSync=()=>{throw Object.assign(new Error('${code} copy stopped'),{code:'${code}'})}`);
    assert.equal(result.status, 1);
    assert.match(String(result.stderr), new RegExp(code));
  }
  const entries = readdirSync(path.join(root, "state/verification")).map((id) => record(root, id));
  assert.equal(entries.length, 3);
  assert.ok(entries.every((entry) => entry.state === "closed" && !existsSync(path.join(entry.root, "payload"))));
}));

test("scratch close tolerates native proc-stat disappearance while retaining other read failures", () => fixture((root, source, invoke) => {
  const id = created(invoke);
  const disappearance = `
    import {spawn} from 'node:child_process';
    import assert from 'node:assert/strict';
    const child = spawn(process.execPath, ['-e', 'process.stdin.resume()'], {stdio:['pipe','ignore','ignore']});
    const joined = new Promise((resolve, reject) => {child.on('close', resolve); child.on('error', reject)});
    let descriptor;
    try {
      descriptor = fs.openSync('/proc/' + child.pid + '/stat', 'r');
      child.stdin.end();
      assert.equal(await joined, 0);
      assert.throws(() => fs.readFileSync(descriptor, 'utf8'), {code:'ESRCH', syscall:'read'});
      const read = fs.readFileSync;
      const entries = fs.readdirSync;
      fs.readdirSync = (location, ...args) => location === '/proc' ? [...entries(location, ...args), String(child.pid)] : entries(location, ...args);
      fs.readFileSync = (location, ...args) => location === '/proc/' + child.pid + '/stat' ? read(descriptor, ...args) : read(location, ...args);
      process.on('exit', () => fs.closeSync(descriptor));
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await joined;
      if (descriptor !== undefined) fs.closeSync(descriptor);
      throw error;
    }
  `;
  for (const code of ["EACCES", "EPERM", "EIO"]) {
    const result = injected(root, source, ["close", "--id", id, ...owner], `
      const read = fs.readFileSync;
      fs.readFileSync = (location, ...args) => {
        if (location === '/proc/' + process.pid + '/stat') throw Object.assign(new Error('${code} proc-stat refused'), {code:'${code}'});
        return read(location, ...args);
      };
    `);
    assert.equal(result.status, 1, String(result.stderr) + String(result.stdout));
    assert.match(String(result.stderr), new RegExp(`${code} proc-stat refused`));
    assert.equal(record(root, id).state, "ready");
    assert.equal(existsSync(path.join(record(root, id).root, "payload")), true);
  }
  const result = injected(root, source, ["close", "--id", id, ...owner], disappearance);
  assert.equal(result.status, 0, String(result.stderr) + String(result.stdout));
  assert.equal(record(root, id).state, "closed");
  assert.equal(existsSync(path.join(record(root, id).root, "payload")), false);
}));

test("scratch stale admission recovery requires exact inactive identity and owner", () => fixture((root, _source, invoke) => {
  const current = processIdentity(process.pid)!;
  assert.equal(identityIsLive(current), true);
  assert.ok(sessionMembers(current).some((member) => member.pid === current.pid));
  assert.throws(() => assertQuiescent(current), /group\/session remains active/);
  assert.throws(() => identityIsLive({ ...current, start: `${current.start}0` }), /identity changed/);
  assert.throws(() => identityIsLive({ ...current, boot: "foreign-boot" }), /identity changed/);
  assert.throws(() => identityIsLive({ ...current, group: current.group + 1 }), /escaped its reviewed group\/session/);
  assert.throws(() => identityIsLive({ ...current, session: current.session + 1 }), /escaped its reviewed group\/session/);
  const id = created(invoke);
  const entry = record(root, id);
  const lock = path.join(root, "state/verification/.admission");
  mkdirSync(lock, { mode: 0o700 });
  writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ owner: entry.owner, process: entry.supervisor }), { mode: 0o600 });
  assert.equal(invoke(["recover", "--id", id, "--owner", "foreign-token-12345678901234567890"]).status, 1);
  assert.equal(existsSync(lock), true);
  assert.equal(invoke(["recover", "--id", id, ...owner]).status, 0);
  assert.equal(existsSync(lock), false);
  assert.equal(record(root, id).state, "closed");
}));

test("scratch observed source pending/edit/redcommit/prod state is applied even from the payload cwd", () => fixture((root, source, invoke) => {
  const id = created(invoke);
  const previous = { stateDirectory: process.env["OSO_STATE_DIR"], taskRoot: process.env["OSO_TASK_ROOT"] };
  process.env["OSO_STATE_DIR"] = path.join(root, "state");
  process.env["OSO_TASK_ROOT"] = source;
  try {
    const file = stateFileFor(source);
    writeStatePairs(file, ["session=source-session"], "source-session");
    writeStatePairs(file, ["mode=plan"], "source-session");
    writeStatePairs(file, ["plan_approval=pending", "plan_approval_session=source-session"], "source-session");
    const entry = record(root, id);
    const run = spawnSync(process.execPath, [cli, "scratch", "run", "--id", id, ...owner, "--purpose", "check", "--timeout", "1", "--", process.execPath, "check.mjs"], {
      cwd: path.join(entry.root, "payload/work"), env: { HOME: root, USERPROFILE: root, PATH: process.env["PATH"], OSO_STATE_DIR: path.join(root, "state"), OSO_TASK_ROOT: source }, encoding: "utf8",
    });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /pending/);
    writeStatePairs(file, ["plan_approval=approved"], "source-session");
    writeStatePairs(file, ["active_slice=none"], "source-session");
    assert.match(String(invoke(["run", "--id", id, ...owner, "--purpose", "check", "--timeout", "1", "--", process.execPath, "check.mjs"]).stderr), /source gate edits/);
    writeStatePairs(file, ["active_slice=1"], "source-session");
    for (const argv of [["git", "commit", "-m", "blocked"], ["sh", "-c", "git commit -m blocked"], ["vercel", "--prod"], ["sh", "-c", "vercel --prod"]]) {
      const recipe = JSON.parse(readFileSync(path.join(source, "recipe.json"), "utf8"));
      recipe.commands = [{ purpose: "check", argv }];
      writeFileSync(path.join(source, "recipe.json"), JSON.stringify(recipe));
      writeStatePairs(file, ["auto=running"], "source-session");
      writeStatePairs(file, ["verify_green=false"], "source-session");
      const refused = invoke(create);
      assert.equal(refused.status, 1);
      assert.match(String(refused.stderr), argv.join(" ").includes("git") ? /source gate commit/ : /source gate proddeploy/);
    }
    assert.equal(invoke(["close", "--id", id, ...owner]).status, 0);
  } finally {
    restore("OSO_STATE_DIR", previous.stateDirectory);
    restore("OSO_TASK_ROOT", previous.taskRoot);
  }
}));

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("scratch actual isolated homes/cache/temp exclude inherited secrets and keep source unchanged", () => fixture((root, source, invoke) => {
  writeFileSync(path.join(source, "check.mjs"), `import {writeFileSync} from 'node:fs'; import path from 'node:path'; const names=['HOME','CODEX_HOME','XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_DATA_HOME','XDG_STATE_HOME','TMP','TEMP','TMPDIR']; for(const name of names) writeFileSync(path.join(process.env[name], name), 'owned'); process.stdout.write(JSON.stringify({env:process.env, cwd:process.cwd()}));`);
  const id = created(invoke);
  const entry = record(root, id);
  const result = invoke(["run", "--id", id, ...owner, "--purpose", "check", "--timeout", "5", "--", process.execPath, "check.mjs"]);
  assert.equal(result.status, 0, String(result.stderr));
  const actual = JSON.parse(String(result.stdout));
  for (const name of ["HOME", "CODEX_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "TMP", "TEMP", "TMPDIR"]) {
    assert.ok(actual.env[name].startsWith(`${entry.root}/payload/`));
    assert.equal(existsSync(path.join(actual.env[name], name)), true);
    assert.equal(existsSync(path.join(source, name)), false);
  }
  assert.equal(actual.env.OSO_STATE_DIR, undefined);
  assert.equal(actual.env.SSH_AUTH_SOCK, undefined);
  assert.equal(invoke(["close", "--id", id, ...owner]).status, 0);
}));

test("scratch crash recovery refuses a live child and succeeds only after its actual identity is inactive", () => fixture(async (root, source, invoke) => {
  writeFileSync(path.join(source, "check.mjs"), "setTimeout(() => process.exit(2), 90000);");
  const id = created(invoke);
  const supervisor = spawn(process.execPath, [cli, "scratch", "run", "--id", id, ...owner, "--purpose", "check", "--timeout", "60", "--", process.execPath, "check.mjs"], {
    cwd: source, env: { HOME: root, USERPROFILE: root, PATH: process.env["PATH"], OSO_STATE_DIR: path.join(root, "state"), OSO_TASK_ROOT: source }, stdio: "ignore",
  });
  const joined = new Promise<void>((resolve, reject) => { supervisor.on("close", () => resolve()); supervisor.on("error", reject); });
  let commandPid: number | undefined;
  try {
    for (let tries = 0; record(root, id).state !== "running" && tries < RUNNING_POLL_TRIES; tries += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    const entry = record(root, id);
    assert.equal(entry.state, "running");
    commandPid = entry.command.pid;
    const commandIdentity = processIdentity(commandPid!)!;
    assert.equal(invoke(["recover", "--id", id, ...owner]).status, 1);
    supervisor.kill("SIGKILL");
    await joined;
    assert.equal(identityIsLive(commandIdentity), true);
    assert.equal(invoke(["recover", "--id", id, ...owner]).status, 1);
    process.kill(commandPid!, "SIGKILL");
    await waitForQuiescence(commandIdentity, [commandIdentity]);
    assert.equal(identityIsLive(commandIdentity), false);
    assert.equal(invoke(["recover", "--id", id, ...owner]).status, 0);
    assert.equal(record(root, id).commands[0].outcome, "incomplete");
  } finally {
    if (supervisor.exitCode === null && supervisor.signalCode === null) supervisor.kill("SIGTERM");
    await joined;
    if (commandPid !== undefined && processIdentity(commandPid) !== undefined) {
      process.kill(commandPid, "SIGKILL");
      for (let tries = 0; processIdentity(commandPid) !== undefined && tries < 200; tries += 1) await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(processIdentity(commandPid), undefined);
    }
  }
}));

test("scratch real tracked session escape blocks run, close, and recovery with retained violation evidence: graceful", () => trackedSessionEscape("graceful"));
test("scratch real tracked session escape blocks run, close, and recovery with retained violation evidence: delayed/escalated", () => trackedSessionEscape("delayed/escalated"));

function trackedSessionEscape(termination: "graceful" | "delayed/escalated"): Promise<void> {
  return fixture(async (root, source, invoke) => {
    assert.equal(existsSync("/usr/bin/setsid"), true, "Linux supervision fixture requires existing /usr/bin/setsid");
    const id = created(invoke);
    const entry = record(root, id);
    const escapedFile = path.join(root, "escaped.json");
    const terminationFile = path.join(root, "termination.json");
    const leaderFile = path.join(root, "leader.mjs");
    const escapedScript = path.join(root, "escaped.mjs");
    const identityModule = pathToFileURL(fileURLToPath(new URL("../../src/state/scratch/process.ts", import.meta.url))).href;
    writeFileSync(escapedScript, `import {writeFileSync} from 'node:fs'; import {processIdentity} from ${JSON.stringify(identityModule)};
      writeFileSync(${JSON.stringify(escapedFile)}, JSON.stringify(processIdentity(process.pid)));
      const deadline=setTimeout(()=>process.exit(2),5000);
      process.stdin.resume(); process.stdin.on('end',()=>{clearTimeout(deadline);});`);
    writeFileSync(leaderFile, `import {spawn} from 'node:child_process'; import {readFileSync,writeFileSync} from 'node:fs';
      const child=spawn('/bin/sh',['-c','read release; exec /usr/bin/setsid "$1" "$2"','fixture',${JSON.stringify(process.execPath)},${JSON.stringify(escapedScript)}],{stdio:['pipe','ignore','inherit']});
      let released=false;
      const stop=()=>${termination === "graceful" ? "{child.stdin.end();process.exit(0);}" : "setTimeout(()=>child.stdin.end(),400)"};
      process.on('SIGTERM',stop);
      const deadline=setTimeout(stop,5000);
      const handshake=setInterval(()=>{
        const record=JSON.parse(readFileSync(${JSON.stringify(path.join(entry.root, "record.json"))},'utf8'));
        const tracked=record.tracked.find(identity=>identity.pid===child.pid);
        if(!released && tracked){
          writeFileSync(${JSON.stringify(path.join(root, "tracked.json"))},JSON.stringify(tracked));
          released=true; child.stdin.write('release\\n');
        }
      },10);
      child.on('error',error=>{throw error;});
      child.on('close',code=>{clearInterval(handshake);clearTimeout(deadline);process.exitCode=code;});`);
    const injection = `import cp from 'node:child_process'; import {syncBuiltinESMExports} from 'node:module';
      import {writeFileSync} from 'node:fs';
      const original=cp.spawn; cp.spawn=(_file,_args,options)=>{
        const leader=original(process.execPath,[${JSON.stringify(leaderFile)}],options);
        leader.on('close',(code,signal)=>writeFileSync(${JSON.stringify(terminationFile)},JSON.stringify({code,signal})));
        return leader;
      };
      syncBuiltinESMExports(); process.argv=[process.execPath,${JSON.stringify(cli)},'scratch',...${JSON.stringify(["run", "--id", id, ...owner, "--purpose", "check", "--timeout", "8", "--", process.execPath, "check.mjs"])}];
      await import(${JSON.stringify(pathToFileURL(cli).href)});`;
    const supervisor = spawn(process.execPath, ["--input-type=module", "-e", injection], {
      cwd: source, env: { HOME: root, USERPROFILE: root, PATH: process.env["PATH"], OSO_STATE_DIR: path.join(root, "state"), OSO_TASK_ROOT: source }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    supervisor.stderr.on("data", (chunk) => { stderr += chunk; });
    supervisor.stdout.resume();
    const joined = new Promise<number | null>((resolve, reject) => { supervisor.on("close", resolve); supervisor.on("error", reject); });
    try {
      assert.equal(await joined, 1, stderr);
      assert.match(stderr, /escaped|supervision|tracking/);
      const tracked = JSON.parse(readFileSync(path.join(root, "tracked.json"), "utf8"));
      const escaped = JSON.parse(readFileSync(escapedFile, "utf8"));
      assert.equal(escaped.pid, tracked.pid);
      assert.equal(escaped.start, tracked.start);
      assert.equal(escaped.boot, tracked.boot);
      assert.notEqual(escaped.group, tracked.group);
      assert.notEqual(escaped.session, tracked.session);
      assert.equal(escaped.group, escaped.pid);
      const blocked = record(root, id);
      assert.deepEqual(JSON.parse(readFileSync(terminationFile, "utf8")), termination === "graceful" ? { code: 0, signal: null } : { code: null, signal: "SIGKILL" });
      await waitForQuiescence(blocked.command, [blocked.command, escaped]);
      assertQuiescent(escaped);
      assert.equal(identityIsLive(escaped), false);
      assert.equal(identityIsLive(blocked.command), false);
      assert.equal(processIdentity(tracked.pid), undefined);
      assert.equal(blocked.state, "blocked");
      assert.equal(blocked.supervisionViolation, true);
      assert.ok(blocked.tracked.some((identity: { pid: number }) => identity.pid === tracked.pid));
      assert.match(blocked.commands[0].outcome, /blocked/);
      for (const action of ["close", "recover"]) {
        const result = invoke([action, "--id", id, ...owner]);
        assert.equal(result.status, 1, String(result.stderr));
        assert.match(String(result.stderr), /tracking violated; recovery refused/);
        assert.deepEqual(record(root, id), blocked);
        assert.equal(existsSync(path.join(entry.root, "payload/work/check.mjs")), true);
      }
      assert.equal(invoke(create).status, 1);
      assert.equal(processIdentity(blocked.command.pid), undefined);
    } finally {
      const command = record(root, id).command;
      if (command !== null && processIdentity(command.pid) !== undefined) process.kill(command.pid, "SIGTERM");
      await joined;
      for (const identity of record(root, id).tracked) {
        for (let tries = 0; processIdentity(identity.pid) !== undefined && tries < 600; tries += 1) await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(processIdentity(identity.pid), undefined);
      }
    }
  });
}

test("scratch refuses foreign owners and arbitrary cleanup paths without touching payload", () => fixture((root, source, invoke) => {
  const id = created(invoke);
  assert.equal(invoke(["close", "--id", id, "--owner", "foreign-token-12345678901234567890"]).status, 1);
  assert.equal(invoke(["recover", "--id", source, ...owner]).status, 1);
  assert.equal(existsSync(path.join(root, "state", "verification", id, "payload")), true);
  assert.equal(invoke(["close", "--id", id, ...owner]).status, 0);
}));

test("scratch admission counts declared headroom and refuses insufficient capacity without exporting", () => fixture((root, source, invoke) => {
  const recipePath = path.join(source, "recipe.json");
  const recipe = JSON.parse(readFileSync(recipePath, "utf8"));
  recipe.headroomBytes = Number.MAX_SAFE_INTEGER;
  writeFileSync(recipePath, JSON.stringify(recipe));
  const result = invoke(create);
  assert.equal(result.status, 1);
  assert.match(String(result.stderr), /capacity/);
  assert.equal(existsSync(path.join(root, "state", "verification", "payload")), false);
}));

test("scratch excludes sensitive source paths and refuses source links", () => fixture((_root, source, invoke) => {
  symlinkSync("check.mjs", path.join(source, "linked.mjs"));
  const recipePath = path.join(source, "recipe.json");
  const recipe = JSON.parse(readFileSync(recipePath, "utf8"));
  recipe.source.push("linked.mjs");
  writeFileSync(recipePath, JSON.stringify(recipe));
  assert.match(String(invoke(create).stderr), /link/);
  recipe.source = [".ssh/id_rsa"];
  writeFileSync(recipePath, JSON.stringify(recipe));
  assert.match(String(invoke(create).stderr), /sensitive/);
}));

test("scratch refuses unsupported runtime before materialization", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `Object.defineProperty(process, 'platform', {value:'win32'}); process.argv=[process.execPath, ${JSON.stringify(cli)}, 'scratch', 'create']; await import(${JSON.stringify(pathToFileURL(cli).href)});`], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Linux/);
});

test("scratch ordinary failure removes only owned payload and retains compact exit evidence", () => fixture((root, source, invoke) => {
  writeFileSync(path.join(source, "check.mjs"), "process.stderr.write('failure'); process.exitCode = 7;");
  const id = created(invoke);
  const result = invoke(["run", "--id", id, ...owner, "--purpose", "check", "--timeout", "5", "--", process.execPath, "check.mjs"]);
  assert.equal(result.status, 1);
  assert.equal(record(root, id).state, "closed");
  assert.equal(record(root, id).commands[0].exit, 7);
  assert.equal(readFileSync(path.join(root, "state", "verification", id, "raw.log"), "utf8"), "failure");
}));

test("scratch timeout terminates its foreground process, proves quiescence and removes payload", () => fixture((root, source, invoke) => {
  writeFileSync(path.join(source, "check.mjs"), "setInterval(() => {}, 1000);");
  const id = created(invoke);
  const result = invoke(["run", "--id", id, ...owner, "--purpose", "check", "--timeout", "0.1", "--", process.execPath, "check.mjs"]);
  assert.equal(result.status, 1, String(result.stderr));
  assert.equal(record(root, id).state, "closed");
  assert.equal(record(root, id).commands[0].outcome, "timeout");
}));

test("scratch combined stdout and stderr cap applies cumulatively across the attempt", () => fixture((root, source, invoke) => {
  writeFileSync(path.join(source, "check.mjs"), "process.stdout.write('o'.repeat(9 * 1024 * 1024)); process.stderr.write('e'.repeat(9 * 1024 * 1024));");
  const id = created(invoke);
  const result = spawnSync(process.execPath, [cli, "scratch", "run", "--id", id, ...owner, "--purpose", "check", "--timeout", "150", "--", process.execPath, "check.mjs"], {
    cwd: source, env: { HOME: root, USERPROFILE: root, PATH: process.env["PATH"], OSO_STATE_DIR: path.join(root, "state"), OSO_TASK_ROOT: source }, encoding: "utf8", maxBuffer: 20 * 1024 * 1024, timeout: SCRATCH_CLI_DEADLINE_MS,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(record(root, id).logBytes, 16 * 1024 * 1024);
  assert.match(record(root, id).verdict, /overflow/);
  assert.equal(record(root, id).state, "closed");
}));

test("scratch refuses aged live admission locks, source edits, unsafe wrappers and pending source state", () => fixture((root, source, invoke) => {
  const id = created(invoke);
  const registry = path.join(root, "state", "verification");
  const lock = path.join(registry, ".admission");
  mkdirSync(lock, { mode: 0o700 });
  writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ process: { pid: process.pid } }));
  const ancient = new Date(0);
  utimesSync(lock, ancient, ancient);
  assert.match(String(invoke(create).stderr), /lock/);
  assert.equal(existsSync(lock), true);
  rmSync(lock, { recursive: true });
  assert.equal(invoke(["run", "--id", id, ...owner, "--purpose", "check", "--timeout", "1", "--", "sh", "-c", "git commit -m unsafe"]).status, 1);
  writeFileSync(path.join(source, "check.mjs"), "process.exitCode=0;");
  assert.match(String(invoke(["run", "--id", id, ...owner, "--purpose", "check", "--timeout", "1", "--", process.execPath, "check.mjs"]).stderr), /fingerprint/);
  assert.equal(invoke(["close", "--id", id, ...owner]).status, 0);
}));

test("scratch cleanup refuses escaped payload links and blocks new allocation", () => fixture((root, source, invoke) => {
  const id = created(invoke);
  symlinkSync(source, path.join(root, "state", "verification", id, "payload", "escape"));
  const result = invoke(["close", "--id", id, ...owner]);
  assert.equal(result.status, 1);
  assert.match(String(result.stderr), /link/);
  assert.equal(record(root, id).state, "blocked");
  assert.equal(existsSync(path.join(source, "check.mjs")), true);
  assert.equal(invoke([...create.slice(0, -2), "--recipe", "recipe.json"]).status, 1);
}));

test("scratch handled cancellation joins its child before reporting cleanup", () => fixture(async (root, source, invoke) => {
  writeFileSync(path.join(source, "check.mjs"), "setInterval(() => {}, 1000);");
  const id = created(invoke);
  const supervisor = spawn(process.execPath, [cli, "scratch", "run", "--id", id, ...owner, "--purpose", "check", "--timeout", "5", "--", process.execPath, "check.mjs"], {
    cwd: source, env: { HOME: root, USERPROFILE: root, PATH: process.env["PATH"], OSO_STATE_DIR: path.join(root, "state"), OSO_TASK_ROOT: source }, stdio: "ignore",
  });
  const joined = new Promise<void>((resolve, reject) => { supervisor.on("close", () => resolve()); supervisor.on("error", reject); });
  try {
    for (let tries = 0; record(root, id).state !== "running" && tries < RUNNING_POLL_TRIES; tries += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(record(root, id).state, "running");
    supervisor.kill("SIGTERM");
    await joined;
    assert.equal(record(root, id).state, "closed");
    assert.equal(record(root, id).commands[0].outcome, "cancelled");
  } finally {
    if (supervisor.exitCode === null && supervisor.signalCode === null) supervisor.kill("SIGTERM");
    await joined;
  }
}));


test("scratch refuses inherited runtime injection before allocating", () => fixture((root, source) => {
  const result = spawnSync(process.execPath, [cli, "scratch", ...create], {
    cwd: source, env: { HOME: root, USERPROFILE: root, PATH: process.env["PATH"], OSO_STATE_DIR: path.join(root, "state"), OSO_TASK_ROOT: source, npm_config_script_shell: "/unreviewed/shell" }, encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /inherited/);
  assert.equal(existsSync(path.join(root, "state", "verification")), false);
}));

test("scratch close expires only this owner's old closed logs and retains evidence", () => fixture((root, _source, invoke) => {
  const id = created(invoke);
  assert.equal(invoke(["run", "--id", id, ...owner, "--purpose", "check", "--timeout", "5", "--", process.execPath, "check.mjs"]).status, 0);
  assert.equal(invoke(["close", "--id", id, ...owner]).status, 0);
  const entry = record(root, id);
  entry.closedAt = new Date(0).toISOString();
  writeFileSync(path.join(entry.root, "record.json"), JSON.stringify(entry));
  assert.equal(invoke(["close", "--id", id, ...owner]).status, 0);
  assert.equal(existsSync(path.join(entry.root, "raw.log")), false);
  assert.equal(record(root, id).commands[0].outcome, "pass");
}));

function npmFixtureDependencies(source: string): string[] {
  return ["esbuild", `@esbuild/linux-${process.arch}`, "typescript", `@typescript/typescript-linux-${process.arch}`, "smol-toml", "@types/node", "undici-types"].map((name) => {
    const root = `node_modules/${name}`;
    mkdirSync(path.join(source, root), { recursive: true });
    writeFileSync(path.join(source, root, "package.json"), "{}");
    return root;
  });
}

test("scratch declared npm route runs inventoried foreground package script with isolated npm cache", () => fixture((_root, source, invoke) => {
  mkdirSync(path.join(source, "core/scripts"), { recursive: true });
  const scripts = ["build-oso-state", "build-gates", "build-prose", "build-oso"];
  for (const script of scripts) writeFileSync(path.join(source, `core/scripts/${script}.mjs`), 'process.stdout.write(process.env.npm_config_cache + "\\n");');
  writeFileSync(path.join(source, "package.json"), JSON.stringify({ scripts: { build: scripts.map((script) => `node core/scripts/${script}.mjs`).join(" && ") } }));
  const recipe = JSON.parse(readFileSync(path.join(source, "recipe.json"), "utf8"));
  recipe.cacheRouting = "node-npm";
  recipe.source = ["package.json", "core"];
  recipe.dependencies = npmFixtureDependencies(source);
  recipe.tools = ["node", "npm", "sh", "esbuild"];
  recipe.commands = [{ purpose: "check", argv: ["npm", "run", "build"] }];
  writeFileSync(path.join(source, "recipe.json"), JSON.stringify(recipe));
  const id = created(invoke);
  const result = invoke(["run", "--id", id, ...owner, "--purpose", "check", "--timeout", "90", "--", "npm", "run", "build"]);
  assert.equal(result.status, 0, String(result.stderr) + String(result.stdout));
  assert.match(String(result.stdout), new RegExp(`${id}/payload/cache/npm`));
  assert.equal(invoke(["close", "--id", id, ...owner]).status, 0);
}));

test("scratch npm check and typecheck use reviewed scripts while lifecycle/test/install routes refuse", () => fixture((_root, source, invoke) => {
  mkdirSync(path.join(source, "core/scripts"), { recursive: true });
  const builders = ["build-oso-state", "build-gates", "build-prose", "build-oso"];
  for (const builder of builders) writeFileSync(path.join(source, `core/scripts/${builder}.mjs`), 'if(process.argv[2] !== "--check") process.exitCode=1;');
  mkdirSync(path.join(source, "node_modules/typescript/bin"), { recursive: true });
  writeFileSync(path.join(source, "node_modules/typescript/bin/tsc"), 'if(process.argv.slice(2).join(" ") !== "-p tsconfig.json") process.exitCode=1;');
  writeFileSync(path.join(source, "tsconfig.json"), "{}");
  const manifest = { scripts: { check: builders.map((builder) => `node core/scripts/${builder}.mjs --check`).join(" && "), typecheck: "tsc -p tsconfig.json" } };
  writeFileSync(path.join(source, "package.json"), JSON.stringify(manifest));
  const recipe = JSON.parse(readFileSync(path.join(source, "recipe.json"), "utf8"));
  recipe.cacheRouting = "node-npm";
  recipe.source = ["package.json", "core", "tsconfig.json"];
  recipe.dependencies = npmFixtureDependencies(source);
  for (const route of ["check", "typecheck"]) {
    recipe.tools = ["node", "npm", "sh", route === "check" ? "esbuild" : "typescript"];
    recipe.commands = [{ purpose: "check", argv: ["npm", "run", route] }];
    writeFileSync(path.join(source, "recipe.json"), JSON.stringify(recipe));
    const id = created(invoke);
    const result = invoke(["run", "--id", id, ...owner, "--purpose", "check", "--timeout", "90", "--", "npm", "run", route]);
    assert.equal(result.status, 0, String(result.stdout) + String(result.stderr));
    assert.equal(invoke(["close", "--id", id, ...owner]).status, 0);
  }
  for (const argv of [["npm", "test"], ["npm", "install"], ["npm", "run", "test"], ["npm", "run", "typecheck", "--", "--watch"]]) {
    recipe.commands = [{ purpose: "check", argv }];
    writeFileSync(path.join(source, "recipe.json"), JSON.stringify(recipe));
    assert.match(String(invoke(create).stderr), /no-export/);
  }
  recipe.commands = [{ purpose: "check", argv: ["npm", "run", "typecheck"] }];
  writeFileSync(path.join(source, "recipe.json"), JSON.stringify(recipe));
  writeFileSync(path.join(source, "package.json"), JSON.stringify({ scripts: { ...manifest.scripts, pretypecheck: "node unreviewed.mjs" } }));
  assert.match(String(invoke(create).stderr), /lifecycle/);
}));

test("scratch admission races produce exactly one owned materialization", () => fixture(async (root, source, invoke) => {
  const children = [0, 1].map(() => {
    const child = spawn(process.execPath, [cli, "scratch", ...create], { cwd: source, env: { HOME: root, USERPROFILE: root, PATH: process.env["PATH"], OSO_STATE_DIR: path.join(root, "state"), OSO_TASK_ROOT: source }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    return { child, joined: new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.on("error", reject);
    }) };
  });
  try {
    const results = await Promise.all(children.map((entry) => entry.joined));
    assert.deepEqual(results.map((entry) => entry.code).sort(), [0, 1]);
    const id = results.find((entry) => entry.code === 0)!.stdout.trim();
    assert.equal(readdirSync(path.join(root, "state/verification")).length, 1);
    assert.equal(invoke(["close", "--id", id, ...owner]).status, 0);
    assert.match(results.find((entry) => entry.code === 1)!.stderr, /lock|live materialization/);
  } finally {
    for (const { child } of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await Promise.all(children.map((entry) => entry.joined));
  }
}));

test("scratch rejects aliases, source hardlinks, unknown cache tools, and hidden process routes before copying", () => fixture((_root, source, invoke) => {
  const recipeFile = path.join(source, "recipe.json");
  const recipe = JSON.parse(readFileSync(recipeFile, "utf8"));
  writeFileSync(path.join(source, "CHECK.mjs"), "process.exitCode=0;");
  recipe.source.push("CHECK.mjs");
  writeFileSync(recipeFile, JSON.stringify(recipe));
  assert.match(String(invoke(create).stderr), /case alias/);
  recipe.source = ["check.mjs"];
  writeFileSync(recipeFile, JSON.stringify(recipe));
  linkSync(path.join(source, "check.mjs"), path.join(source, "hardlink.mjs"));
  assert.match(String(invoke(create).stderr), /hardlink/);
  rmSync(path.join(source, "hardlink.mjs"));
  recipe.tools = ["unreviewed-plugin"];
  writeFileSync(recipeFile, JSON.stringify(recipe));
  assert.match(String(invoke(create).stderr), /routing/);
  delete recipe.tools;
  writeFileSync(recipeFile, JSON.stringify(recipe));
  for (const script of ['import "./hidden-npm.mjs";', 'import {spawn} from "node:child_process"; spawn("node", [], {detached:true});', 'await import("node:child_process");']) {
    writeFileSync(path.join(source, "check.mjs"), script);
    assert.match(String(invoke(create).stderr), /not reviewed|nesting/);
  }
}));

test("scratch expiry never purges foreign or active logs", () => fixture((root, _source, invoke) => {
  const id = created(invoke);
  assert.equal(invoke(["run", "--id", id, ...owner, "--purpose", "check", "--timeout", "5", "--", process.execPath, "check.mjs"]).status, 0);
  const entry = record(root, id);
  const foreignCreate = [...create];
  foreignCreate[foreignCreate.indexOf("--owner") + 1] = "foreign-token-12345678901234567890";
  foreignCreate[foreignCreate.indexOf("--attempt") + 1] = "2";
  const foreignResult = invoke(foreignCreate);
  assert.equal(foreignResult.status, 0, String(foreignResult.stderr));
  const foreignId = String(foreignResult.stdout).trim();
  const foreignOwner = ["--owner", "foreign-token-12345678901234567890"];
  assert.equal(invoke(["run", "--id", foreignId, ...foreignOwner, "--purpose", "check", "--timeout", "5", "--", process.execPath, "check.mjs"]).status, 0);
  assert.equal(invoke(["close", "--id", foreignId, ...foreignOwner]).status, 0);
  const foreign = record(root, foreignId);
  foreign.closedAt = new Date(0).toISOString();
  writeFileSync(path.join(foreign.root, "record.json"), JSON.stringify(foreign));
  assert.equal(invoke(["close", "--id", id, ...owner]).status, 0);
  assert.equal(existsSync(path.join(foreign.root, "raw.log")), true);
  assert.equal(existsSync(path.join(entry.root, "raw.log")), true);
}));

test("scratch source-root separation refuses before creating registry directories", () => fixture((root, source) => {
  const before = readdirSync(source);
  const result = spawnSync(process.execPath, [cli, "scratch", ...create], { cwd: source, env: { HOME: root, USERPROFILE: root, PATH: process.env["PATH"], OSO_STATE_DIR: source, OSO_TASK_ROOT: source }, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /separation/);
  assert.deepEqual(readdirSync(source), before);
}));
