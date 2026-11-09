import { createInterface } from "node:readline";

const PROTOCOL_VERSION = "2025-06-18";
const TOOLS = ["ping", "look-up"].map((name) => ({
  name,
  description: "Answers pong",
  inputSchema: { type: "object", properties: {}, required: [] },
}));

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function resultFor(request) {
  if (request.method === "initialize") {
    return { protocolVersion: request.params?.protocolVersion ?? PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: "stub", version: "1" } };
  }
  if (request.method === "tools/list") return { tools: TOOLS };
  if (request.method === "tools/call") return { content: [{ type: "text", text: "pong" }] };
  return {};
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id !== undefined) reply(request.id, resultFor(request));
});
