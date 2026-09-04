import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../../support/state-sandbox.ts";

const AGENT_DIRECTORY = path.join(repositoryRoot, "opencode", "agents");
const SKILL_DIRECTORY = path.join(repositoryRoot, "opencode", "skills");
const AGENT_FILE_PATTERN = /^oso-.+\.md$/;
const SKILL_DIRECTORY_PATTERN = /^oso-.+$/;
const MODE_LINE_PATTERN = /^mode:\s*(.*)$/;

export function contractBarSourceAgentNames(): readonly string[] {
  return readdirSync(AGENT_DIRECTORY)
    .filter((entry) => AGENT_FILE_PATTERN.test(entry))
    .map((entry) => path.basename(entry, ".md"))
    .sort();
}

export function contractBarSourceAgentMode(name: string): string {
  let content: string;
  try {
    content = readFileSync(path.join(AGENT_DIRECTORY, `${name}.md`), "utf8");
  } catch {
    return "absent";
  }
  for (const line of content.split("\n")) {
    const match = MODE_LINE_PATTERN.exec(line);
    if (match !== null) return match[1] ?? "unset";
  }
  return "unset";
}

export function contractBarSourceSkillNames(): readonly string[] {
  return readdirSync(SKILL_DIRECTORY, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SKILL_DIRECTORY_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}
