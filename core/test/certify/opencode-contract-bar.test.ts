import assert from "node:assert/strict";
import { after, before, describe, type TestContext } from "node:test";
import path from "node:path";
import {
  EDIT_RULES_THE_HOST_RESOLVES_BY_LAST_MATCH,
  HARNESS_EXTERNAL_DIRECTORIES,
  HARNESS_EXTERNAL_DIRECTORY_VERDICT,
  HARNESS_OWNED_TREES_NO_AGENT_MAY_EDIT,
} from "../../src/install/opencode-config.ts";
import { SUPPORTED_OPENCODE_VERSION } from "../../src/install/pins.ts";
import { provedSomething } from "../support/proved.ts";
import { CERTIFY } from "./support/certify-guard.ts";
import { configHomeOf, installContractFixture, type ContractFixture } from "./support/contract-fixture.ts";
import { CONTRACT_BAR_BOUND_SECONDS, invokeContractBar, probeRegistrations, type RegistrationProbe } from "./support/drive.ts";
import {
  agentField,
  agentPermissionField,
  agentPermissionVerdicts,
  agentShellExactFormViolations,
  commandAgentRoute,
  isRecord,
  externalDirectoryRules,
  externalDirectoryVerdict,
  fieldOf,
  pluginOrigins,
  resolvedPermissionRules,
  resolvedVerdictOf,
  skillLocations,
  topLevelPermissionField,
} from "./support/config-fields.ts";
import { executionPowersTheHostWithheld, hostOutcomeOfToolCall, writeCall } from "./support/execution-powers.ts";
import { notRun } from "./support/not-run.ts";
import {
  laneCauseFor,
  laneNotRun,
  resolveOpenCodeBinaryProbe,
  resolvedProbeOrThrow,
  type OpenCodeBinaryProbe,
} from "./support/opencode-binary.ts";
import { CONTRACT_BAR_ROWS_PORTED, contractBarRow, contractBarRowsRegistered } from "./support/row-count.ts";
import { contractBarSourceAgentMode, contractBarSourceAgentNames, contractBarSourceSkillNames } from "./support/source-roster.ts";

const OVERRIDE_ENV_VAR = "OSO_CONTRACT_BAR_OPENCODE_BIN";
const SESSION_MODEL_PROVIDER = "opencode";
const SESSION_MODEL_PROVIDER_LINE = /^opencode\//;
const WAVE_TOOL_ID = "oso_wave";
const PLAN_APPROVAL_TOOL_ID = "oso_plan_approve";
const PLAN_CANCEL_TOOL_ID = "oso_plan_cancel";
const FIX_APPLY_TOOL_ID = "fallow_fix_apply";
const GRANT_BOUND_PERMISSION = "ask";
const WORKSPACE_ADAPTER_TYPE = "oso-code";
const PLAN_COMMAND = "oso-plan";
const DOUBT_PASS_AGENT_NAME = "oso-doubt-pass";
const BOUNDED_EDIT_AGENT_NAME = "oso-applier";
const CONFIG_LEVEL_EDIT_AGENT_NAME = "build";
const EDIT_PERMISSION = "edit";
const EXTERNAL_DIRECTORY_PERMISSION = "external_directory";
const A_PROMPT_NO_HARNESS_GRANT_CLOSES = "ask";
const EDIT_PROBE_REPOSITORY = "edit-verdict-repo";
const CONFIG_LEVEL_EDIT_PROBE_REPOSITORY = "config-level-edit-verdict-repo";
const EXECUTION_PROBE_REPOSITORY = "execution-power-repo";

type EditProbe = Readonly<{ filePath: string; outcome: "refused" | "executed" }>;

const EDIT_PROBES: readonly EditProbe[] = [
  { filePath: ".opencode/plugin/x.ts", outcome: "refused" },
  { filePath: "sub/.opencode/x.ts", outcome: "refused" },
  { filePath: ".git/hooks/pre-commit", outcome: "refused" },
  { filePath: ".git/config", outcome: "refused" },
  { filePath: ".git/worktrees/wt/config", outcome: "refused" },
  { filePath: ".git/modules/sub/config", outcome: "refused" },
  { filePath: ".githooks/pre-commit", outcome: "executed" },
  { filePath: "/home/op/.config/opencode/plugin/p.ts", outcome: "refused" },
  { filePath: ".local/state/oso-code/wave.state", outcome: "refused" },
  { filePath: "/home/op/.local/state/oso-code/wave.state", outcome: "refused" },
  { filePath: "src/index.ts", outcome: "executed" },
];

function configLevelEditProbes(configHome: string): readonly EditProbe[] {
  return [
    { filePath: path.join(configHome, "skill", "_shared", "rubric.md"), outcome: "refused" },
    { filePath: "src/index.ts", outcome: "executed" },
  ];
}
const AGENT_LIST_ENTRY_PATTERN = /^(\S+) \((?:primary|subagent|all)\)$/;

const SOURCE_AGENT_NAMES = contractBarSourceAgentNames();
const SOURCE_SKILL_NAMES = contractBarSourceSkillNames();

const probe: OpenCodeBinaryProbe | undefined = CERTIFY
  ? resolveOpenCodeBinaryProbe(process.env[OVERRIDE_ENV_VAR], SUPPORTED_OPENCODE_VERSION, process.env)
  : undefined;

const laneCause = laneCauseFor(probe, SUPPORTED_OPENCODE_VERSION);

contractBarRow(
  probe === undefined
    ? "the OpenCode binary this bar introspects is the pinned one"
    : probe.kind === "resolved"
      ? `the OpenCode binary this bar introspects measures ${probe.version} against the ${SUPPORTED_OPENCODE_VERSION} pin, relation ${probe.relation}`
      : `the OpenCode binary this bar introspects could not be resolved — ${probe.reason}`,
  (t) => {
    if (laneNotRun(t, probe, laneCause)) return;
    const resolved = resolvedProbeOrThrow(probe);
    assert.ok(resolved.relation === "at-pin" || resolved.relation === "above-pin");
  },
);

type ConfigProbe =
  | Readonly<{ kind: "parsed"; document: unknown }>
  | Readonly<{ kind: "failed"; reason: string }>;

type HarnessPath = Readonly<{ role: string; location: string }>;

type SkillProbe =
  | Readonly<{ kind: "listed"; locations: ReadonlyMap<string, string> }>
  | Readonly<{ kind: "failed"; reason: string }>;

function invokeCommandOrFailure(
  binary: string,
  environment: NodeJS.ProcessEnv,
  args: readonly string[],
): Readonly<{ kind: "failed"; reason: string }> | Readonly<{ kind: "ran"; stdout: string }> {
  const run = invokeContractBar({ binary, environment, args, boundSeconds: CONTRACT_BAR_BOUND_SECONDS });
  const label = `opencode ${args.join(" ")}`;
  if (run.error !== undefined || run.signal !== null) {
    return { kind: "failed", reason: `${label} did not complete: ${run.error?.message ?? run.signal}` };
  }
  if (run.status !== 0) return { kind: "failed", reason: `${label} exited ${run.status}: ${run.stderr ?? ""}` };
  return { kind: "ran", stdout: run.stdout ?? "" };
}

function debugConfigProbe(binary: string, environment: NodeJS.ProcessEnv): ConfigProbe {
  const invoked = invokeCommandOrFailure(binary, environment, ["debug", "config"]);
  if (invoked.kind === "failed") return invoked;
  try {
    return { kind: "parsed", document: JSON.parse(invoked.stdout) };
  } catch (error) {
    return { kind: "failed", reason: `opencode debug config produced unparsable JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function debugSkillProbe(binary: string, environment: NodeJS.ProcessEnv): SkillProbe {
  const invoked = invokeCommandOrFailure(binary, environment, ["debug", "skill"]);
  if (invoked.kind === "failed") return invoked;
  try {
    return { kind: "listed", locations: skillLocations(JSON.parse(invoked.stdout)) };
  } catch (error) {
    return { kind: "failed", reason: `opencode debug skill produced unparsable JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}

describe("the contract fixture install and what the real binary reports once it is ready", () => {
  let fixture: ContractFixture | undefined;
  let registrations: RegistrationProbe | undefined;
  let config: ConfigProbe | undefined;
  let skills: SkillProbe | undefined;

  before(async () => {
    if (probe === undefined || probe.kind !== "resolved" || laneCause !== undefined) return;
    fixture = installContractFixture(probe);
    if (fixture.exitCode !== 0) return;
    registrations = await probeRegistrations(probe.binary, fixture.environment, fixture.sandbox);
    config = debugConfigProbe(probe.binary, fixture.environment);
    skills = debugSkillProbe(probe.binary, fixture.environment);
  });

  after(() => {
    fixture?.sandbox.dispose();
  });

  function readyFixtureOrThrow(): ContractFixture {
    if (fixture === undefined || fixture.exitCode !== 0) throw new Error("unreachable: a ready fixture was expected");
    return fixture;
  }

  function notRunUnlessFixtureReady(t: TestContext, gate: string): boolean {
    if (laneNotRun(t, probe, laneCause)) return true;
    if (fixture === undefined || fixture.exitCode !== 0) {
      notRun(t, `the contract fixture install failed, so ${gate} could not be driven`);
      return true;
    }
    return false;
  }

  function notRunUnlessRegistered(t: TestContext): RegistrationProbe | undefined {
    if (notRunUnlessFixtureReady(t, "the plugin registration")) return undefined;
    if (registrations === undefined || registrations.kind === "failed") {
      notRun(t, registrations?.kind === "failed" ? registrations.reason : "the live server could not be probed");
      return undefined;
    }
    return registrations;
  }

  function notRunUnlessConfigParsed(t: TestContext): unknown | undefined {
    if (notRunUnlessFixtureReady(t, "the fixture's config")) return undefined;
    if (config === undefined || config.kind === "failed") {
      notRun(t, config?.kind === "failed" ? config.reason : "opencode debug config was never invoked");
      return undefined;
    }
    return config.document;
  }

  function notRunUnlessSkillsListed(t: TestContext): ReadonlyMap<string, string> | undefined {
    if (notRunUnlessFixtureReady(t, "the skill registry")) return undefined;
    if (skills === undefined || skills.kind === "failed") {
      notRun(t, skills?.kind === "failed" ? skills.reason : "opencode debug skill was never invoked");
      return undefined;
    }
    return skills.locations;
  }

  contractBarRow("contract fixture install", (t) => {
    if (laneNotRun(t, probe, laneCause)) return;
    assert.equal(fixture?.exitCode, 0, fixture?.report ?? "the fixture was never installed");
  });

  contractBarRow(`the host catalog offers the ${SESSION_MODEL_PROVIDER} provider the session model comes from`, (t) => {
    if (notRunUnlessFixtureReady(t, "the model catalog")) return;
    const resolved = resolvedProbeOrThrow(probe);
    const installed = readyFixtureOrThrow();
    const invoked = invokeCommandOrFailure(resolved.binary, installed.environment, ["models"]);
    if (invoked.kind === "failed") {
      notRun(t, invoked.reason);
      return;
    }
    const offered = invoked.stdout.split("\n").some((line) => SESSION_MODEL_PROVIDER_LINE.test(line));
    assert.ok(offered, `the host catalog did not offer an opencode/ model:\n${invoked.stdout}`);
  });

  const toolRows = [
    ["wave", WAVE_TOOL_ID],
    ["plan-approval", PLAN_APPROVAL_TOOL_ID],
    ["plan-cancel", PLAN_CANCEL_TOOL_ID],
  ] as const;

  for (const [label, toolId] of toolRows) {
    contractBarRow(`the real binary registers the installed plugin's ${label} tool`, (t) => {
      const listed = notRunUnlessRegistered(t);
      if (listed === undefined || listed.kind !== "listed") return;
      assert.ok(listed.toolIds.includes(toolId), `${toolId} was not among: ${listed.toolIds.join(", ")}`);
    });
  }

  contractBarRow(`the real binary lists the installed plugin's ${WORKSPACE_ADAPTER_TYPE} workspace adapter`, (t) => {
    const listed = notRunUnlessRegistered(t);
    if (listed === undefined || listed.kind !== "listed") return;
    assert.ok(
      listed.workspaceAdapterTypes.includes(WORKSPACE_ADAPTER_TYPE),
      `${WORKSPACE_ADAPTER_TYPE} was not among: ${listed.workspaceAdapterTypes.join(", ")}`,
    );
  });

  contractBarRow("the roster enumerates every installed oso agent", (t) => {
    if (notRunUnlessFixtureReady(t, "the agent roster")) return;
    const resolved = resolvedProbeOrThrow(probe);
    const installed = readyFixtureOrThrow();
    const invoked = invokeCommandOrFailure(resolved.binary, installed.environment, ["agent", "list"]);
    if (invoked.kind === "failed") {
      notRun(t, invoked.reason);
      return;
    }
    const roster = new Set(
      invoked.stdout
        .split("\n")
        .map((line) => AGENT_LIST_ENTRY_PATTERN.exec(line)?.[1])
        .filter((name): name is string => name !== undefined),
    );
    const missing = SOURCE_AGENT_NAMES.filter((name) => !roster.has(name));
    assert.deepEqual(missing, [], `missing from the roster: ${missing.join(", ")}`);
  });

  for (const name of SOURCE_AGENT_NAMES) {
    contractBarRow(`the real binary resolves ${name}'s mode from the fixture install`, (t) => {
      const document = notRunUnlessConfigParsed(t);
      if (document === undefined) return;
      const modes = agentField(document, "mode");
      assert.equal(fieldOf(modes, name) || "unset", contractBarSourceAgentMode(name));
    });
  }

  contractBarRow("the real binary resolves no oso agent to a model of its own", (t) => {
    const document = notRunUnlessConfigParsed(t);
    if (document === undefined) return;
    const models = agentField(document, "model");
    const pinned = SOURCE_AGENT_NAMES.filter((name) => {
      const model = fieldOf(models, name);
      return model !== "" && model !== "absent";
    }).map((name) => `${name}(${fieldOf(models, name)})`);
    assert.deepEqual(pinned, [], `agents pinned to a model of their own: ${pinned.join(", ")}`);
  });

  for (const name of SOURCE_AGENT_NAMES) {
    contractBarRow(`the real binary resolves ${name}'s question rule from the fixture install`, (t) => {
      const document = notRunUnlessConfigParsed(t);
      if (document === undefined) return;
      const rules = agentPermissionField(document, "question");
      assert.equal(fieldOf(rules, name), "deny");
    });
  }

  function expectedShellRule(name: string): string {
    return name === DOUBT_PASS_AGENT_NAME ? "deny" : "absent";
  }

  for (const name of SOURCE_AGENT_NAMES) {
    contractBarRow(`the real binary resolves ${name}'s read and bash rules from the fixture install`, (t) => {
      const document = notRunUnlessConfigParsed(t);
      if (document === undefined) return;
      const reads = agentPermissionField(document, "read");
      const shells = agentPermissionField(document, "bash");
      assert.equal(`${fieldOf(reads, name)} ${fieldOf(shells, name)}`, `absent ${expectedShellRule(name)}`);
    });
  }

  for (const name of SOURCE_AGENT_NAMES) {
    contractBarRow(`the real binary leaves ${name} no ${FIX_APPLY_TOOL_ID}, whichever rule key its own block spells`, (t) => {
      const document = notRunUnlessConfigParsed(t);
      if (document === undefined) return;
      const verdicts = agentPermissionVerdicts(document, FIX_APPLY_TOOL_ID);
      assert.equal(fieldOf(verdicts, name), "deny");
    });
  }

  for (const name of SOURCE_AGENT_NAMES) {
    contractBarRow(`the real binary resolves ${name}'s grant-bound tool rules from the fixture install`, (t) => {
      const document = notRunUnlessConfigParsed(t);
      if (document === undefined) return;
      const approvals = agentPermissionField(document, PLAN_APPROVAL_TOOL_ID);
      const cancels = agentPermissionField(document, PLAN_CANCEL_TOOL_ID);
      assert.equal(`${fieldOf(approvals, name)} ${fieldOf(cancels, name)}`, "deny deny");
    });
  }

  contractBarRow("the real binary resolves every agent shell allowlist to exact forms", (t) => {
    const document = notRunUnlessConfigParsed(t);
    if (document === undefined) return;
    const violations = agentShellExactFormViolations(document);
    assert.deepEqual(violations, [], `inexact shell allowlist forms: ${violations.join(", ")}`);
  });

  contractBarRow(
    "the real binary routes the plan command to an agent it lets run every power of the execution phase",
    (t) => {
      const document = notRunUnlessConfigParsed(t);
      if (document === undefined) return;
      const resolved = resolvedProbeOrThrow(probe);
      const installed = readyFixtureOrThrow();
      const route = commandAgentRoute(document, PLAN_COMMAND);
      const withheld = executionPowersTheHostWithheld({
        binary: resolved.binary,
        environment: installed.environment,
        projectDirectory: installed.sandbox.seedGitRepository(EXECUTION_PROBE_REPOSITORY),
        agent: route,
      });
      assert.deepEqual(withheld, [], `${route} withheld ${withheld.join(", ")}`);
    },
  );

  contractBarRow("the real binary resolves every agent's edit verdict, the six as a scalar deny and the applier as a pattern object", (t) => {
    const document = notRunUnlessConfigParsed(t);
    if (document === undefined) return;
    const rules = agentPermissionField(document, EDIT_PERMISSION);
    const resolved = SOURCE_AGENT_NAMES.map((name) => `${name}=${fieldOf(rules, name)}`);
    assert.deepEqual(
      resolved,
      SOURCE_AGENT_NAMES.map((name) => `${name}=${name === BOUNDED_EDIT_AGENT_NAME ? "allowlist" : "deny"}`),
      resolved.join(" "),
    );
  });

  contractBarRow(
    `the real binary resolves ${BOUNDED_EDIT_AGENT_NAME}'s edit rules as the config-level denies every agent inherits followed by the order the render wrote`,
    (t) => {
      const debugged = notRunUnlessAgentDebugged(t, BOUNDED_EDIT_AGENT_NAME);
      if (debugged === undefined) return;
      const edits = resolvedPermissionRules(debugged)
        .filter((rule) => rule["permission"] === EDIT_PERMISSION)
        .map((rule) => rule["pattern"]);
      assert.deepEqual(edits, [...HARNESS_OWNED_TREES_NO_AGENT_MAY_EDIT, ...EDIT_RULES_THE_HOST_RESOLVES_BY_LAST_MATCH.map((rule) => rule.pattern)]);
    },
  );

  contractBarRow(
    `the real binary refuses ${BOUNDED_EDIT_AGENT_NAME} the write tool on the resources the host derives for the denied surfaces`,
    (t) => {
      if (notRunUnlessFixtureReady(t, `${BOUNDED_EDIT_AGENT_NAME}'s edit verdicts`)) return;
      const resolved = resolvedProbeOrThrow(probe);
      const installed = readyFixtureOrThrow();
      const drive = {
        binary: resolved.binary,
        environment: installed.environment,
        projectDirectory: installed.sandbox.seedGitRepository(EDIT_PROBE_REPOSITORY),
        agent: BOUNDED_EDIT_AGENT_NAME,
      };
      const measured = EDIT_PROBES.map((edit) => `${edit.filePath} ${hostOutcomeOfToolCall(drive, writeCall(edit.filePath)).kind}`);
      assert.deepEqual(
        measured,
        EDIT_PROBES.map((edit) => `${edit.filePath} ${edit.outcome}`),
      );
    },
  );

  contractBarRow(
    `the real binary refuses ${CONFIG_LEVEL_EDIT_AGENT_NAME} the write tool on the harness's own trees and leaves the project where it was`,
    (t) => {
      if (notRunUnlessFixtureReady(t, `${CONFIG_LEVEL_EDIT_AGENT_NAME}'s edit verdicts`)) return;
      const resolved = resolvedProbeOrThrow(probe);
      const installed = readyFixtureOrThrow();
      const drive = {
        binary: resolved.binary,
        environment: installed.environment,
        projectDirectory: installed.sandbox.seedGitRepository(CONFIG_LEVEL_EDIT_PROBE_REPOSITORY),
        agent: CONFIG_LEVEL_EDIT_AGENT_NAME,
      };
      const probes = configLevelEditProbes(configHomeOf(installed));
      const measured = probes.map((edit) => `${edit.filePath} ${hostOutcomeOfToolCall(drive, writeCall(edit.filePath)).kind}`);
      assert.deepEqual(
        measured,
        probes.map((edit) => `${edit.filePath} ${edit.outcome}`),
      );
    },
  );

  contractBarRow(
    `the real binary still asks ${CONFIG_LEVEL_EDIT_AGENT_NAME} for a host surface no harness grant covers, so the config-level denies widened nothing`,
    (t) => {
      const debugged = notRunUnlessAgentDebugged(t, CONFIG_LEVEL_EDIT_AGENT_NAME);
      if (debugged === undefined) return;
      const ungranted = path.join(configHomeOf(readyFixtureOrThrow()), "plugins", "engram.ts");
      assert.equal(resolvedVerdictOf(debugged, EXTERNAL_DIRECTORY_PERMISSION, ungranted), A_PROMPT_NO_HARNESS_GRANT_CLOSES);
    },
  );

  for (const toolId of [PLAN_APPROVAL_TOOL_ID, PLAN_CANCEL_TOOL_ID]) {
    contractBarRow(`the real binary resolves the ${toolId} permission from the fixture install`, (t) => {
      const document = notRunUnlessConfigParsed(t);
      if (document === undefined) return;
      assert.equal(topLevelPermissionField(document, toolId), GRANT_BOUND_PERMISSION);
    });
  }

  function notRunUnlessAgentDebugged(t: TestContext, name: string): Record<string, unknown> | undefined {
    if (notRunUnlessFixtureReady(t, `${name}'s resolved ruleset`)) return undefined;
    const resolved = resolvedProbeOrThrow(probe);
    const invoked = invokeCommandOrFailure(resolved.binary, readyFixtureOrThrow().environment, ["debug", "agent", name]);
    if (invoked.kind === "failed") {
      notRun(t, invoked.reason);
      return undefined;
    }
    const debugged: unknown = JSON.parse(invoked.stdout);
    return isRecord(debugged) ? debugged : undefined;
  }

  function harnessPathsUnder(home: string): readonly HarnessPath[] {
    return [
      { role: "an installed skill wrapper", location: path.join(home, ".config", "opencode", "skill", "oso-plan", "SKILL.md") },
      { role: "an artifact in a host worktree", location: path.join(home, ".local", "share", "opencode", "worktree", "wave", "1", "note.txt") },
    ];
  }

  contractBarRow(
    "the real binary allows the harness's own two paths through an external_directory block that opens nothing else",
    (t) => {
      const document = notRunUnlessConfigParsed(t);
      if (document === undefined) return;
      const home = readyFixtureOrThrow().sandbox.home;
      assert.deepEqual(
        [...externalDirectoryRules(document)].map(([pattern, verdict]) => `${pattern} ${verdict}`).sort(),
        HARNESS_EXTERNAL_DIRECTORIES.map((pattern) => `${pattern} ${HARNESS_EXTERNAL_DIRECTORY_VERDICT}`).sort(),
      );
      const unallowed = harnessPathsUnder(home)
        .map((harness) => ({ ...harness, verdict: externalDirectoryVerdict(document, home, harness.location) }))
        .filter(({ verdict }) => verdict !== HARNESS_EXTERNAL_DIRECTORY_VERDICT)
        .map(({ role, location, verdict }) => `${role} (${location}) reads ${verdict}`);
      assert.deepEqual(unallowed, []);
    },
  );

  contractBarRow(
    "the real binary discovery list carries the installed plugin's pre-built oso-code.js bundle, not the oso-code.ts source it is compiled from",
    (t) => {
      const document = notRunUnlessConfigParsed(t);
      if (document === undefined) return;
      const installed = readyFixtureOrThrow();
      const expected = path.join(configHomeOf(installed), "plugin", "oso-code.js");
      const origins = pluginOrigins(document);
      assert.ok(origins.some((origin) => origin.includes(expected)), `${expected} was not among: ${origins.join(", ")}`);
    },
  );

  for (const name of SOURCE_SKILL_NAMES) {
    contractBarRow(`debug skill registers ${name} at its installed location`, (t) => {
      const locations = notRunUnlessSkillsListed(t);
      if (locations === undefined) return;
      const installed = readyFixtureOrThrow();
      const expected = path.join(configHomeOf(installed), "skill", name, "SKILL.md");
      assert.equal(fieldOf(locations, name), expected);
    });
  }
});

provedSomething(
  `at least ${CONTRACT_BAR_ROWS_PORTED} row(s) of tests/opencode-contract-bar.sh were registered in this file`,
  contractBarRowsRegistered() >= CONTRACT_BAR_ROWS_PORTED,
  `only ${contractBarRowsRegistered()} row(s) were registered, under the ${CONTRACT_BAR_ROWS_PORTED} this slice ported`,
);
