import { OPENCODE_PERMISSION_ORDER, type AgentRole, type HostName, type SkillHost, type SkillStub } from "./routes.ts";

export { agentHosts, AGENT_ROLES, SHARED_REFERENCE_HOSTS, SKILL_STUBS } from "./routes.ts";
export type { AgentRole, HostName, SkillHost, SkillStub } from "./routes.ts";

export function agentBodyPath(role: AgentRole, host: HostName): string {
  return `core/src/prose/agents/${role.id}/${host}.md`;
}

export function skillBodyPath(stub: SkillStub, host: SkillHost): string {
  return `core/src/prose/skills/${stub.id}/${host}.md`;
}

export function agentOutputPath(role: AgentRole, host: HostName): string {
  if (host === "claude") return `plugin/agents/${role.id}.md`;
  if (host === "codex") return `codex/agents/${role.id}.toml`;
  return `opencode/agents/${role.id}.md`;
}

export function skillOutputPath(stub: SkillStub, host: SkillHost): string {
  return host === "codex" ? `codex/skills/${stub.id}/SKILL.md` : `opencode/skills/oso-${stub.id}/SKILL.md`;
}

export function skillReferencePath(stub: SkillStub, host: SkillHost): string {
  return `core/src/prose/skills/${stub.id}/references/${host}.md`;
}

export function skillReferenceOutputPath(stub: SkillStub, host: SkillHost): string {
  return host === "codex" ? `codex/skills/${stub.id}/references/codex.md` : `opencode/skills/oso-${stub.id}/references/opencode.md`;
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

export function renderAgent(role: AgentRole, host: HostName, body: string): string {
  if (host === "claude") return renderClaudeAgent(role, body);
  if (host === "codex") return renderCodexAgent(role, body);
  return renderOpenCodeAgent(role, body);
}

export function renderSkill(stub: SkillStub, host: SkillHost, body: string): string {
  const name = host === "codex" ? stub.id : `oso-${stub.id}`;
  const lines = [`name: ${name}`, `description: "${stub.description[host]}"`];
  if (stub.argumentHint !== null) lines.push(`argument-hint: "${stub.argumentHint[host]}"`);
  if (stub.disableModelInvocation) lines.push("disable-model-invocation: true");
  return `${frontMatterBlock(lines)}\n\n${body}`;
}

function renderClaudeAgent(role: AgentRole, body: string): string {
  const spec = role.claude;
  if (spec === null) throw new Error(`${role.id} names no claude spec`);
  const lines = [`name: ${role.id}`, `description: ${spec.description}`, `model: ${spec.model}`, `tools: ${spec.tools.join(", ")}`];
  return `${frontMatterBlock(lines)}\n\n${body}`;
}

function renderCodexAgent(role: AgentRole, body: string): string {
  const spec = role.codex;
  const lines = [
    `name = "${role.id}"`,
    `description = "${spec.description}"`,
    `model = "${spec.model}"`,
    `model_reasoning_effort = "${spec.reasoningEffort}"`,
    `sandbox_mode = "${spec.sandboxMode}"`,
    `developer_instructions = """`,
  ].join("\n");
  return `${lines}\n${body}"""\n`;
}

function renderOpenCodeAgent(role: AgentRole, body: string): string {
  const spec = role.opencode;
  const denies = OPENCODE_PERMISSION_ORDER.filter((key) => spec.denies.includes(key));
  const lines = [`description: "${spec.description}"`, "mode: subagent", "hidden: true", "permission:", ...denies.map((key) => `  ${key}: deny`)];
  return `${frontMatterBlock(lines)}\n\n${body}`;
}

function frontMatterBlock(lines: readonly string[]): string {
  return ["---", ...lines, "---"].join("\n");
}
