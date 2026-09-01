import { spawnSync } from "node:child_process";
import { repositoryRoot } from "./state-sandbox.ts";

export const PROSE_ANCHOR_COMMIT = "1c85baa";
export const AGENT_ROLE_PREFIXES = ["codex/agents/", "opencode/agents/", "plugin/agents/"] as const;

type SourcePrefixRule = Readonly<
  | { prefix: string; depth: "flat" | "recursive"; kind: "extension"; extension: string }
  | { prefix: string; depth: "flat" | "recursive"; kind: "exact"; name: string }
>;

const PROSE_SOURCE_RULES: readonly SourcePrefixRule[] = [
  { prefix: "plugin/skills/", depth: "recursive", kind: "extension", extension: ".md" },
  { prefix: "plugin/agents/", depth: "flat", kind: "extension", extension: ".md" },
  { prefix: "codex/skills/", depth: "recursive", kind: "exact", name: "SKILL.md" },
  { prefix: "codex/agents/", depth: "flat", kind: "extension", extension: ".toml" },
  { prefix: "opencode/skills/", depth: "recursive", kind: "exact", name: "SKILL.md" },
  { prefix: "opencode/agents/", depth: "flat", kind: "extension", extension: ".md" },
];

function globOf(rule: SourcePrefixRule): string {
  const tail = rule.kind === "exact" ? rule.name : `*${rule.extension}`;
  return rule.depth === "recursive" ? `${rule.prefix}**/${tail}` : `${rule.prefix}${tail}`;
}

function matchesRule(file: string, rule: SourcePrefixRule): boolean {
  if (!file.startsWith(rule.prefix)) return false;
  const rest = file.slice(rule.prefix.length);
  if (rule.depth === "flat" && rest.includes("/")) return false;
  const name = rest.slice(rest.lastIndexOf("/") + 1);
  return rule.kind === "exact" ? name === rule.name : name.endsWith(rule.extension);
}

export const PROSE_SOURCE_PREFIXES: readonly string[] = PROSE_SOURCE_RULES.map((rule) => rule.prefix);
export const PROSE_SOURCE_GLOBS: readonly string[] = PROSE_SOURCE_RULES.map(globOf);

export function isProseSourceFile(file: string): boolean {
  return PROSE_SOURCE_RULES.some((rule) => matchesRule(file, rule));
}

export type StateSpellingItem = Readonly<{ key: string; verb: string; subverb: string | null; file: string; line: number }>;

export type InvocationItem = Readonly<{ key: string; kind: "role" | "skill"; item: string; file: string; line: number }>;

export type VerdictTokenItem = Readonly<{ key: string; token: string; file: string; line: number }>;

export type HeadingItem = Readonly<{ file: string; heading: string; level: number; line: number }>;

export type CapabilityInventory = Readonly<{
  anchorCommit: string;
  extractionRules: Readonly<{
    sourceGlobs: readonly string[];
    axisAPattern: string;
    axisAHandoffSubverbRule: string;
    axisBRoleNames: readonly string[];
    axisBSkillTokenPattern: string;
    axisCPattern: string;
    axisDPattern: string;
  }>;
  files: Readonly<{
    pluginSkills: number;
    pluginAgents: number;
    codexSkills: number;
    codexAgents: number;
    opencodeSkills: number;
    opencodeAgents: number;
    total: number;
  }>;
  axisA: readonly StateSpellingItem[];
  axisB: readonly InvocationItem[];
  axisC: readonly VerdictTokenItem[];
  axisD: readonly HeadingItem[];
}>;

const OSO_STATE_MENTION = /oso-state(?:\}")?[ \t]*(?:--session[ \t]+"[^"]*"[ \t]+)?([a-z][a-z-]*)\b(?:[ \t]+([a-z][a-z-]*))?/g;
const SKILL_TOKEN_PATTERN = /\/?oso-code:([a-z-]+)/g;
const VERDICT_TOKEN_PATTERN = /`([A-Z][a-z]+(?: [A-Z][a-z]+){0,2}): ([a-z][A-Za-z0-9/_-]*(?: — [^`\n]*)?)`/g;
const HEADING_PATTERN = /^(#{2,4}) (.+)$/gm;
const CASE_LITERAL_PATTERN = /case "([a-z][a-z-]*)":/g;
const AXIS_A_HANDOFF_SUBVERB_RULE =
  "handoff subverbs are the case literals of core/src/state/cli.ts's handoff switch, read at extraction time from the commit being processed";

function gitLsTree(commit: string, pathspecs: readonly string[]): string[] {
  const result = spawnSync("git", ["ls-tree", "-r", "--name-only", commit, "--", ...pathspecs], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`git ls-tree ${commit} failed: ${result.stderr}`);
  return result.stdout.split("\n").filter((line) => line !== "");
}

export function sourceFilesAtCommit(commit: string): string[] {
  return gitLsTree(commit, PROSE_SOURCE_PREFIXES)
    .filter(isProseSourceFile)
    .sort();
}

export function readTextAtCommit(commit: string, file: string): string {
  const result = spawnSync("git", ["show", `${commit}:${file}`], { cwd: repositoryRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git show ${commit}:${file} failed: ${result.stderr}`);
  return result.stdout;
}

function agentRoleNamesAtCommit(commit: string): string[] {
  const names = new Set<string>();
  for (const file of gitLsTree(commit, AGENT_ROLE_PREFIXES)) {
    const root = AGENT_ROLE_PREFIXES.find((prefix) => file.startsWith(prefix));
    if (root === undefined) continue;
    const rest = file.slice(root.length);
    if (rest === "" || rest.includes("/")) continue;
    names.add(rest.replace(/\.(toml|md)$/, ""));
  }
  return [...names].sort();
}

function lineNumberAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

export function extractStateSpellings(file: string, text: string, handoffSubverbs: ReadonlySet<string>): StateSpellingItem[] {
  const items: StateSpellingItem[] = [];
  for (const match of text.matchAll(OSO_STATE_MENTION)) {
    const verb = match[1] as string;
    const nextWord = match[2];
    const subverb = verb === "handoff" && nextWord !== undefined && handoffSubverbs.has(nextWord) ? nextWord : null;
    const key = subverb === null ? verb : `${verb}:${subverb}`;
    items.push({ key, verb, subverb, file, line: lineNumberAt(text, match.index ?? 0) });
  }
  return items;
}

export function extractInvocations(file: string, text: string, roleNames: readonly string[]): InvocationItem[] {
  const items: InvocationItem[] = [];
  for (const role of roleNames) {
    const index = text.indexOf(role);
    if (index !== -1) items.push({ key: `role:${role}`, kind: "role", item: role, file, line: lineNumberAt(text, index) });
  }
  for (const match of text.matchAll(SKILL_TOKEN_PATTERN)) {
    const skill = match[1] as string;
    items.push({ key: `skill:${skill}`, kind: "skill", item: skill, file, line: lineNumberAt(text, match.index ?? 0) });
  }
  return items;
}

export function extractVerdictTokens(file: string, text: string): VerdictTokenItem[] {
  const items: VerdictTokenItem[] = [];
  for (const match of text.matchAll(VERDICT_TOKEN_PATTERN)) {
    const token = `${match[1]}: ${match[2]}`;
    items.push({ key: token, token, file, line: lineNumberAt(text, match.index ?? 0) });
  }
  return items;
}

export function extractHeadings(file: string, text: string): HeadingItem[] {
  const items: HeadingItem[] = [];
  for (const match of text.matchAll(HEADING_PATTERN)) {
    items.push({
      file,
      heading: (match[2] as string).trim(),
      level: (match[1] as string).length,
      line: lineNumberAt(text, match.index ?? 0),
    });
  }
  return items;
}

export type StateCliVerbs = Readonly<{ verbs: readonly string[]; handoffSubverbs: readonly string[] }>;

export function readStateCliVerbs(cliSourceText: string): StateCliVerbs {
  const subactionIndex = cliSourceText.indexOf("switch (subaction)");
  const mainSwitchText = subactionIndex === -1 ? cliSourceText : cliSourceText.slice(0, subactionIndex);
  const subactionSwitchText = subactionIndex === -1 ? "" : cliSourceText.slice(subactionIndex);
  return { verbs: casesIn(mainSwitchText), handoffSubverbs: casesIn(subactionSwitchText) };
}

function casesIn(text: string): string[] {
  return [...text.matchAll(CASE_LITERAL_PATTERN)].map((match) => match[1] as string);
}

function dedupeByKey<T extends { key: string }>(items: readonly T[]): T[] {
  const seen = new Map<string, T>();
  for (const item of items) if (!seen.has(item.key)) seen.set(item.key, item);
  return [...seen.values()];
}

function fileCountsByPrefix(files: readonly string[]): CapabilityInventory["files"] {
  const countUnder = (prefix: string) => files.filter((file) => file.startsWith(prefix)).length;
  return {
    pluginSkills: countUnder("plugin/skills/"),
    pluginAgents: countUnder("plugin/agents/"),
    codexSkills: countUnder("codex/skills/"),
    codexAgents: countUnder("codex/agents/"),
    opencodeSkills: countUnder("opencode/skills/"),
    opencodeAgents: countUnder("opencode/agents/"),
    total: files.length,
  };
}

export function buildCapabilityInventory(commit: string): CapabilityInventory {
  const files = sourceFilesAtCommit(commit);
  const roleNames = agentRoleNamesAtCommit(commit);
  const handoffSubverbs = new Set(readStateCliVerbs(readTextAtCommit(commit, "core/src/state/cli.ts")).handoffSubverbs);

  const axisA: StateSpellingItem[] = [];
  const axisB: InvocationItem[] = [];
  const axisC: VerdictTokenItem[] = [];
  const axisD: HeadingItem[] = [];

  for (const file of files) {
    const text = readTextAtCommit(commit, file);
    axisA.push(...extractStateSpellings(file, text, handoffSubverbs));
    axisB.push(...extractInvocations(file, text, roleNames));
    axisC.push(...extractVerdictTokens(file, text));
    axisD.push(...extractHeadings(file, text));
  }

  return {
    anchorCommit: commit,
    extractionRules: {
      sourceGlobs: PROSE_SOURCE_GLOBS,
      axisAPattern: OSO_STATE_MENTION.source,
      axisAHandoffSubverbRule: AXIS_A_HANDOFF_SUBVERB_RULE,
      axisBRoleNames: roleNames,
      axisBSkillTokenPattern: SKILL_TOKEN_PATTERN.source,
      axisCPattern: VERDICT_TOKEN_PATTERN.source,
      axisDPattern: HEADING_PATTERN.source,
    },
    files: fileCountsByPrefix(files),
    axisA: dedupeByKey(axisA),
    axisB: dedupeByKey(axisB),
    axisC: dedupeByKey(axisC),
    axisD,
  };
}
