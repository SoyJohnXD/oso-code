import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

const SCRIPT_PATTERN = /SCRIPT (\S+) (\{.*\})/g;
const CHAT_COMPLETIONS_PATH = "/chat/completions";
const FINAL_REPLY = "finished";

type ChatMessage = Readonly<{ role: string; content?: unknown }>;
type ChatRequestBody = Readonly<{ messages: readonly ChatMessage[]; tools?: readonly Readonly<{ function: Readonly<{ name: string }> }>[] }>;

export type ScriptedProviderRequest = Readonly<{ messages: readonly ChatMessage[]; offeredTools: readonly string[] }>;

export type ScriptedProvider = Readonly<{
  baseURL: string;
  drainRequests: () => readonly ScriptedProviderRequest[];
  stop: () => Promise<void>;
}>;

export type ScriptedCall = Readonly<{ toolName: string; input: Readonly<Record<string, unknown>> }>;

export function scriptedPrompt(toolName: string, input: Readonly<Record<string, unknown>>): string {
  return `SCRIPT ${toolName} ${JSON.stringify(input)}`;
}

function textOf(message: ChatMessage | undefined): string {
  if (message === undefined) return "";
  return typeof message.content === "string" ? message.content : JSON.stringify(message.content);
}

function streamChunk(delta: Readonly<Record<string, unknown>>, finishReason: string | null): string {
  const chunk = { id: "scripted", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finishReason }] };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function scriptedToolCall(request: ChatRequestBody): Readonly<{ id: string; name: string; input: string }> | undefined {
  const lastUser = request.messages.map((message) => message.role).lastIndexOf("user");
  const answered = request.messages.slice(lastUser + 1).filter((message) => message.role === "tool").length;
  const scripted = [...textOf(request.messages[lastUser]).matchAll(SCRIPT_PATTERN)][answered];
  const name = scripted?.[1];
  const input = scripted?.[2];
  if (name === undefined || input === undefined) return undefined;
  const offered = request.tools?.some((tool) => tool.function.name === name) ?? false;
  return offered ? { id: `call_${answered + 1}`, name, input } : undefined;
}

function respond(response: ServerResponse, request: ChatRequestBody): void {
  response.writeHead(200, { "content-type": "text/event-stream" });
  const call = scriptedToolCall(request);
  if (call === undefined) {
    response.write(streamChunk({ role: "assistant", content: FINAL_REPLY }, null));
    response.write(streamChunk({}, "stop"));
  } else {
    const toolCall = { index: 0, id: call.id, type: "function", function: { name: call.name, arguments: call.input } };
    response.write(streamChunk({ role: "assistant", tool_calls: [toolCall] }, null));
    response.write(streamChunk({}, "tool_calls"));
  }
  response.write("data: [DONE]\n\n");
  response.end();
}

function bodyOf(incoming: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    incoming.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    incoming.on("end", () => resolve(body));
    incoming.on("error", reject);
  });
}

function listening(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

export async function startScriptedProvider(): Promise<ScriptedProvider> {
  let requests: ScriptedProviderRequest[] = [];
  const server = createServer(async (incoming, response) => {
    if (!incoming.url?.endsWith(CHAT_COMPLETIONS_PATH)) {
      response.writeHead(404).end();
      return;
    }
    const request = JSON.parse(await bodyOf(incoming)) as ChatRequestBody;
    requests.push({ messages: request.messages, offeredTools: request.tools?.map((tool) => tool.function.name) ?? [] });
    respond(response, request);
  });
  const port = await listening(server);
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    drainRequests: () => {
      const drained = requests;
      requests = [];
      return drained;
    },
    stop: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
