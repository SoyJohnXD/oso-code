import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { runGate } from "../../src/gates/dispatch.ts";
import { hostEnvelope, readEnvelope } from "../../src/hosts/envelope.ts";
import { lexShellCommands, MAX_LEXED_INPUT_BYTES } from "../../src/shell/lexer.ts";

const root = mkdtempSync(path.join(tmpdir(), "oso-codex-memory-"));
after(() => rmSync(root, { recursive: true, force: true }));
execFileSync("git", ["init", "-q", root]);
const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const transcript = path.join(root, "rollout.jsonl");

test("only the attested native root can save semantic memory, even without armed state", () => {
  const caller = { host: "codex" as const, agentSession: "1", stateBin: "" };
  const envelope = hostEnvelope(caller, { sessionId: id, cwd: root, transcriptPath: transcript, toolName: "mcp__engram__mem_save" });
  for (const payload of [
    { id, cwd: root, source: "cli", parent_thread_id: id, agent_path: "/root/child", agent_role: "explorer" },
    { id, cwd: root },
    { id, cwd: root, source: "cli", parent_thread_id: null },
    { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", cwd: root, source: "cli" },
  ]) {
    writeFileSync(transcript, `${JSON.stringify({ type: "session_meta", payload })}\n`);
    assert.equal(runGate(["unknown", "--allow", envelope.toolName], envelope).verdict.kind, "deny");
  }
  writeFileSync(transcript, `${JSON.stringify({ type: "session_meta", payload: { id, cwd: root, source: "cli" } })}\n`);
  assert.equal(runGate(["unknown", "--allow", envelope.toolName], envelope).verdict.kind, "allow");
});

test("child, missing and contradictory native callers cannot mutate through direct or wrapped CLI routes", () => {
  const caller = { host: "codex" as const, agentSession: "1", stateBin: "" };
  for (const payload of [
    { id, cwd: root, source: { subagent: { thread_spawn: { parent_thread_id: id, agent_path: "/root/explorer", agent_role: "explorer" } } } },
    { id, cwd: root, source: { subagent: { thread_spawn: { parent_thread_id: id } } }, parent_thread_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
    { id, cwd: root },
  ]) {
    writeFileSync(transcript, `${JSON.stringify({ type: "session_meta", payload })}\n`);
    for (const command of ["engram save title body", "env FLAG=1 engram save title body", "sh -c 'engram save title body'", "engram import records.json", "engram setup codex"]) {
      const envelope = readEnvelope(JSON.stringify({ session_id: id, cwd: root, transcript_path: transcript, tool_name: "exec_command", tool_input: { command } }), caller);
      assert.equal(runGate(["unknown", "--allow", "exec_command"], envelope).verdict.kind, "deny", command);
    }
    for (const tool of ["mem_context", "mem_search", "mem_get_observation", "mem_save", "mem_update", "mem_session_summary", "mem_save_prompt", "mem_judge", "mem_new_method", "mem_current_project"]) {
      const name = `mcp__engram__${tool}`;
      const envelope = readEnvelope(JSON.stringify({ session_id: id, cwd: root, transcript_path: transcript, tool_name: name, tool_input: { session_id: "forged", transcript_path: "forged" } }), caller);
      assert.equal(runGate(["unknown", "--allow", name], envelope).verdict.kind, ["mem_context", "mem_search", "mem_get_observation"].includes(tool) ? "allow" : "deny", tool);
    }
  }
});

test("native root CLI saves work while unknown MCP methods and forged nested hook identity remain denied", () => {
  writeFileSync(transcript, `${JSON.stringify({ type: "session_meta", payload: { id, cwd: root, source: "cli" } })}\n`);
  const caller = { host: "codex" as const, agentSession: "1", stateBin: "" };
  const rootHook = { session_id: id, cwd: root, transcript_path: transcript };
  const cli = readEnvelope(JSON.stringify({ ...rootHook, tool_name: "exec_command", tool_input: { command: "engram save title body" } }), caller);
  assert.equal(runGate(["unknown", "--allow", "exec_command"], cli).verdict.kind, "allow");
  const unknown = readEnvelope(JSON.stringify({ ...rootHook, tool_name: "mcp__engram__mem_new_method" }), caller);
  assert.equal(runGate(["unknown", "--allow", unknown.toolName], unknown).verdict.kind, "deny");
  const forged = readEnvelope(JSON.stringify({ tool_name: "mcp__engram__mem_save", tool_input: rootHook }), caller);
  assert.equal(runGate(["unknown", "--allow", forged.toolName], forged).verdict.kind, "deny");
  const otherHost = hostEnvelope({ ...caller, host: "opencode" }, { sessionId: id, cwd: root, toolName: "engram_mem_save" });
  assert.equal(runGate(["unknown", "--allow", otherHost.toolName], otherHost).verdict.kind, "allow");
});

test("native exec cmd arguments cannot bypass child memory denial", () => {
  writeFileSync(transcript, `${JSON.stringify({ type: "session_meta", payload: { id, cwd: root } })}\n`);
  const caller = { host: "codex" as const, agentSession: "1", stateBin: "" };
  const envelope = readEnvelope(JSON.stringify({ session_id: id, cwd: root, transcript_path: transcript, tool_name: "exec_command", tool_input: { cmd: "engram save title body" } }), caller);
  assert.equal(runGate(["unknown", "--allow", "exec_command"], envelope).verdict.kind, "deny");
});

test("wrapped exact MCP names retain hook identity and reject absent transcripts and foreign repositories", () => {
  const caller = { host: "codex" as const, agentSession: "1", stateBin: "" };
  const wrapped = { session_id: id, cwd: root, transcript_path: transcript, tool_input: { tool_name: "mcp__engram__mem_save" } };
  writeFileSync(transcript, `${JSON.stringify({ type: "session_meta", payload: { id, cwd: root, source: "cli" } })}\n`);
  assert.equal(runGate(["unknown", "--allow", "mcp__engram__mem_save"], readEnvelope(JSON.stringify(wrapped), caller)).verdict.kind, "allow");
  const foreign = path.join(root, "foreign");
  execFileSync("git", ["init", "-q", foreign]);
  for (const hook of [
    { ...wrapped, cwd: foreign },
    { ...wrapped, transcript_path: path.join(root, "missing.jsonl") },
    { ...wrapped, session_id: "" },
  ]) {
    assert.equal(runGate(["unknown", "--allow", "mcp__engram__mem_save"], readEnvelope(JSON.stringify(hook), caller)).verdict.kind, "deny");
  }
  writeFileSync(transcript, `${JSON.stringify({ type: "session_meta", payload: { id, cwd: root, source: { subagent: { thread_spawn: { parent_thread_id: id } } } } })}\n`);
  assert.equal(runGate(["unknown", "--allow", "mcp__engram__mem_save"], readEnvelope(JSON.stringify(wrapped), caller)).verdict.kind, "deny");
});

test("the native exec entrypoint is a root only with matching hook identity and no child lineage", () => {
  const caller = { host: "codex" as const, agentSession: "1", stateBin: "" };
  const envelope = hostEnvelope(caller, { sessionId: id, cwd: root, transcriptPath: transcript, toolName: "mcp__engram__mem_save" });
  writeFileSync(transcript, `${JSON.stringify({ type: "session_meta", payload: { id, cwd: root, source: "exec" } })}\n`);
  assert.equal(runGate(["unknown", "--allow", envelope.toolName], envelope).verdict.kind, "allow");
  for (const payload of [
    { id, cwd: root, source: "exec", parent_thread_id: id },
    { id, cwd: root, source: "exec", agent_path: "/root/child" },
    { id, cwd: root, source: "unknown" },
    { id, cwd: root, source: { internal: "memory_consolidation" } },
  ]) {
    writeFileSync(transcript, `${JSON.stringify({ type: "session_meta", payload })}\n`);
    assert.equal(runGate(["unknown", "--allow", envelope.toolName], envelope).verdict.kind, "deny");
  }
});

const LINEAGE_PAYLOADS = {
  child: { id, cwd: root, source: { subagent: { thread_spawn: { parent_thread_id: id } } } },
  missing: { id, cwd: root },
  contradictory: { id, cwd: root, source: "cli", parent_thread_id: id },
  root: { id, cwd: root, source: "cli" },
};

test("known verification commands keep data separate from executable shell", () => {
  for (const commandLine of [
    "env -u FORCE_COLOR pnpm e2e",
    "env --unset FORCE_COLOR pnpm e2e",
    "env --unset=FORCE_COLOR pnpm e2e",
    "command /usr/bin/env -u A --unset B --unset=C -- FLAG=1 pnpm e2e",
    "env -u A env -u B pnpm e2e",
    'while IFS= read -r file; do sha256sum "$file"; done <<< "$changed"',
    'sha256sum <<< "engram save title body"',
    'env -u A /usr/bin/sha256sum <<< "$changed"',
    'env -u A pnpm "$argument"',
    'sha256sum <<< "$(printf harmless)"',
    'sha256sum <<< "${changed:-$(printf harmless)}"',
  ]) {
    const envelope = hostEnvelope({ host: "codex", agentSession: "1", stateBin: "" }, { sessionId: id, cwd: root, toolName: "exec_command", commandLine });
    assert.equal(runGate(["unknown", "--allow", "exec_command"], envelope).verdict.kind, "allow", commandLine);
  }
});

test("unsupported env grammar and executable here-string consumers remain restricted", () => {
  for (const commandLine of [
    'env -u A "$exe" save title body',
    'env --unset A "${exe}" save title body',
    'env --unset=A "$exe" save title body',
    'env -u', 'env --unset', 'env --unset= pnpm e2e',
    'env --unknown pnpm e2e', 'env -u "$name" pnpm e2e',
    'env -u A engram save title body',
    'env -u A xargs engram save title body',
    'env -u A pnpm "$(engram save title body)"',
    'env -u A pnpm `engram save title body`',
    'sha256sum <<< "${changed:-$(engram save title body)}"',
    'sha256sum <<< "${changed:-`engram save title body`}"',
    'unknown <<< "$changed"', 'bash <<< "$changed"',
    'eval <<< "$changed"', 'source <<< "$changed"',
    'while IFS= read -r file; do "$file"; done <<< "$changed"',
    'while IFS= read -r file; do unknown "$file"; done <<< "$changed"',
    'while IFS= read -r file; do eval "$file"; done <<< "$changed"',
    'while IFS= read -r file; do sha256sum "$file"; unknown "$file"; done <<< "$changed"',
    'while IFS= read -r file; do sha256sum "$file"; done <<< "$(engram save title body)"',
    `sha256sum <<< "${"x".repeat(MAX_LEXED_INPUT_BYTES)}"`,
    'sha256sum <<< "$(echo $(echo $(echo $(echo safe))))"',
    'while IFS= read -r file; do bash -c "$file"; done <<< "$changed"',
    'while IFS= read -r file; do source "$file"; done <<< "$changed"',
    'for file in "$changed"; do sha256sum "$file"; done <<< "$changed"',
  ]) {
    const envelope = hostEnvelope({ host: "codex", agentSession: "1", stateBin: "" }, { sessionId: id, cwd: root, toolName: "exec_command", commandLine });
    assert.equal(runGate(["unknown", "--allow", "exec_command"], envelope).verdict.kind, "deny", commandLine);
  }
});

test("memory diagnostics distinguish observed mutation from unestablished shell effects", () => {
  for (const toolName of ["exec_command", "Bash", "view_image"]) {
    for (const [commandLine, message] of [
      ['unknown <<< "$changed"', /shell effects could not be established/],
      ['engram save title body; unknown <<< "$changed"', /semantic memory mutations/],
      ['unknown <<< "$changed"; engram save title body', /semantic memory mutations/],
    ] as const) {
      const envelope = hostEnvelope({ host: "codex", agentSession: "1", stateBin: "" }, { sessionId: id, cwd: root, toolName, commandLine });
      const { verdict } = runGate(["unknown", "--allow", toolName], envelope);
      assert.equal(verdict.kind, "deny");
      if (verdict.kind === "deny") assert.match(verdict.message, message);
    }
  }
});

test("native patch data is not executable shell or an Engram operation", () => {
  const patch = `*** Begin Patch\n*** Add File: fixture.ts\n+const example = 'engram save title body';\n+${"x".repeat(MAX_LEXED_INPUT_BYTES)}\n*** End Patch`;
  for (const lineage of ["child", "missing", "contradictory"] as const) {
    writeFileSync(transcript, `${JSON.stringify({ type: "session_meta", payload: LINEAGE_PAYLOADS[lineage] })}\n`);
    for (const tool of ["apply_patch", "exec_command", "mcp__engram__mem_save"]) {
      const envelope = readEnvelope(JSON.stringify({ session_id: id, cwd: root, transcript_path: transcript, tool_name: tool, tool_input: { command: patch } }), { host: "codex", agentSession: "1", stateBin: "" });
      assert.equal(runGate(["unknown", "--allow", tool], envelope).verdict.kind, tool === "apply_patch" ? "allow" : "deny", `${lineage}: ${tool}`);
    }
  }
});

for (const lineage of ["child", "missing", "contradictory"] as const) {
  test(`unread direct and wrapped command/cmd memory writes deny ${lineage} callers`, () => {
    writeFileSync(transcript, `${JSON.stringify({ type: "session_meta", payload: LINEAGE_PAYLOADS[lineage] })}\n`);
    const padding = "x".repeat(MAX_LEXED_INPUT_BYTES + 1);
    const commands = [
      `engram save title ${padding}`,
      `engram save title body # ${padding}`,
      `env FLAG=1 engram save title ${padding}`,
      `sh -c 'engram save title body # ${padding}'`,
    ];
    for (const field of ["command", "cmd"]) {
      for (const command of commands) {
        const envelope = readEnvelope(JSON.stringify({ session_id: id, cwd: root, transcript_path: transcript, tool_name: "exec_command", tool_input: { [field]: command } }), { host: "codex", agentSession: "1", stateBin: "" });
        assert.equal(runGate(["unknown", "--allow", "exec_command"], envelope).verdict.kind, "deny", `${lineage}: ${field}: ${command.slice(0, 50)}`);
      }
    }
  });
}

test("unread shell payloads keep attested ROOT and unrelated host behavior", () => {
  writeFileSync(transcript, `${JSON.stringify({ type: "session_meta", payload: { id, cwd: root, source: "exec" } })}\n`);
  for (const host of ["codex", "claude", "opencode"] as const) {
    const envelope = hostEnvelope({ host, agentSession: "1", stateBin: "" }, {
      sessionId: id, cwd: root, transcriptPath: host === "codex" ? transcript : "",
      toolName: "exec_command", commandLine: `engram save title ${"x".repeat(MAX_LEXED_INPUT_BYTES + 1)}`,
    });
    assert.equal(runGate(["unknown", "--allow", "exec_command"], envelope).verdict.kind, "allow", host);
  }
});

for (const lineage of ["child", "missing", "contradictory", "root"] as const) {
  test(`expanded executable command/cmd routes require attestation for ${lineage}`, () => {
    writeFileSync(transcript, `${JSON.stringify({ type: "session_meta", payload: LINEAGE_PAYLOADS[lineage] })}\n`);
    for (const field of ["command", "cmd"]) {
      for (const command of [
        'e=engram; $e save title body',
        'e=engram; "$e" save title body',
        'e=engram; "${e}" save title body',
        'e=gram; en${e} save title body',
        ...["=gram", ":=gram", "-gram", ":-gram", "+gram", ":+gram", "?gram", ":?gram", "%=", "//=", ":1"].flatMap((operator) => [
          `en\${x${operator}} save title body`,
          `en"\${x${operator}}" save title body`,
          `env FLAG=1 en\${x${operator}} save title body`,
          `sh -c 'en"\${x${operator}}" save title body'`,
        ]),
        'en$(printf gram)= save title body',
        'en`printf gram`= save title body',
        'en$((x=1)) save title body',
        'e=engram; env "$e" save title body',
        'e=engram; command "${e}" save title body',
        'sh -c \'e=engram; "$e" save title body\'',
        '$(printf engram) save title body',
        '`printf engram` save title body',
      ]) {
        const envelope = readEnvelope(JSON.stringify({ session_id: id, cwd: root, transcript_path: transcript, tool_name: "exec_command", tool_input: { [field]: command } }), { host: "codex", agentSession: "1", stateBin: "" });
        assert.equal(runGate(["unknown", "--allow", "exec_command"], envelope).verdict.kind, lineage === "root" ? "allow" : "deny", `${field}: ${command}`);
      }
    }
  });
}

test("literal executable dollars and argument expansions remain unrelated, with other hosts unchanged", () => {
  for (const host of ["codex", "claude", "opencode"] as const) {
    const commands = ["printf '%s' \"$e\"", "'$e' save title body", '\\$e save title body', 'e="$value"; printf ok', 'e=${x:=gram} printf ok', 'e+=${x:=gram} printf ok', '_e1=${x:=gram} printf ok', 'e="${x:=gram}" printf ok', 'e=$(printf gram) printf ok', 'e=`printf gram` printf ok', 'printf "%s" en${x:=gram}', "'en${x:=gram}' save title body", 'en\\${x:=gram} save title body'];
    if (host !== "codex") commands.push('e=engram; "$e" save title body');
    for (const commandLine of commands) {
      const envelope = hostEnvelope({ host, agentSession: "1", stateBin: "" }, { sessionId: id, cwd: root, toolName: "exec_command", commandLine });
      assert.equal(runGate(["unknown", "--allow", "exec_command"], envelope).verdict.kind, "allow", `${host}: ${commandLine}`);
    }
  }
});


test("expanded executable uncertainty is opt-in and does not change default lexer records", () => {
  const command = 'e=engram; "$e" save title body';
  assert.deepEqual(lexShellCommands(command), [
    { kind: "commandWord", word: "$e" },
    { kind: "argument", word: "save" },
    { kind: "argument", word: "title" },
    { kind: "argument", word: "body" },
  ]);
  assert.deepEqual(lexShellCommands(command, { unreadExpandedExecutables: true }), [...lexShellCommands(command), { kind: "unreadPayload" }]);
});

for (const executable of [
  'en"=${x}"', '"en="${x}', '"en"=${x}', "'en'=${x}",
  'en\\=${x}', '\\en=${x}', 'en""=${x}', 'en+"="${x}',
  'en\\+=${x}', "en$'='${x}", 'en"=${x}"\\\n',
]) {
  test(`quoted assignment-looking executable requires ROOT: ${JSON.stringify(executable)}`, () => {
    const commandLine = `${executable} save title body`;
    const envelope = hostEnvelope({ host: "codex", agentSession: "1", stateBin: "" }, { cwd: root, toolName: "exec_command", commandLine });
    assert.equal(runGate(["unknown", "--allow", "exec_command"], envelope).verdict.kind, "deny");
    assert.ok(lexShellCommands(commandLine, { unreadExpandedExecutables: true }).some((record) => record.kind === "unreadPayload"));
    assert.ok(!lexShellCommands(commandLine).some((record) => record.kind === "unreadPayload"));
  });
}

for (const assignment of [
  'en=${x}', 'en+=${x}', 'en="${x}"', "en='${x}'", 'en+=\\${x}',
  'en\\\n=${x}', 'e\\\nn+=${x}', 'en+\\\n="${x}"',
]) {
  test(`unquoted assignment prefix retains expanded or quoted RHS: ${JSON.stringify(assignment)}`, () => {
    const commandLine = `${assignment} printf ok`;
    const envelope = hostEnvelope({ host: "codex", agentSession: "1", stateBin: "" }, { cwd: root, toolName: "exec_command", commandLine });
    assert.equal(runGate(["unknown", "--allow", "exec_command"], envelope).verdict.kind, "allow");
    assert.ok(!lexShellCommands(commandLine, { unreadExpandedExecutables: true }).some((record) => record.kind === "unreadPayload"));
  });
}
