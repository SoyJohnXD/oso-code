import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runGate } from "../../src/gates/dispatch.ts";
import { spawnedEnvelope } from "../../src/hosts/spawned.ts";
import { unresolvedHomeCause, withHookEnvironment } from "../support/gate-fixture.ts";
import { provedSomething } from "../support/proved.ts";
import { STATE_FILE, STATE_ROOT_THESE_TESTS_SPELL, withStateSandbox } from "../support/state-sandbox.ts";

const ARMED_RED_STATE = {
  [STATE_FILE]: "mode=plan\nverify_green=false\nsession=test-session\n",
};
const ARMED_RUN_STATE = {
  [STATE_FILE]: "auto=running\nauto_change=auto-continuity\nsession=test-session\n",
};

const CODEX_TOOL_ENVELOPE =
  '{"session_id":"test-session","cwd":"{cwd}","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{}}';

const MISCONFIGURED_ALLOWLISTS: readonly (readonly [string, readonly string[], string])[] = [
  ["no argument at all", [], "missing allowlist"],
  ["--allow with no list behind it", ["--allow"], "missing allowlist"],
  ["a flag that is not --allow", ["--deny", "Bash"], "missing allowlist"],
  ["a third argument", ["--allow", "Bash", "extra"], "missing allowlist"],
  ["an empty list", ["--allow", ""], "empty allowlist"],
  ["a name carrying a space", ["--allow", "Bash|has space"], "invalid allowlist"],
  ["an empty name between two separators", ["--allow", "Bash||apply_patch"], "invalid allowlist"],
];

const HOME_A_GATE_CANNOT_RESOLVE = "";

const A_PATTERN_GREP_EXITS_TWO_ON = "[abc-prod";
const A_PCRE_SPELLING_GREP_READS_AS_ERE = "(?:deploy|ship)-prod";
const A_RANGE_OPENED_BY_THE_BRACKET_ITSELF = "[]-~]uild";

const WRAPPERS_CARRYING_A_QUOTED_DEPLOY: readonly string[] = [
  "script -qc 'vercel --prod' /dev/null",
  "ssh build-host 'vercel --prod'",
  "tmux new-session -d 'vercel --prod'",
];

const WRAPPERS_WHOSE_OPTION_HIDES_THE_PAYLOAD: readonly string[] = [
  "ssh -p 22 build-host 'vercel --prod'",
  "tmux -L sock new-session -d 'vercel --prod'",
  "tmux new-session -s pane vercel --prod",
];

const WRAPPERS_CARRYING_NO_DEPLOY: readonly string[] = [
  "ssh build-host 'npm run build'",
  "ssh build-host npm run build",
  "ssh build-host",
  "tmux new-session 'npm test'",
  "tmux ls",
  "script -c 'npm test' /dev/null",
];

const DOLLAR_QUOTED_PRODUCTION_DEPLOYS: readonly string[] = [
  "vercel $'--prod'",
  'vercel $"--prod"',
  'vercel $"--pro"$"d"',
  'vercel $\'--pro\'$"d"',
  'vercel $"--target" $"production"',
  'script -qc \'vercel $"--prod"\' /dev/null',
  'ssh build-host \'vercel $"--prod"\'',
  'tmux new-session -d \'vercel $"--prod"\'',
];

const DOLLAR_QUOTED_COMMITS: readonly string[] = [
  "git $'commit' -m x",
  'git $"commit" -m x',
  'git $"com"$\'mit\' -m x',
  'ssh build-host \'git $"commit" -m x\'',
];

const DOLLAR_QUOTED_PUSHES_OFF_THE_RUN_BRANCH: readonly string[] = [
  "git $'push' origin main",
];

const DOLLAR_SPELLINGS_THE_BOUNDARY_STILL_ALLOWS: readonly string[] = [
  'vercel "$"--prod""',
  'vercel \\$"--prod"',
  "vercel \\$'--prod'",
];

const DOLLAR_SPELLINGS_THE_COMMIT_RAIL_STILL_ALLOWS: readonly string[] = [
  "git $'status'",
];

const LOCALE_SPELLINGS_THE_BOUNDARY_DENIES_UNREAD: readonly string[] = [
  'vercel $"deploy"',
  'vercel $"--target" $"preview"',
  'git $"push" origin main',
  'git $"push" origin $"main"',
];

const LOCALE_SPELLINGS_THE_COMMIT_RAIL_COUNTS_AS_RESIDUE: readonly string[] = [
  'git $"status"',
  'git $"log" --oneline',
];

const CARRIERS_OF_A_COMMAND_THE_SHELL_RUNS_LATER: readonly string[] = [
  "trap 'vercel --prod' EXIT",
  "coproc vercel --prod",
  "coproc NAME { vercel --prod ; }",
  "mapfile -C 'vercel --prod' -c 1 rows",
  "compgen -C 'vercel --prod' foo",
];

const CARRIERS_WHOSE_PAYLOAD_IS_PAST_READING: readonly string[] = [
  "alias deploy='vercel --prod'",
  "fc -s",
  "BASH_ENV=./boot.sh bash -c :",
];

const CARRIERS_HOLDING_NO_COMMAND_AT_ALL: readonly string[] = [
  "trap - EXIT",
  "trap -l",
  "coproc npm test",
  "mapfile -t rows",
  "alias",
];

provedSomething(
  `at least one of ${MISCONFIGURED_ALLOWLISTS.length} misconfigured allowlists is exercised`,
  MISCONFIGURED_ALLOWLISTS.length > 0,
  "the gate entry-point suite carries no case, so it proved nothing about how a gate fails closed",
);

describe("core/src/gates/dispatch.ts: port tests read from the gate scripts, never parity evidence", () => {
  test("an unknown gate name blocks the call instead of opening the gate (read from plugin/hooks/lib.sh:383-386)", () => {
    const run = judge(["frobnicate"], ARMED_RED_STATE, bashEnvelope("git commit -m x"));
    assert.equal(run.exit, 2);
    assert.equal(run.stdout, "");
    assert.match(run.stderr, /the gate entry point \(unknown gate 'frobnicate'\)/);
    assert.deepEqual(run.events, []);
  });

  for (const [reads, argv, cause] of MISCONFIGURED_ALLOWLISTS) {
    test(`${reads} blocks the unknown-tool gate on one line (read from plugin/hooks/block-unknown-tool.sh:7-18)`, () => {
      const run = judge(["unknown", ...argv], ARMED_RED_STATE, CODEX_TOOL_ENVELOPE);
      assert.equal(run.exit, 2);
      assert.equal(run.stdout, "");
      assert.equal(run.stderr, gateErrorLineTheBashPrints(`the unknown-tool gate configuration (${cause})`));
      assert.deepEqual(run.events, []);
    });
  }

  test("a gate that throws blocks on two lines, the fixed one and the cause (read from plugin/hooks/lib.sh:383-386)", () => {
    const run = withStateSandbox("workspace", (sandbox) => {
      sandbox.seed(ARMED_RED_STATE);
      const envelope = sandbox.expandJson(bashEnvelope("git commit -m x"));
      return withHookEnvironment({ HOME: HOME_A_GATE_CANNOT_RESOLVE }, () => runGate(["commit"], spawnedEnvelope(envelope, process.env)));
    });
    assert.equal(run.exit, 2);
    assert.equal(run.stdout, "");
    assert.equal(run.stderr, `${gateErrorLineTheBashPrints("the commit gate")}oso-code: cause: ${unresolvedHomeCause()}\n`);
    assert.deepEqual(run.events, []);
  });
});

describe("core/src/gates/proddeploy.ts: a command-string-carrying wrapper's payload reaches the deploy CLI", () => {
  for (const command of WRAPPERS_CARRYING_A_QUOTED_DEPLOY) {
    test(`${command} is denied at the production boundary rather than passed uncounted`, () => {
      const run = judge(["proddeploy"], ARMED_RUN_STATE, bashEnvelope(command));
      assert.equal(run.exit, 0);
      assert.match(run.stdout, /"permissionDecision":"deny"/);
      assert.match(run.stdout, /a production deploy stays with the operator/);
    });
  }

  test("the same payload unquoted is denied too, because the operand after the host is the command ssh runs", () => {
    const run = judge(["proddeploy"], ARMED_RUN_STATE, bashEnvelope("ssh build-host vercel --prod"));
    assert.match(run.stdout, /"permissionDecision":"deny"/);
  });

  for (const command of WRAPPERS_WHOSE_OPTION_HIDES_THE_PAYLOAD) {
    test(`${command} is denied unread, the rule sudo -u somebody git commit already carried`, () => {
      const run = judge(["proddeploy"], ARMED_RUN_STATE, bashEnvelope(command));
      assert.match(run.stdout, /"permissionDecision":"deny"/);
      assert.match(run.stdout, /past what the production boundary can read/);
    });
  }

  for (const command of WRAPPERS_CARRYING_NO_DEPLOY) {
    test(`${command} still passes the production boundary allowed and uncounted`, () => {
      const run = judge(["proddeploy"], ARMED_RUN_STATE, bashEnvelope(command));
      assert.deepEqual({ exit: run.exit, stdout: run.stdout, stderr: run.stderr }, { exit: 0, stdout: "", stderr: "" });
      assert.deepEqual(run.events, []);
    });
  }
});

describe("core/src/gates: a dollar-quoted word reaches the rail the word the shell builds reaches", () => {
  for (const command of DOLLAR_QUOTED_PRODUCTION_DEPLOYS) {
    test(`${command} is denied at the production boundary`, () => {
      const run = judge(["proddeploy"], ARMED_RUN_STATE, bashEnvelope(command));
      assert.match(run.stdout, /"permissionDecision":"deny"/);
      assert.match(run.stdout, /a production deploy stays with the operator/);
      assert.deepEqual(run.events.map((logged) => logged.event), ["prod-deploy-denied"]);
    });
  }

  for (const command of DOLLAR_QUOTED_COMMITS) {
    test(`${command} is denied until the session verify is green`, () => {
      const run = judge(["commit"], ARMED_RED_STATE, bashEnvelope(command));
      assert.match(run.stdout, /"permissionDecision":"deny"/);
      assert.match(run.stdout, /the session verify is not green/);
      assert.deepEqual(run.events.map((logged) => logged.event), ["commit-denied"]);
    });
  }

  for (const command of DOLLAR_QUOTED_PUSHES_OFF_THE_RUN_BRANCH) {
    test(`${command} is denied as a push off the run branch`, () => {
      const run = judge(["proddeploy"], ARMED_RUN_STATE, bashEnvelope(command));
      assert.match(run.stdout, /"permissionDecision":"deny"/);
      assert.match(run.stdout, /pushes its own oso-run\/\* branch and nothing else/);
      assert.deepEqual(run.events.map((logged) => logged.event), ["run-branch-push-denied"]);
    });
  }

  for (const command of DOLLAR_SPELLINGS_THE_BOUNDARY_STILL_ALLOWS) {
    test(`${command} still passes the production boundary allowed and uncounted`, () => {
      const run = judge(["proddeploy"], ARMED_RUN_STATE, bashEnvelope(command));
      assert.deepEqual({ exit: run.exit, stdout: run.stdout, stderr: run.stderr }, { exit: 0, stdout: "", stderr: "" });
      assert.deepEqual(run.events, []);
    });
  }

  for (const command of DOLLAR_SPELLINGS_THE_COMMIT_RAIL_STILL_ALLOWS) {
    test(`${command} still passes the commit rail allowed and uncounted`, () => {
      const run = judge(["commit"], ARMED_RED_STATE, bashEnvelope(command));
      assert.deepEqual({ exit: run.exit, stdout: run.stdout, stderr: run.stderr }, { exit: 0, stdout: "", stderr: "" });
      assert.deepEqual(run.events, []);
    });
  }
});

describe("core/src/gates: a locale-translated span is past reading, because a catalog picks the word", () => {
  for (const command of LOCALE_SPELLINGS_THE_BOUNDARY_DENIES_UNREAD) {
    test(`${command} is denied unread at the production boundary`, () => {
      const run = judge(["proddeploy"], ARMED_RUN_STATE, bashEnvelope(command));
      assert.match(run.stdout, /"permissionDecision":"deny"/);
      assert.match(run.stdout, /past what the production boundary can read/);
      assert.deepEqual(run.events.map((logged) => logged.event), ["prod-deploy-denied"]);
    });
  }

  for (const command of LOCALE_SPELLINGS_THE_COMMIT_RAIL_COUNTS_AS_RESIDUE) {
    test(`${command} passes the commit rail counted as residue rather than uncounted`, () => {
      const run = judge(["commit"], ARMED_RED_STATE, bashEnvelope(command));
      assert.deepEqual({ exit: run.exit, stdout: run.stdout, stderr: run.stderr }, { exit: 0, stdout: "", stderr: "" });
      assert.deepEqual(run.events.map((logged) => logged.event), ["residue-allowed"]);
    });
  }
});

describe("core/src/gates/proddeploy.ts: a word carrying a command the shell runs later reaches the rail", () => {
  for (const command of CARRIERS_OF_A_COMMAND_THE_SHELL_RUNS_LATER) {
    test(`${command} is denied at the production boundary`, () => {
      const run = judge(["proddeploy"], ARMED_RUN_STATE, bashEnvelope(command));
      assert.match(run.stdout, /"permissionDecision":"deny"/);
      assert.match(run.stdout, /a production deploy stays with the operator/);
      assert.deepEqual(run.events.map((logged) => logged.event), ["prod-deploy-denied"]);
    });
  }

  for (const command of CARRIERS_WHOSE_PAYLOAD_IS_PAST_READING) {
    test(`${command} is denied unread, because its command is nowhere on this line`, () => {
      const run = judge(["proddeploy"], ARMED_RUN_STATE, bashEnvelope(command));
      assert.match(run.stdout, /"permissionDecision":"deny"/);
      assert.match(run.stdout, /past what the production boundary can read/);
    });
  }

  for (const command of CARRIERS_HOLDING_NO_COMMAND_AT_ALL) {
    test(`${command} still passes the production boundary allowed and uncounted`, () => {
      const run = judge(["proddeploy"], ARMED_RUN_STATE, bashEnvelope(command));
      assert.deepEqual({ exit: run.exit, stdout: run.stdout, stderr: run.stderr }, { exit: 0, stdout: "", stderr: "" });
      assert.deepEqual(run.events, []);
    });
  }
});

describe("core/src/gates/proddeploy.ts: a deny pattern grep exits 2 on denies nothing, as the bash gate's own grep does", () => {
  test(`${A_PATTERN_GREP_EXITS_TWO_ON} leaves a command it aims squarely at alone (read from plugin/hooks/block-prod-deploy.sh:130,134)`, () => {
    const run = judge(["proddeploy"], armedRunDenying(A_PATTERN_GREP_EXITS_TWO_ON), bashEnvelope("abc-prod"));
    assert.deepEqual({ exit: run.exit, stdout: run.stdout, stderr: run.stderr }, { exit: 0, stdout: "", stderr: "" });
    assert.deepEqual(run.events, []);
  });

  test("a later pattern still bites, because grep's exit 2 ends the pattern and not the file (read from plugin/hooks/block-prod-deploy.sh:129-133)", () => {
    const run = judge(
      ["proddeploy"],
      armedRunDenying(`${A_PATTERN_GREP_EXITS_TWO_ON}\n^ship-it`),
      bashEnvelope("ship-it now"),
    );
    assert.equal(run.exit, 0);
    assert.equal(run.stderr, "");
    assert.match(run.stdout, /"permissionDecision":"deny"/);
    assert.match(run.stdout, /this repository denies this command while one is/);
  });

  test(`${A_PCRE_SPELLING_GREP_READS_AS_ERE} bites the command grep's own ERE reading bites (read from plugin/hooks/block-prod-deploy.sh:130)`, () => {
    const run = judge(["proddeploy"], armedRunDenying(A_PCRE_SPELLING_GREP_READS_AS_ERE), bashEnvelope("ship-prod"));
    assert.equal(run.exit, 0);
    assert.match(run.stdout, /"permissionDecision":"deny"/);
  });

  test(`${A_PCRE_SPELLING_GREP_READS_AS_ERE} spares the command that reading spares`, () => {
    const run = judge(["proddeploy"], armedRunDenying(A_PCRE_SPELLING_GREP_READS_AS_ERE), bashEnvelope("npm run build"));
    assert.deepEqual({ exit: run.exit, stdout: run.stdout, stderr: run.stderr }, { exit: 0, stdout: "", stderr: "" });
  });

  test(`${A_RANGE_OPENED_BY_THE_BRACKET_ITSELF} bites the command grep's own range from ] bites`, () => {
    const run = judge(
      ["proddeploy"],
      armedRunDenying(A_RANGE_OPENED_BY_THE_BRACKET_ITSELF),
      bashEnvelope("npm run build"),
    );
    assert.equal(run.exit, 0);
    assert.match(run.stdout, /"permissionDecision":"deny"/);
  });

  test(`${A_RANGE_OPENED_BY_THE_BRACKET_ITSELF} spares the command that range spares`, () => {
    const run = judge(
      ["proddeploy"],
      armedRunDenying(A_RANGE_OPENED_BY_THE_BRACKET_ITSELF),
      bashEnvelope("npm run test"),
    );
    assert.deepEqual({ exit: run.exit, stdout: run.stdout, stderr: run.stderr }, { exit: 0, stdout: "", stderr: "" });
  });

  test("a pattern the port does read leaves a command it does not aim at alone", () => {
    const run = judge(["proddeploy"], armedRunDenying("^ship-it"), bashEnvelope("npm run build"));
    assert.deepEqual({ exit: run.exit, stdout: run.stdout, stderr: run.stderr }, { exit: 0, stdout: "", stderr: "" });
  });
});

function gateErrorLineTheBashPrints(subject: string): string {
  return `oso-code: ${subject} failed unexpectedly and blocked this call instead of opening the gate. No remedy is known for this failure.\n`;
}

function armedRunDenying(pattern: string): Readonly<Record<string, string>> {
  return { ...ARMED_RUN_STATE, [`${STATE_ROOT_THESE_TESTS_SPELL}/deploy-deny/{repo}.patterns`]: `${pattern}\n` };
}

function bashEnvelope(command: string): string {
  return (
    '{"session_id":"test-session","cwd":"{cwd}","hook_event_name":"PreToolUse","tool_name":"Bash",' +
    `"tool_input":{"command":${JSON.stringify(command)}}}`
  );
}

function judge(argv: readonly string[], seed: Readonly<Record<string, string>>, envelope: string) {
  return withStateSandbox("workspace", (sandbox) => {
    sandbox.seed(seed);
    return withHookEnvironment({ HOME: sandbox.home }, () => runGate(argv, spawnedEnvelope(sandbox.expandJson(envelope), process.env)));
  });
}
