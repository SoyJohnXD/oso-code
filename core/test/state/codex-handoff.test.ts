import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readCodexSessionMetadata } from "../../src/hosts/codex-session-metadata.ts";

const cli = fileURLToPath(new URL("../../src/bin/oso-state.ts", import.meta.url));
const parent = "11111111-1111-4111-8111-111111111111";
const child = "22222222-2222-4222-8222-222222222222";
const coordinates = ["--slice", "s4", "--attempt", "1", "--agent-type", "oso-applier"];
const resolve = ["handoff", "resolve-codex", ...coordinates, "--agent-path", "/root/child"];

type Invoke = (argv: string[], options?: { environment?: NodeJS.ProcessEnv; cwd?: string; injection?: string }) => ReturnType<typeof spawnSync>;

function fixture(use: (root: string, invoke: Invoke) => void): void {
  const root = mkdtempSync(path.join(tmpdir(), "oso-codex-handoff-"));
  const repo = path.join(root, "repo");
  mkdirSync(repo);
  const env = { PATH: process.env["PATH"], HOME: root, USERPROFILE: root, CODEX_HOME: path.join(root, "codex"), OSO_STATE_DIR: path.join(root, "state"), CODEX_THREAD_ID: parent };
  const invoke: Invoke = (argv, options = {}) => {
    const script = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module'; ${options.injection ?? ""}; syncBuiltinESMExports(); process.argv=[process.execPath, ${JSON.stringify(cli)}, ...${JSON.stringify(argv)}]; await import(${JSON.stringify(pathToFileURL(cli).href)});`;
    const args = options.injection === undefined ? [cli, ...argv] : ["--input-type=module", "-e", script];
    return spawnSync(process.execPath, ["--experimental-strip-types", ...args], { cwd: options.cwd ?? repo, env: { ...env, ...options.environment }, encoding: "utf8", timeout: 15000 });
  };
  try {
    assert.equal(spawnSync("git", ["init", "--quiet", repo], { env }).status, 0);
    assert.equal(invoke(["handoff", "publish", ...coordinates, "--agent-id", child, "--hook-session", child]).status, 0);
    mkdirSync(path.join(root, "codex", "sessions"), { recursive: true });
    writeFileSync(path.join(root, "codex", "sessions", "rollout-child.jsonl"), JSON.stringify({ type: "session_meta", payload: {
      id: child, parent_thread_id: parent, agent_path: "/root/child", agent_role: "oso-applier", cwd: repo,
      source: { subagent: { thread_spawn: { parent_thread_id: parent, depth: 1, agent_path: "/root/child", agent_role: "oso-applier" } } },
    } }) + "\n");
    use(root, invoke);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("resolve-codex binds the current parent's canonical child to its receipt UUID without mutation", () => fixture((root, invoke) => {
  const directory = path.join(root, "state", ".handoffs", readdirSync(path.join(root, "state", ".handoffs"))[0]!);
  const snapshot = () => readdirSync(directory).map((name) => {
    const file = path.join(directory, name);
    const stat = lstatSync(file);
    return [name, readFileSync(file, "utf8"), stat.ino, stat.mtimeMs, stat.ctimeMs];
  });
  const before = snapshot();
  const directoryModified = lstatSync(directory).mtimeMs;
  const result = invoke(resolve);
  assert.equal(result.status, 0, String(result.stderr));
  assert.equal(result.stdout, child + "\n");
  assert.deepEqual(snapshot(), before);
  assert.equal(lstatSync(directory).mtimeMs, directoryModified);
}));

function rollout(root: string): string { return path.join(root, "codex", "sessions", "rollout-child.jsonl"); }

function artifacts(root: string): { directory: string; receipt: string; watermark: string } {
  const directory = path.join(root, "state", ".handoffs", readdirSync(path.join(root, "state", ".handoffs"))[0]!);
  const hash = createHash("sha256").update(child).digest("hex");
  return { directory, receipt: path.join(directory, `${hash}.receipt`), watermark: path.join(directory, `${hash}.watermark`) };
}

function refused(result: ReturnType<typeof spawnSync>, message?: RegExp): void {
  assert.equal(result.status, 1, String(result.stderr));
  assert.equal(result.stdout, "");
  if (message !== undefined) assert.match(String(result.stderr), message);
}

test("resolver refuses malformed CLI shape, canonical paths and missing or invalid parent identity", () => fixture((_root, invoke) => {
  for (const extra of [["--agent-id", child], ["--timeout", "0"], ["--hook-session", parent], ["--slice", "again"]]) refused(invoke([...resolve, ...extra]), /usage:/);
  for (const agentPath of ["child", "/root", "/root/../child", "/root//child", "/root/child/", "/root/child path"]) refused(invoke([...resolve.slice(0, -1), agentPath]), /canonical/);
  for (const id of ["", "not-a-uuid", "/root"]) refused(invoke(resolve, { environment: { CODEX_THREAD_ID: id } }), /CODEX_THREAD_ID/);
  refused(invoke(resolve.slice(0, -2)), /usage:/);
  refused(invoke(["handoff", "consume", ...coordinates, "--agent-id", child, "--agent-path", "/root/child"]), /usage:/);
}));

test("resolver ignores later transcript records and preserves root versus child first-record provenance", () => fixture((root, invoke) => {
  const file = rollout(root);
  const original = readFileSync(file, "utf8");
  writeFileSync(file, original + JSON.stringify({ type: "session_meta", payload: { id: "malicious", parent_thread_id: "foreign" } }) + "\n");
  assert.equal(invoke(resolve).status, 0);
  const metadata = readCodexSessionMetadata(file, performance.now() + 10000);
  assert.equal(metadata.threadSpawn?.["depth"], 1);
  assert.equal(metadata.parentThreadId, parent);
  writeFileSync(file, JSON.stringify({ type: "session_meta", payload: { id: parent, cwd: path.join(root, "repo"), source: "cli" } }) + "\n" + original);
  const rootMetadata = readCodexSessionMetadata(file, performance.now() + 10000);
  assert.equal(rootMetadata.source, "cli");
  assert.equal(rootMetadata.threadSpawn, undefined);
  assert.equal(rootMetadata.parentThreadId, undefined);
  refused(invoke(resolve), /found 0/);
}));

test("resolver rejects duplicate parent, path and role contradictions and malformed or missing first records", () => fixture((root, invoke) => {
  const file = rollout(root);
  const original = readFileSync(file, "utf8");
  for (const key of ["parent_thread_id", "agent_path", "agent_role"]) {
    const record = JSON.parse(original);
    record.payload.source.subagent.thread_spawn[key] = "different";
    writeFileSync(file, JSON.stringify(record) + "\n");
    refused(invoke(resolve), /contradictory/);
  }
  for (const text of ["", "{}\n", "{broken\n", original.trimEnd(), "{}\n" + original]) {
    writeFileSync(file, text);
    refused(invoke(resolve), /record/);
  }
}));

test("resolver refuses foreign parent, role, canonical path, UUID and repository without newest selection", () => fixture((root, invoke) => {
  const file = rollout(root);
  const original = readFileSync(file, "utf8");
  const foreign = path.join(root, "foreign");
  mkdirSync(foreign);
  assert.equal(spawnSync("git", ["init", "--quiet", foreign]).status, 0);
  for (const [key, value] of [["parent_thread_id", child], ["agent_role", "oso-verifier"], ["agent_path", "/root/other"], ["id", parent], ["cwd", foreign], ["cwd", root]] as const) {
    const record = JSON.parse(original);
    record.payload[key] = value;
    if (key in record.payload.source.subagent.thread_spawn) record.payload.source.subagent.thread_spawn[key] = value;
    writeFileSync(file, JSON.stringify(record) + "\n");
    refused(invoke(resolve));
  }
  writeFileSync(file, original);
  const duplicate = path.join(path.dirname(file), "rollout-duplicate.jsonl");
  writeFileSync(duplicate, original);
  refused(invoke(resolve), /ambiguous/);
  const second = "44444444-4444-4444-8444-444444444444";
  assert.equal(invoke(["handoff", "publish", ...coordinates, "--agent-id", second, "--hook-session", second]).status, 0);
  writeFileSync(duplicate, original.replaceAll(child, second));
  utimesSync(file, new Date(), new Date(Date.now() - 60000));
  refused(invoke(resolve), /found 2/);
}));

test("resolver never follows symlinked rollout or receipt inputs", () => fixture((root, invoke) => {
  for (const file of [artifacts(root).receipt, rollout(root)]) {
    const target = file + ".target";
    renameSync(file, target);
    symlinkSync(target, file);
    refused(invoke(resolve), /non-symlink/);
    rmSync(file);
    renameSync(target, file);
  }
  const sessions = path.dirname(rollout(root));
  const moved = sessions + "-moved";
  renameSync(sessions, moved);
  symlinkSync(moved, sessions, "junction");
  refused(invoke(resolve), /non-symlink directory/);
}));

test("resolver accepts worktrees sharing the actual common Git directory and refuses unknown current repository", () => fixture((root, invoke) => {
  const repo = path.join(root, "repo");
  assert.equal(spawnSync("git", ["-C", repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "fixture"]).status, 0);
  const worktree = path.join(root, "worktree");
  assert.equal(spawnSync("git", ["-C", repo, "worktree", "add", "--detach", worktree]).status, 0);
  const record = JSON.parse(readFileSync(rollout(root), "utf8"));
  record.payload.cwd = worktree;
  writeFileSync(rollout(root), JSON.stringify(record) + "\n");
  assert.equal(invoke(resolve, { cwd: worktree }).status, 0);
  assert.equal(invoke(resolve).status, 0);
  refused(invoke(resolve, { cwd: root }), /cannot resolve/);
}));

test("resolver preserves TTL, superseding, consumed watermarks and once-only public consumption", () => fixture((root, invoke) => {
  const { receipt, watermark } = artifacts(root);
  const original = readFileSync(receipt, "utf8");
  const before = lstatSync(receipt);
  const now = Date.now();
  const clock = { injection: `Date.now=()=>${now};` };
  utimesSync(receipt, before.atime, new Date(now - 86399999));
  assert.equal(invoke(resolve, clock).status, 0);
  utimesSync(receipt, before.atime, new Date(now - 86400000));
  refused(invoke(resolve, clock), /found 0/);
  assert.equal(readFileSync(receipt, "utf8"), original);
  utimesSync(receipt, before.atime, new Date());
  writeFileSync(watermark, "version=1\nattempt=2\n");
  refused(invoke(resolve), /found 0/);
  writeFileSync(watermark, "version=1\nattempt=1\n");
  assert.equal(invoke(["handoff", "wait", ...coordinates, "--agent-id", child, "--timeout", "0"]).status, 0);
  assert.equal(invoke(["handoff", "consume", ...coordinates, "--agent-id", child]).status, 0);
  refused(invoke(resolve), /found 0/);
  refused(invoke(["handoff", "consume", ...coordinates, "--agent-id", child]));
  refused(invoke(["handoff", "publish", ...coordinates, "--agent-id", child, "--hook-session", child]));
}));

test("resolver rejects hash-filename disagreement, malformed receipt/watermark and unrelated attempt", () => fixture((root, invoke) => {
  const { directory, receipt, watermark } = artifacts(root);
  const original = readFileSync(receipt, "utf8");
  const wrong = path.join(directory, `${"a".repeat(64)}.receipt`);
  renameSync(receipt, wrong);
  refused(invoke(resolve), /identity/);
  renameSync(wrong, receipt);
  writeFileSync(receipt, original + "extra=value\n");
  refused(invoke(resolve), /malformed receipt/);
  writeFileSync(receipt, original.replace("attempt=1", "attempt=2"));
  refused(invoke(resolve), /found 0/);
  writeFileSync(receipt, original);
  writeFileSync(watermark, "version=1\nattempt=invalid\n");
  refused(invoke(resolve), /malformed watermark/);
}));

test("resolver refuses nonregular receipts/rollouts, file replacement and closes every opened handle on failures", () => fixture((root, invoke) => {
  for (const file of [artifacts(root).receipt, rollout(root)]) {
    const text = readFileSync(file, "utf8");
    rmSync(file);
    mkdirSync(file);
    refused(invoke(resolve));
    rmSync(file, { recursive: true });
    writeFileSync(file, text);
  }
  const receipt = artifacts(root).receipt;
  const replace = `const file=${JSON.stringify(receipt)}; const text=fs.readFileSync(file,'utf8'); fs.renameSync(file,file+'.old'); fs.writeFileSync(file,text);`;
  const replacedDuringRead = `const read=fs.readSync; let changed=false; fs.readSync=(...args)=>{const count=read(...args); if(!changed&&fs.fstatSync(args[0]).ino===fs.lstatSync(${JSON.stringify(receipt)}).ino){changed=true; ${replace}} return count;};`;
  refused(invoke(resolve, { injection: replacedDuringRead }), /identity changed/);
  rmSync(receipt);
  renameSync(receipt + ".old", receipt);
  const replacedBeforeOpen = `const open=fs.openSync; let changed=false; fs.openSync=(...args)=>{if(!changed&&args[0]===${JSON.stringify(receipt)}){changed=true; ${replace}} return open(...args);};`;
  refused(invoke(resolve, { injection: replacedBeforeOpen }), /identity changed/);
  rmSync(receipt);
  renameSync(receipt + ".old", receipt);
  writeFileSync(rollout(root), "{}\n");
  const guard = `let files=0,dirs=0; const open=fs.openSync,close=fs.closeSync,opendir=fs.opendirSync; fs.openSync=(...args)=>{const fd=open(...args);files++;return fd;}; fs.closeSync=(fd)=>{files--;return close(fd);}; fs.opendirSync=(...args)=>{const dir=opendir(...args);dirs++;const close=dir.closeSync.bind(dir);dir.closeSync=()=>{dirs--;return close();};return dir;}; process.on('exit',()=>{if(files!==0||dirs!==0)process.exitCode=99;});`;
  refused(invoke(resolve, { injection: guard }));
}));

test("resolver enforces exactly 128 matching receipt candidates without unbounded candidate collection", () => fixture((root, invoke) => {
  const { directory, receipt, watermark } = artifacts(root);
  const text = readFileSync(receipt, "utf8");
  const mark = readFileSync(watermark, "utf8");
  for (let index = 1; index <= 128; index++) {
    const id = `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`;
    const hash = createHash("sha256").update(id).digest("hex");
    writeFileSync(path.join(directory, `${hash}.receipt`), text.replaceAll(child, id));
    writeFileSync(path.join(directory, `${hash}.watermark`), mark);
    if (index === 127) assert.equal(invoke(resolve).status, 0);
  }
  refused(invoke(resolve), /more than 128/);
}));

test("resolver bounds all enumerated paths, even irrelevant entries, at 10000", () => fixture((root, invoke) => {
  const sessions = path.dirname(rollout(root));
  for (let index = 0; index < 9999; index++) writeFileSync(path.join(sessions, `ignored-${index}`), "not a transcript");
  assert.equal(invoke(resolve).status, 0);
  writeFileSync(path.join(sessions, "one-over"), "");
  refused(invoke(resolve), /more than 10000/);
}));

test("resolver refuses a directory-open swap that hides a second valid UUID", () => fixture((root, invoke) => {
  const sessions = path.dirname(rollout(root));
  const original = readFileSync(rollout(root), "utf8");
  const second = "55555555-5555-4555-8555-555555555555";
  assert.equal(invoke(["handoff", "publish", ...coordinates, "--agent-id", second, "--hook-session", second]).status, 0);
  writeFileSync(path.join(sessions, "rollout-second.jsonl"), original.replaceAll(child, second));
  refused(invoke(resolve), /found 2/);
  for (const [index, visible] of [rollout(root), artifacts(root).receipt].entries()) {
    const target = path.dirname(visible);
    const decoy = path.join(root, `decoy-${index}`);
    mkdirSync(decoy);
    writeFileSync(path.join(decoy, path.basename(visible)), readFileSync(visible));
    const injection = `const open=fs.opendirSync; let attempted=false,swapped=false,kernelRefused=false,handles=0; fs.opendirSync=(file,...options)=>{
      let directory;
      if((file===${JSON.stringify(target)}||(file==='.'&&process.cwd()===${JSON.stringify(target)}))&&!attempted){
        attempted=true;
        const target=${JSON.stringify(target)};
        try { fs.renameSync(target,target+'.original'); }
        catch(error){kernelRefused=file==='.'&&['EPERM','EACCES','EBUSY'].includes(error.code);throw error;}
        fs.renameSync(${JSON.stringify(decoy)},target);
        try { directory=open(file,...options); }
        finally { fs.renameSync(target,${JSON.stringify(decoy)}); fs.renameSync(target+'.original',target); }
        swapped=true;
      } else directory=open(file,...options);
      handles++; const close=directory.closeSync.bind(directory); directory.closeSync=()=>{handles--;return close();}; return directory;
    }; process.on('exit',()=>{if(!attempted||(!swapped&&!kernelRefused)||handles!==0)process.exitCode=99;process.stderr.write('fixture-directory-swap='+(swapped?'completed':kernelRefused?'kernel-refused':'not-exercised')+'\\n');});`;
    const result = invoke(resolve, { injection });
    refused(result);
    assert.match(String(result.stderr), /fixture-directory-swap=(completed|kernel-refused)/);
  }
  refused(invoke(resolve), /found 2/);
}));

test("resolver restores cwd before file reads and on directory open/read/change failures", () => fixture((root, invoke) => {
  const guard = `const caller=process.cwd(); let handles=0; const read=fs.readSync,open=fs.opendirSync;
    fs.readSync=(...args)=>{if(process.cwd()!==caller)throw new Error('file read before cwd restoration');return read(...args);};
    fs.opendirSync=(...args)=>{const directory=open(...args);handles++;const close=directory.closeSync.bind(directory);directory.closeSync=()=>{handles--;return close();};return directory;};
    process.on('exit',()=>{if(process.cwd()!==caller||handles!==0)process.exitCode=99;});`;
  assert.equal(invoke(resolve, { injection: guard }).status, 0);
  for (const failure of [
    `fs.opendirSync=()=>{throw new Error('injected directory open failure');};`,
    `const guardedOpen=fs.opendirSync;fs.opendirSync=(...args)=>{const directory=guardedOpen(...args);directory.readSync=()=>{throw new Error('injected directory read failure');};return directory;};`,
    `const change=process.chdir;process.chdir=(directory)=>{if(directory!==caller)throw new Error('injected directory change failure');return change(directory);};`,
  ]) refused(invoke(resolve, { injection: guard + failure }), /injected directory/);
  writeFileSync(rollout(root), "{}\n");
  refused(invoke(resolve, { injection: guard }), /first session_meta/);
}));

test("resolver reads at most one MiB of first record and bounds readiness at ten seconds", () => fixture((root, invoke) => {
  const file = rollout(root);
  const original = readFileSync(file, "utf8").trimEnd();
  const limit = 1024 * 1024;
  writeFileSync(file, original + " ".repeat(limit - Buffer.byteLength(original) - 1) + "\n" + "body".repeat(limit));
  assert.equal(invoke(resolve).status, 0);
  writeFileSync(file, original + " ".repeat(limit - Buffer.byteLength(original)) + "\n");
  refused(invoke(resolve), /exceeds 1048576/);
  const clock = `let ticks=0; Object.defineProperty(performance,'now',{value:()=>ticks++===0?0:10000});`;
  refused(invoke(resolve, { injection: clock }), /10 seconds/);
}));

test("resolver treats a guardian rollout's unrecognized subagent shape as no nested provenance and still matches the real child", () => fixture((root, invoke) => {
  const sessions = path.dirname(rollout(root));
  writeFileSync(path.join(sessions, "rollout-guardian.jsonl"), JSON.stringify({ type: "session_meta", payload: {
    id: "66666666-6666-4666-8666-666666666666", cwd: path.join(root, "repo"), source: { subagent: { other: "guardian" } },
  } }) + "\n");
  const result = invoke(resolve);
  assert.equal(result.status, 0, String(result.stderr));
  assert.equal(result.stdout, child + "\n");
}));

test("readCodexSessionMetadata still throws when subagent is not a record at all", () => fixture((root, _invoke) => {
  const file = rollout(root);
  for (const malformed of ["not-a-record", null]) {
    const record = JSON.parse(readFileSync(file, "utf8"));
    record.payload.source.subagent = malformed;
    writeFileSync(file, JSON.stringify(record) + "\n");
    assert.throws(
      () => readCodexSessionMetadata(file, performance.now() + 10000),
      /unrecognized native subagent provenance/,
    );
  }
}));

test("readCodexSessionMetadata still throws when subagent.thread_spawn is present but malformed", () => fixture((root, _invoke) => {
  const file = rollout(root);
  const record = JSON.parse(readFileSync(file, "utf8"));
  record.payload.source.subagent.thread_spawn = "not-an-object";
  writeFileSync(file, JSON.stringify(record) + "\n");
  assert.throws(
    () => readCodexSessionMetadata(file, performance.now() + 10000),
    /unrecognized native subagent provenance/,
  );
}));

test("resolver skips an unreadable rollout beside a good one without preventing the match", () => fixture((root, invoke) => {
  const sessions = path.dirname(rollout(root));
  const broken = path.join(sessions, "rollout-broken.jsonl");
  for (const text of ["{not valid json\n", '{"type":"session_meta","payload":{"id":"77777777-7777-4777-8777-777777777777"}}']) {
    writeFileSync(broken, text);
    const result = invoke(resolve);
    assert.equal(result.status, 0, String(result.stderr));
    assert.equal(result.stdout, child + "\n");
  }
}));
