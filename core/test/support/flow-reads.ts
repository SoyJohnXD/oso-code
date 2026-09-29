import path from "node:path";

export const SKILLS_DIRECTORY = "plugin/skills";

const BACKTICKED_MARKDOWN_PATH = /`([^`]*\/[^`]*\.md)`/g;

const flowDirectoryOf = (flow: string) => `${SKILLS_DIRECTORY}/${flow}`;
export const wrapperOf = (flow: string) => `${flowDirectoryOf(flow)}/SKILL.md`;
export const hostFileOf = (flow: string) => `${flowDirectoryOf(flow)}/references/claude.md`;

function resolveNamedPath(flow: string, raw: string): string {
  const spelled = raw.replaceAll("<host>", "claude").replaceAll("${CLAUDE_SKILL_DIR}", flowDirectoryOf(flow));
  if (spelled.startsWith("plugin/")) return path.posix.normalize(spelled);
  if (spelled.startsWith("references/")) return path.posix.join(flowDirectoryOf(flow), spelled);
  return path.posix.join(SKILLS_DIRECTORY, spelled);
}

export function namedPaths(flow: string, text: string): string[] {
  return [...text.matchAll(BACKTICKED_MARKDOWN_PATH)].map(([, raw]) => resolveNamedPath(flow, raw ?? ""));
}

export function markedAlwaysIn(flow: string, text: string, marksAlways: (line: string) => boolean): string[] {
  return text
    .split("\n")
    .filter(marksAlways)
    .flatMap((line) => namedPaths(flow, line));
}
