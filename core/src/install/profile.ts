import path from "node:path";
import { profileFileFor, readStateFile, StateFileUnreadableError, stateFileFor, stateValue, writeFileAtomically } from "../state/store.ts";
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

const ON_DEFAULT: RoleChoice = { tier: "default", model: undefined };
const ON_STRONG: RoleChoice = { tier: "strong", model: undefined };

const PRESETS: Readonly<Record<PresetName, RolesOfProfile>> = {
  normal: { applier: ON_DEFAULT, verifier: ON_DEFAULT, judges: ON_STRONG },
  strong: { applier: ON_STRONG, verifier: ON_STRONG, judges: ON_STRONG },
};

const TIER_RANK: Readonly<Record<Tier, number>> = { default: 0, strong: 1 };

class ProfileRefusedError extends Error {
  constructor(reason: string) {
    super(`profile set refused: ${reason}`);
    this.name = "ProfileRefusedError";
  }
}

export function showProfile(workingDirectory: string): CommandOutcome {
  const mirror = mirrorFileFor(workingDirectory);
  const read = readStateFile(mirror);
  if (read.kind === "unreadable") throw new StateFileUnreadableError(mirror, read.cause);
  if (read.kind === "absent") return { report: `oso profile show\nno profile at ${mirror} — every role runs on its host's session model\n`, exitCode: 0 };
  return { report: `oso profile show\n${mirror}\n${read.content}`, exitCode: 0 };
}

export function setProfile(workingDirectory: string, name: string, roleTokens: readonly string[]): CommandOutcome {
  const profile = profileFrom(name, roleTokens);
  const mirror = mirrorFileFor(workingDirectory);
  const content = mirrorContentOf(profile);
  writeFileAtomically(path.dirname(mirror), mirror, content, ".profile.");
  return { report: `oso profile set ${profile.name}\n${mirror}\n${content}`, exitCode: 0 };
}

export function readProfileRoles(workingDirectory: string): RoleChoices {
  const mirror = mirrorFileFor(workingDirectory);
  const read = readStateFile(mirror);
  if (read.kind === "unreadable") throw new StateFileUnreadableError(mirror, read.cause);
  return read.kind === "absent" ? {} : roleChoicesOfMirror(read.content);
}

function mirrorFileFor(workingDirectory: string): string {
  return profileFileFor(stateFileFor(workingDirectory));
}

function roleChoicesOfMirror(content: string): RoleChoices {
  const chosen: RoleChoices = {};
  for (const role of ROLES) {
    const tier = stateValue(content, tierRecord(role));
    if (!isTier(tier)) continue;
    const named = stateValue(content, modelRecord(role));
    chosen[role] = { tier, model: named === "" ? undefined : named };
  }
  return chosen;
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
  refuseVerifierBelowApplier(applier, verifier);
  return { applier, verifier, judges };
}

function refuseVerifierBelowApplier(applier: RoleChoice, verifier: RoleChoice): void {
  if (TIER_RANK[verifier.tier] >= TIER_RANK[applier.tier]) return;
  throw new ProfileRefusedError(
    `the verifier tier ${verifier.tier} is below the applier tier ${applier.tier} — ${roleFlag("verifier")} ${applier.tier} would have passed`,
  );
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
