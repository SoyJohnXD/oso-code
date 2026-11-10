import { appendFileSync } from "node:fs";

const NOTES_PATH = process.env.OSO_SPIKE_NOTES;
const VETOED_TEXT = "veto";
const MUTATED_TEXT = "mutate";
const ASSERTED_TEXT = "assert";
const DENIED_MARKER = "DENYME";
const TEXT_INPUT = { type: "object", properties: { text: { type: "string" } }, required: ["text"] };
const NO_INPUT = { type: "object", properties: {}, required: [] };
const INTERRUPT_LINGER_MILLISECONDS = 500;

function note(kind, data = {}) {
  if (NOTES_PATH === undefined) return;
  appendFileSync(NOTES_PATH, `${JSON.stringify({ kind, ...data })}\n`);
}

function echoTool(ctx) {
  return {
    name: "spike_echo",
    description: "Echoes the given text back",
    input: TEXT_INPUT,
    options: { codemode: false },
    async execute(input, toolContext) {
      const session = await ctx.session.get({ sessionID: toolContext.sessionID });
      note("tool.execute", {
        input,
        sessionID: toolContext.sessionID,
        agent: toolContext.agent,
        toolContextKeys: Object.keys(toolContext),
        session,
      });
      if (input.text === ASSERTED_TEXT) {
        await ctx.permission.assert({ sessionID: toolContext.sessionID, action: "spike_assert", resources: ["asserted-resource"] });
        note("assert.resolved");
      }
      return { content: `echo:${input.text}` };
    },
  };
}

function hiddenTool() {
  return {
    name: "spike_hidden",
    description: "Registered without options.codemode false",
    input: NO_INPUT,
    async execute() {
      return { content: "hidden" };
    },
  };
}

function interruptTool(ctx) {
  return {
    name: "spike_interrupt",
    description: "Interrupts its own session",
    input: NO_INPUT,
    options: { codemode: false },
    async execute(_input, toolContext) {
      const result = await ctx.session.interrupt({ sessionID: toolContext.sessionID });
      note("interrupt.result", { result, signalAborted: toolContext.signal.aborted });
      await new Promise((resolve) => setTimeout(resolve, INTERRUPT_LINGER_MILLISECONDS));
      return { content: "interrupt-returned" };
    },
  };
}

function compactTool(ctx) {
  return {
    name: "spike_compact",
    description: "Requests a compaction of its own session",
    input: NO_INPUT,
    options: { codemode: false },
    async execute(_input, toolContext) {
      const queued = await ctx.session.compact({ sessionID: toolContext.sessionID });
      note("compact.queued", { queued });
      return { content: "compact-requested" };
    },
  };
}

function vetoOrMutate(call) {
  note("execute.before", { tool: call.tool, keys: Object.keys(call), input: call.input });
  if (call.input?.text === VETOED_TEXT) throw new Error("VETO-REASON");
  if (call.input?.text === MUTATED_TEXT) call.input = { text: "mutated" };
}

function recordAfter(call) {
  note("execute.after", {
    tool: call.tool,
    sessionID: call.sessionID,
    status: call.status,
    keys: Object.keys(call),
    input: call.input,
    result: call.result,
    error: call.error,
  });
}

function denyMarked(evaluation) {
  note("permission.evaluate", {
    sessionID: evaluation.sessionID,
    action: evaluation.action,
    resources: evaluation.resources,
    effect: evaluation.effect,
  });
  if (!JSON.stringify(evaluation.resources).includes(DENIED_MARKER)) return;
  evaluation.effect = "deny";
  evaluation.message = "DENY-REASON";
}

function addEnvironment(creation) {
  note("shell.create.before", { keys: Object.keys(creation), command: creation.command, cwd: creation.cwd });
  creation.env.SPIKE_ENV = "from-hook";
}

async function recordEvents(ctx) {
  for await (const event of ctx.event.subscribe()) note("event", { type: event.type, data: event.data });
}

export default {
  id: "oso-spike",
  async setup(ctx) {
    note("setup", { directory: ctx.location.directory, sessionMethods: Object.keys(ctx.session) });
    await ctx.tool.transform((editor) => {
      editor.add(echoTool(ctx));
      editor.add(hiddenTool());
      editor.add(interruptTool(ctx));
      editor.add(compactTool(ctx));
    });
    await ctx.tool.hook("execute.before", vetoOrMutate);
    await ctx.tool.hook("execute.after", recordAfter);
    await ctx.permission.hook("evaluate", denyMarked);
    await ctx.session.hook("experimental.idle", (idle) => note("idle", { sessionID: idle.sessionID, background: idle.background }));
    await ctx.session.hook("context", (request) => note("context", { sessionID: request.sessionID, agent: request.agent, keys: Object.keys(request), system: request.system }));
    await ctx.session.hook("compaction", (request) => note("compaction", { sessionID: request.sessionID, keys: Object.keys(request), system: request.system }));
    await ctx.shell.hook("create.before", addEnvironment);
    recordEvents(ctx).catch((error) => note("event.error", { message: String(error) }));
    return () => note("cleanup");
  },
};
