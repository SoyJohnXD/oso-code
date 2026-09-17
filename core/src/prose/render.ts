import { EDIT_RULES_THE_HOST_RESOLVES_BY_LAST_MATCH, mcpServerWildcard, OWNED_MCP_NAMES } from "../install/opencode-config.ts";
import {
  OPENCODE_PERMISSION_ORDER,
  type AgentRole,
  type HostName,
  type OpenCodeAgentSpec,
  type SkillHost,
  type SkillStub,
} from "./routes.ts";

export { agentHosts, AGENT_ROLES, SHARED_REFERENCE_HOSTS, SKILL_STUBS } from "./routes.ts";
export type { AgentRole, HostName, SkillHost, SkillStub } from "./routes.ts";

export function agentSharedBodyPath(role: AgentRole): string {
  return `core/src/prose/agents/${role.id}/body.md`;
}

export function agentBodyPath(role: AgentRole, host: HostName): string {
  return `core/src/prose/agents/${role.id}/${host}.md`;
}

export function skillBodyPath(stub: SkillStub, host: SkillHost): string {
  return `core/src/prose/skills/${stub.id}/${host}.md`;
}

export function agentOutputPath(role: AgentRole, host: HostName): string {
  if (host === "claude") return `plugin/agents/${role.id}.md`;
  return `opencode/agents/${role.id}.md`;
}

export function skillOutputPath(stub: SkillStub, _host: SkillHost): string {
  return `opencode/skills/oso-${stub.id}/SKILL.md`;
}

export function skillFlowPath(stub: SkillStub): string {
  return `plugin/skills/${stub.id}/SKILL.md`;
}

export function skillReferencePath(stub: SkillStub, host: SkillHost): string {
  return `core/src/prose/skills/${stub.id}/references/${host}.md`;
}

export function skillReferenceOutputPath(stub: SkillStub, _host: SkillHost): string {
  return `opencode/skills/oso-${stub.id}/references/opencode.md`;
}

export function sharedReferencePath(host: SkillHost): string {
  return `core/src/prose/shared/${host}.md`;
}

export function sharedReferenceOutputPath(host: SkillHost): string {
  return `plugin/skills/_shared/references/${host}.md`;
}

export function renderReference(body: string): string {
  return body;
}

export function renderAgent(role: AgentRole, host: HostName, sharedBody: string, delta: string | null): string {
  const body = delta === null ? sharedBody : `${sharedBody}\n${delta}`;
  if (host === "claude") return renderClaudeAgent(role, body);
  return renderOpenCodeAgent(role, body);
}

export function renderSkill(stub: SkillStub, _host: SkillHost, body: string, flow: string): string {
  const name = `oso-${stub.id}`;
  const lines = [`name: ${name}`, `description: "${stub.description.opencode}"`];
  if (stub.argumentHint !== null) lines.push(`argument-hint: "${stub.argumentHint.opencode}"`);
  if (stub.disableModelInvocation) lines.push("disable-model-invocation: true");
  return `${frontMatterBlock(lines)}\n\n${body}\n\n${flowBody(flow)}`;
}

export function flowBody(flowSkillFile: string): string {
  const lines = flowSkillFile.split("\n");
  const closingDelimiter = lines.indexOf("---", 1);
  return lines
    .slice(closingDelimiter + 1)
    .join("\n")
    .replace(/^\n+/, "");
}

function renderClaudeAgent(role: AgentRole, body: string): string {
  const spec = role.claude;
  if (spec === null) throw new Error(`${role.id} names no claude spec`);
  const lines = [`name: ${role.id}`, `description: ${spec.description}`, `model: ${spec.model}`, `tools: ${spec.tools.join(", ")}`];
  return `${frontMatterBlock(lines)}\n\n${body}`;
}

function renderOpenCodeAgent(role: AgentRole, body: string): string {
  const spec = role.opencode;
  const denies = OPENCODE_PERMISSION_ORDER.filter((key) => spec.denies.includes(key));
  const closedServers = OWNED_MCP_NAMES.filter((server) => !spec.mcpServersTheClaudeTwinLists.includes(server)).map(mcpServerWildcard);
  const lines = [
    `description: "${spec.description}"`,
    "mode: subagent",
    "hidden: true",
    "permission:",
    ...[...denies, ...closedServers].map((key) => `  ${key}: deny`),
    ...boundedEditLines(spec),
  ];
  return `${frontMatterBlock(lines)}\n\n${body}`;
}

function boundedEditLines(spec: OpenCodeAgentSpec): readonly string[] {
  if (spec.denies.includes("edit")) return [];
  return ["  edit:", ...EDIT_RULES_THE_HOST_RESOLVES_BY_LAST_MATCH.map((rule) => `    "${rule.pattern}": ${rule.verdict}`)];
}

function frontMatterBlock(lines: readonly string[]): string {
  return ["---", ...lines, "---"].join("\n");
}
