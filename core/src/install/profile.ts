import path from "node:path";
import {
  isModelToken,
  isReadableRegularFile,
  MODEL_TOKEN_SHAPE,
  profileFileFor,
  readStateFile,
  repositoryIdFor,
  repositoryIdentityFor,
  StateFileUnreadableError,
  stateFileFor,
  stateRecords,
  writeFileAtomically,
} from "../state/store.ts";
import { JsonParseError, readJsonFile } from "./json.ts";
import { installedAgentModels, openCodeAgentModels, OPENCODE_AGENTS_THE_PROFILE_DRIVES, remainingPromptsOf } from "./opencode-config.ts";
import type { CommandOutcome } from "./report.ts";

const ROLES = ["applier", "verifier", "judges"] as const;
const TIERS = ["default", "strong"] as const;
const PROFILE_NAMES = ["normal", "strong", "custom"] as const;

export type Role = (typeof ROLES)[number];
export type Tier = (typeof TIERS)[number];
type ProfileName = (typeof PROFILE_NAMES)[number];
type PresetName = Exclude<ProfileName, "custom">;

export type RoleChoice = Readonly<{ tier: Tier; model: string | undefined }>;
type RolesOfProfile = Readonly<Record<Role, RoleChoice>>;
export type RoleChoices = Partial<Record<Role, RoleChoice>>;
type Profile = Readonly<{ name: ProfileName; roles: RolesOfProfile }>;
type TierFloorBreach = Readonly<{ reason: string; role: Role; floor: Tier }>;

const BLOCK_INDENT = "  ";

type ConfigReading = Readonly<{ kind: "read"; document: unknown } | { kind: "unread"; cause: string }>;

export type ProfileMirror = Readonly<{ file: string; repository: string; digest: string }>;

export type ProfileReading = Readonly<
  { kind: "mirrored"; mirror: ProfileMirror; content: string; roles: RoleChoices } | { kind: "unmirrored"; mirror: ProfileMirror }
>;

const ON_DEFAULT: RoleChoice = { tier: "default", model: undefined };
const ON_STRONG: RoleChoice = { tier: "strong", model: undefined };

const PRESETS: Readonly<Record<PresetName, RolesOfProfile>> = {
  normal: { applier: ON_DEFAULT, verifier: ON_DEFAULT, judges: ON_STRONG },
  strong: { applier: ON_STRONG, verifier: ON_STRONG, judges: ON_STRONG },
};

const TIER_RANK: Readonly<Record<Tier, number>> = { default: 0, strong: 1 };
const FORKED_JUDGES_FLOOR: Tier = "strong";

class ProfileRefusedError extends Error {
  constructor(reason: string) {
    super(`profile set refused: ${reason}`);
    this.name = "ProfileRefusedError";
  }
}

export class ProfileMirrorRefusedError extends Error {
  constructor(mirror: string, reason: string) {
    super(`the profile mirror at ${mirror} is refused: ${reason}`);
    this.name = "ProfileMirrorRefusedError";
  }
}

export function showProfile(workingDirectory: string, openCodeConfigFile: string): CommandOutcome {
  const profile = readProfile(workingDirectory);
  const config = openCodeConfigReading(openCodeConfigFile);
  const sections = [
    mirrorSection(profile),
    keyedToLine(profile.mirror),
    unrankableModelSection(profileRolesOf(profile)),
    openCodeAgentModelSection(openCodeConfigFile, config, profile),
    openCodePromptSection(openCodeConfigFile, config),
  ];
  return { report: `oso profile show\n${sections.join("")}`, exitCode: 0 };
}

export function setProfile(workingDirectory: string, name: string, roleTokens: readonly string[]): CommandOutcome {
  const profile = profileFrom(name, roleTokens);
  const mirror = mirrorFor(workingDirectory);
  const content = mirrorContentOf(profile);
  writeFileAtomically(path.dirname(mirror.file), mirror.file, content, ".profile.");
  return { report: `oso profile set ${profile.name}\n${mirror.file}\n${content}${keyedToLine(mirror)}`, exitCode: 0 };
}

export function readProfile(workingDirectory: string): ProfileReading {
  const mirror = mirrorFor(workingDirectory);
  const read = readStateFile(mirror.file);
  if (read.kind === "unreadable") throw new StateFileUnreadableError(mirror.file, read.cause);
  if (read.kind === "absent") return { kind: "unmirrored", mirror };
  return { kind: "mirrored", mirror, content: read.content, roles: roleChoicesOfMirror(mirror.file, read.content) };
}

export function profileRolesOf(reading: ProfileReading): RoleChoices {
  return reading.kind === "mirrored" ? reading.roles : {};
}

function mirrorFor(workingDirectory: string): ProfileMirror {
  const stateFile = stateFileFor(workingDirectory);
  return { file: profileFileFor(stateFile), repository: repositoryIdentityFor(workingDirectory), digest: repositoryIdFor(stateFile) };
}

function mirrorSection(profile: ProfileReading): string {
  if (profile.kind === "unmirrored") return `no profile at ${profile.mirror.file} — every role runs on its host's session model\n`;
  return `${profile.mirror.file}\n${profile.content}`;
}

function keyedToLine(mirror: ProfileMirror): string {
  return `this profile is per repository, keyed to ${mirror.repository} (digest ${mirror.digest})\n`;
}

export function modelOverridesTheTierCannotRank(roles: RoleChoices): readonly string[] {
  return ROLES.flatMap((role) => {
    const choice = roles[role];
    return choice?.model === undefined
      ? []
      : [`${role}: ${choice.tier} declared — model ${choice.model} overrides the tier's session field; the harness cannot rank it`];
  });
}

function unrankableModelSection(roles: RoleChoices): string {
  return modelOverridesTheTierCannotRank(roles)
    .map((declared) => `${declared}\n`)
    .join("");
}

function openCodeAgentModelSection(configFile: string, config: ConfigReading, profile: ProfileReading): string {
  const heading = `agent model keys the installed OpenCode config carries, read from ${configFile}:\n`;
  if (config.kind === "unread") return `${heading}${BLOCK_INDENT}${config.cause}, so no agent model key was read\n`;
  const lines = agentModelMarkings(config.document, profile);
  return `${heading}${lines.map((line) => `${BLOCK_INDENT}${line}\n`).join("")}`;
}

function agentModelMarkings(document: unknown, profile: ProfileReading): readonly string[] {
  const installed = installedAgentModels(document);
  if (profile.kind === "unmirrored") {
    const read = OPENCODE_AGENTS_THE_PROFILE_DRIVES.map((agent) => `${agent} — installed: ${installed[agent] ?? "none"}`);
    return [...read, "no profile for this repository — set one with `oso profile set normal|strong|custom …` from this directory"];
  }
  const mirrored = openCodeAgentModels(document, profile.roles);
  return OPENCODE_AGENTS_THE_PROFILE_DRIVES.map((agent) => markedAgainstTheMirror(agent, installed[agent], mirrored[agent]));
}

const AN_INSTALL_FROM_THIS_DIRECTORY = "run oso install --host opencode from this directory";

function markedAgainstTheMirror(agent: string, installed: string | undefined, mirrored: string | undefined): string {
  if (installed === undefined) return `${agent} — absent — ${AN_INSTALL_FROM_THIS_DIRECTORY} to apply`;
  if (installed === mirrored) return `${agent}=${installed} — matches this mirror`;
  return `${agent}=${installed} — differs — set from another repository or by hand; ${AN_INSTALL_FROM_THIS_DIRECTORY} to apply this mirror`;
}

function openCodePromptSection(configFile: string, config: ConfigReading): string {
  const heading = `prompts that remain on OpenCode, read from ${configFile}:\n`;
  if (config.kind === "unread") return `${heading}${BLOCK_INDENT}${config.cause}, so every prompt this host asks today still stops an unattended run\n`;
  const prompts = remainingPromptsOf(config.document);
  if (prompts.length === 0) return `${heading}${BLOCK_INDENT}none\n`;
  return `${heading}${prompts.map((prompt) => `${BLOCK_INDENT}${prompt}\n`).join("")}`;
}

function openCodeConfigReading(configFile: string): ConfigReading {
  if (!isReadableRegularFile(configFile)) return { kind: "unread", cause: "no readable OpenCode config" };
  try {
    return { kind: "read", document: readJsonFile(configFile) };
  } catch (error) {
    if (!(error instanceof JsonParseError)) throw error;
    return { kind: "unread", cause: error.message };
  }
}

function roleChoicesOfMirror(mirror: string, content: string): RoleChoices {
  const chosen: RoleChoices = {};
  for (const role of ROLES) {
    chosen[role] = { tier: tierOfMirror(mirror, content, role), model: modelOfMirror(mirror, content, role) };
  }
  const breach = tierFloorBreachOf(chosen);
  if (breach !== undefined) {
    throw new ProfileMirrorRefusedError(mirror, `${breach.reason} — ${tierRecord(breach.role)}=${breach.floor} would have passed`);
  }
  return chosen;
}

function tierOfMirror(mirror: string, content: string, role: Role): Tier {
  const key = tierRecord(role);
  const records = stateRecords(content, key);
  if (records.length !== 1) throw soleRecordRefusal(mirror, key, records.length);
  const declared = records[0] as string;
  if (!isTier(declared)) throw new ProfileMirrorRefusedError(mirror, `${key}=${declared} names no tier — the tiers are ${TIERS.join(", ")}`);
  return declared;
}

function modelOfMirror(mirror: string, content: string, role: Role): string | undefined {
  const key = modelRecord(role);
  const records = stateRecords(content, key);
  if (records.length === 0) return undefined;
  if (records.length > 1) throw soleRecordRefusal(mirror, key, records.length);
  const declared = records[0] as string;
  if (!isModelToken(declared)) {
    throw new ProfileMirrorRefusedError(mirror, `${key}=${JSON.stringify(declared)} names no model — ${MODEL_TOKEN_SHAPE} would have passed`);
  }
  return declared;
}

function soleRecordRefusal(mirror: string, key: string, records: number): ProfileMirrorRefusedError {
  const found = records === 0 ? `${key} names no record` : `${key} names ${records} records`;
  return new ProfileMirrorRefusedError(mirror, `${found} — exactly one ${key}= record would have passed`);
}

function profileFrom(name: string, roleTokens: readonly string[]): Profile {
  if (!isProfileName(name)) throw new ProfileRefusedError(`${name} is not a profile name — the names are ${PROFILE_NAMES.join(", ")}`);
  const chosen = roleChoicesFrom(roleTokens);
  if (name === "custom") return { name, roles: customRoles(chosen) };
  return { name, roles: presetRoles(name, chosen) };
}

function presetRoles(name: PresetName, chosen: RoleChoices): RolesOfProfile {
  const roleNamed = ROLES.find((role) => chosen[role] !== undefined);
  if (roleNamed !== undefined) {
    throw new ProfileRefusedError(`${roleFlag(roleNamed)} names a role only "set custom" takes — the ${name} preset names its own`);
  }
  return PRESETS[name];
}

function customRoles(chosen: RoleChoices): RolesOfProfile {
  const { applier, verifier, judges } = chosen;
  if (applier === undefined) throw missingRole("applier");
  if (verifier === undefined) throw missingRole("verifier");
  if (judges === undefined) throw missingRole("judges");
  const breach = tierFloorBreachOf(chosen);
  if (breach !== undefined) {
    throw new ProfileRefusedError(`${breach.reason} — ${roleFlag(breach.role)} ${breach.floor} would have passed`);
  }
  return { applier, verifier, judges };
}

function tierFloorBreachOf(chosen: RoleChoices): TierFloorBreach | undefined {
  const { applier, verifier, judges } = chosen;
  if (applier !== undefined && verifier !== undefined && TIER_RANK[verifier.tier] < TIER_RANK[applier.tier]) {
    return { reason: `the verifier tier ${verifier.tier} is below the applier tier ${applier.tier}`, role: "verifier", floor: applier.tier };
  }
  if (judges !== undefined && TIER_RANK[judges.tier] < TIER_RANK[FORKED_JUDGES_FLOOR]) {
    return {
      reason: `the judges tier ${judges.tier} is below the ${FORKED_JUDGES_FLOOR} tier the forked judges hold`,
      role: "judges",
      floor: FORKED_JUDGES_FLOOR,
    };
  }
  return undefined;
}

function missingRole(role: Role): ProfileRefusedError {
  return new ProfileRefusedError(`a custom profile names every role — ${roleFlag(role)} <tier>[:<model>] is missing`);
}

function roleChoicesFrom(tokens: readonly string[]): RoleChoices {
  const chosen: RoleChoices = {};
  for (let index = 0; index < tokens.length; index += 2) {
    const flag = tokens[index] as string;
    const role = roleOf(flag);
    if (chosen[role] !== undefined) throw new ProfileRefusedError(`${flag} may be given only once`);
    chosen[role] = roleChoiceFrom(flag, tokens[index + 1]);
  }
  return chosen;
}

function roleOf(flag: string): Role {
  const role = ROLES.find((candidate) => flag === roleFlag(candidate));
  if (role === undefined) throw new ProfileRefusedError(`${flag} names no role — the roles are ${ROLES.map(roleFlag).join(", ")}`);
  return role;
}

function roleChoiceFrom(flag: string, value: string | undefined): RoleChoice {
  if (value === undefined) throw new ProfileRefusedError(`${flag} takes <tier>[:<model>] and was given nothing`);
  const colon = value.indexOf(":");
  const tier = colon === -1 ? value : value.slice(0, colon);
  const model = colon === -1 ? undefined : value.slice(colon + 1);
  if (!isTier(tier)) throw new ProfileRefusedError(`${flag} ${value} names no tier — the tiers are ${TIERS.join(", ")}`);
  if (model === "") throw new ProfileRefusedError(`${flag} ${value} names no model after its colon — ${flag} ${tier} would have passed`);
  if (model !== undefined && !isModelToken(model)) {
    throw new ProfileRefusedError(`${flag} ${tier}:${JSON.stringify(model)} names no model — ${MODEL_TOKEN_SHAPE} would have passed`);
  }
  return { tier, model };
}

function roleFlag(role: Role): string {
  return `--${role}`;
}

function mirrorContentOf(profile: Profile): string {
  const lines = [
    `model_profile=${profile.name}`,
    ...ROLES.flatMap((role) => roleLines(role, profile.roles[role])),
    "codex=pinned by host contract",
    "unattended.doom_loop=ask",
  ];
  return lines.map((line) => `${line}\n`).join("");
}

function roleLines(role: Role, choice: RoleChoice): readonly string[] {
  const tier = `${tierRecord(role)}=${choice.tier}`;
  return choice.model === undefined ? [tier] : [tier, `${modelRecord(role)}=${choice.model}`];
}

function tierRecord(role: Role): string {
  return `${role}.tier`;
}

function modelRecord(role: Role): string {
  return `${role}.model`;
}

function isProfileName(value: string): value is ProfileName {
  return (PROFILE_NAMES as readonly string[]).includes(value);
}

function isTier(value: string): value is Tier {
  return (TIERS as readonly string[]).includes(value);
}
