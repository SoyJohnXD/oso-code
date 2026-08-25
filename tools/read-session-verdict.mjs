#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseAgentVerdict } from "../opencode/plugin/oso/verdict.ts";

function assistantTextOf(line) {
  if (!line.startsWith("{")) {
    return undefined;
  }
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (event?.type !== "text") {
    return undefined;
  }
  const text = event.part?.text;
  return typeof text === "string" ? text : undefined;
}

function vocabularyIn(stream) {
  const spoken = new Set();
  for (const line of stream.split("\n")) {
    const text = assistantTextOf(line.trim());
    if (text === undefined) {
      continue;
    }
    const parsed = parseAgentVerdict(text);
    if (parsed.status !== undefined) {
      spoken.add(`status:${parsed.status}`);
    }
    if (parsed.verdict !== undefined) {
      spoken.add(`verdict:${parsed.verdict}`);
    }
  }
  return [...spoken].sort();
}

const [streamPath] = process.argv.slice(2);
if (streamPath === undefined) {
  console.error("usage: read-session-verdict.mjs <opencode --format json event stream>");
  process.exit(64);
}
const spoken = vocabularyIn(readFileSync(streamPath, "utf8"));
console.log(spoken.length === 0 ? "none" : spoken.join(" "));
