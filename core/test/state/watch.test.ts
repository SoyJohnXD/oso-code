import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  REPOSITORY_RUNS_DIR,
  repositoryRoot,
  STATE_FILE,
  StateSandbox,
  withStateSandbox,
  type SeededEntry,
  type StateSubject,
  type SubjectRun,
} from "../support/state-sandbox.ts";

const CLI_SOURCE = path.join(repositoryRoot, "core", "src", "bin", "oso-state.ts");
const CLI_SUBJECT: StateSubject = {
  name: "core/src/bin/oso-state.ts",
  command: [process.execPath, "--experimental-strip-types", CLI_SOURCE],
};

const SESSION = "sess-watch";
const SESSION_RUN = `${REPOSITORY_RUNS_DIR}/${SESSION}`;
const REGISTRY = `${SESSION_RUN}/in-flight`;
const PID_FILE = `${SESSION_RUN}/watch.pid`;
const WATCH = ["--session", SESSION, "watch"];
const FAST_POLL = { OSO_WATCH_POLL_MS: "50" };
const FLAGGED_EXIT = 3;
const MINUTE_MS = 60_000;
const PID_FILE_DEADLINE_MS = 10_000;
const POLLS_TO_OBSERVE_MS = 400;
const UNREADABLE_DEADLINE_MS = 5_000;

type Entry = Readonly<{
  agentId: string;
  agentType?: string;
  startedMinutesAgo?: number;
  marks?: readonly string[];
}>;

function registered({ agentId, agentType = "oso-code:applier", startedMinutesAgo = 5, marks = [] }: Entry): string {
  const startedAt = new Date(Date.now() - startedMinutesAgo * MINUTE_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
  const markLines = marks.map((mark) => `${mark}\n`).join("");
  return (
    `agent_id=${agentId}\nagent_type=${agentType}\ntranscript={home}/transcripts/agent-${agentId}.jsonl\n` +
    `started_at=${startedAt}\n${markLines}`
  );
}

function seededAgent(entry: Entry, transcriptSilentMinutes: number | undefined): Record<string, SeededEntry> {
  const transcript: Record<string, SeededEntry> =
    transcriptSilentMinutes === undefined
      ? {}
      : {
          [`transcripts/agent-${entry.agentId}.jsonl`]: {
            kind: "file",
            content: "{}\n",
            agedSeconds: (transcriptSilentMinutes * MINUTE_MS) / 1000,
          },
        };
  return { [`${REGISTRY}/${entry.agentId}`]: registered(entry), ...transcript };
}

function watchOnce(sandbox: StateSandbox, env: Readonly<Record<string, string>> = FAST_POLL): SubjectRun {
  return sandbox.run(CLI_SUBJECT, WATCH, { env });
}

type RunningWatch = Readonly<{ pid: number; ended: Promise<SubjectRun> }>;

function startWatch(sandbox: StateSandbox): RunningWatch {
  const [command, ...leading] = CLI_SUBJECT.command;
  const child = spawn(command as string, [...leading, ...WATCH], {
    cwd: sandbox.cwd,
    env: { HOME: sandbox.home, USERPROFILE: sandbox.home, PATH: process.env["PATH"] ?? "", ...FAST_POLL },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const ended = new Promise<SubjectRun>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (exit) => resolve({ exit: exit ?? -1, stdout, stderr }));
  });
  return { pid: child.pid ?? -1, ended };
}

async function pidFileOnceWritten(sandbox: StateSandbox): Promise<string> {
  const deadline = Date.now() + PID_FILE_DEADLINE_MS;
  while (Date.now() < deadline) {
    const pidFile = sandbox.read(PID_FILE);
    if (pidFile.kind === "file" && pidFile.content !== "") return pidFile.content;
    await delay(20);
  }
  throw new Error(`the watch never wrote ${PID_FILE}`);
}

function removeRegistryEntry(sandbox: StateSandbox, agentId: string): void {
  rmSync(path.join(sandbox.home, sandbox.expand(`${REGISTRY}/${agentId}`)));
}

async function withRunningSandbox(use: (sandbox: StateSandbox) => Promise<void>): Promise<void> {
  const sandbox = new StateSandbox("workspace");
  try {
    await use(sandbox);
  } finally {
    sandbox.dispose();
  }
}

async function endedWithin(watch: RunningWatch, deadlineMs: number): Promise<SubjectRun> {
  const outcome = await Promise.race([watch.ended, delay(deadlineMs, undefined, { ref: false })]);
  if (outcome !== undefined) return outcome;
  process.kill(watch.pid);
  await watch.ended;
  throw new Error(`the watch still polled ${deadlineMs} ms after it started`);
}

function contentOf(sandbox: StateSandbox, relativePath: string): string {
  const entry = sandbox.read(relativePath);
  return entry.kind === "file" ? entry.content : "";
}

describe("oso-state watch ends when every delegation of this session has ended", () => {
  test("an empty registry ends the watch at once with exit 0 and the one line, and leaves no pid file", () => {
    withStateSandbox("workspace", (sandbox) => {
      const run = watchOnce(sandbox);
      assert.equal(run.exit, 0, run.stderr);
      assert.equal(run.stdout, "all delegations ended\n");
      assert.equal(run.stderr, "");
      assert.equal(sandbox.read(PID_FILE).kind, "absent");
    });
  });

  test("a watch in a repository with no state creates none", () => {
    withStateSandbox("workspace", (sandbox) => {
      const run = watchOnce(sandbox);
      assert.equal(run.exit, 0, run.stderr);
      assert.equal(sandbox.read(STATE_FILE).kind, "absent");
    });
  });

  test("a watch leaves an existing state exactly as it found it", () => {
    withStateSandbox("workspace", (sandbox) => {
      const state = "mode=plan\nsession=other-session\n";
      sandbox.seed({ [STATE_FILE]: state });
      const run = watchOnce(sandbox);
      assert.equal(run.exit, 0, run.stderr);
      assert.equal(contentOf(sandbox, STATE_FILE), state);
    });
  });

  test("an alive entry keeps it polling, with its pid file written, until the entry leaves the registry", async () => {
    await withRunningSandbox(async (sandbox) => {
      sandbox.seed(seededAgent({ agentId: "a1" }, 0));
      const watch = startWatch(sandbox);
      assert.match(await pidFileOnceWritten(sandbox), new RegExp(`^watch=${watch.pid}:\\d+\\n$`));
      await delay(POLLS_TO_OBSERVE_MS);
      assert.equal(sandbox.read(PID_FILE).kind, "file");
      removeRegistryEntry(sandbox, "a1");
      const run = await watch.ended;
      assert.equal(run.exit, 0, run.stderr);
      assert.equal(run.stdout, "all delegations ended\n");
      assert.equal(sandbox.read(PID_FILE).kind, "absent");
    });
  });
});

describe("oso-state watch exits 3 naming a delegation that needs attention, once per id", () => {
  test("an entry whose transcript is silent past 60 minutes exits 3 naming its id, type and silence", () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed(seededAgent({ agentId: "a1", agentType: "oso-code:verifier", startedMinutesAgo: 130 }, 75));
      const run = watchOnce(sandbox);
      assert.equal(run.exit, FLAGGED_EXIT, run.stderr);
      assert.equal(run.stdout, "stuck: a1 (oso-code:verifier) silent 75 min\n");
      assert.equal(sandbox.read(PID_FILE).kind, "absent");
    });
  });

  test("an entry with no transcript counts its silence from its started_at", () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed(seededAgent({ agentId: "a2", startedMinutesAgo: 90 }, undefined));
      const run = watchOnce(sandbox);
      assert.equal(run.exit, FLAGGED_EXIT, run.stderr);
      assert.equal(run.stdout, "stuck: a2 (oso-code:applier) silent 90 min\n");
    });
  });

  test("an entry in flight past 3 hours with a live transcript exits 3 naming its id, type and duration", () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed(seededAgent({ agentId: "a3", startedMinutesAgo: 200 }, 1));
      const run = watchOnce(sandbox);
      assert.equal(run.exit, FLAGGED_EXIT, run.stderr);
      assert.equal(run.stdout, "long-running: a3 (oso-code:applier) in flight 200 min\n");
    });
  });

  test("an entry flagged ended-without-notice exits 3 naming it and leaves the registry", () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed(seededAgent({ agentId: "a4", marks: ["ended_without_notice=true"] }, 0));
      const run = watchOnce(sandbox);
      assert.equal(run.exit, FLAGGED_EXIT, run.stderr);
      assert.equal(run.stdout, "ended-without-notice: a4 (oso-code:applier)\n");
      assert.equal(sandbox.read(`${REGISTRY}/a4`).kind, "absent");
      const next = watchOnce(sandbox);
      assert.equal(next.exit, 0, next.stderr);
      assert.equal(next.stdout, "all delegations ended\n");
    });
  });

  test("every flagged entry of one poll is named on its own line", () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({
        ...seededAgent({ agentId: "a1", startedMinutesAgo: 70 }, 65),
        ...seededAgent({ agentId: "a2", startedMinutesAgo: 190 }, 2),
        ...seededAgent({ agentId: "a3" }, 0),
      });
      const run = watchOnce(sandbox);
      assert.equal(run.exit, FLAGGED_EXIT, run.stderr);
      assert.equal(
        run.stdout,
        "stuck: a1 (oso-code:applier) silent 65 min\nlong-running: a2 (oso-code:applier) in flight 190 min\n",
      );
    });
  });

  test("the silence and long-running thresholds are read from their test-only env overrides", () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({
        ...seededAgent({ agentId: "a1", startedMinutesAgo: 10 }, 3),
        ...seededAgent({ agentId: "a2", startedMinutesAgo: 6 }, 0),
      });
      const run = watchOnce(sandbox, {
        ...FAST_POLL,
        OSO_WATCH_SILENCE_MS: String(2 * MINUTE_MS),
        OSO_WATCH_LONG_MS: String(5 * MINUTE_MS),
      });
      assert.equal(run.exit, FLAGGED_EXIT, run.stderr);
      assert.equal(
        run.stdout,
        "stuck: a1 (oso-code:applier) silent 3 min\nlong-running: a2 (oso-code:applier) in flight 6 min\n",
      );
    });
  });

  test("a reported entry is marked, and the next watch keeps polling on it instead of exiting 3 again", async () => {
    await withRunningSandbox(async (sandbox) => {
      sandbox.seed(seededAgent({ agentId: "a1", startedMinutesAgo: 80 }, 70));
      const first = watchOnce(sandbox);
      assert.equal(first.exit, FLAGGED_EXIT, first.stderr);
      assert.match(contentOf(sandbox, `${REGISTRY}/a1`), /^reported=true$/m);

      const second = startWatch(sandbox);
      await pidFileOnceWritten(sandbox);
      await delay(POLLS_TO_OBSERVE_MS);
      assert.ok(existsSync(path.join(sandbox.home, sandbox.expand(PID_FILE))), "the second watch exited early");
      removeRegistryEntry(sandbox, "a1");
      const run = await second.ended;
      assert.equal(run.exit, 0, run.stderr);
      assert.equal(run.stdout, "all delegations ended\n");
    });
  });

  const UNREADABLE_ENTRIES: readonly Readonly<{ why: string; entry: SeededEntry }>[] = [
    { why: "an entry that is no regular file", entry: { kind: "directory" } },
    { why: "an entry holding no started_at timestamp", entry: "agent_id=a5\nagent_type=oso-code:applier\n" },
  ];

  for (const { why, entry } of UNREADABLE_ENTRIES) {
    test(`${why} exits 3 naming it unreadable once and leaves the registry, rather than holding the watch open`, async () => {
      await withRunningSandbox(async (sandbox) => {
        sandbox.seed({ [`${REGISTRY}/a5`]: entry });
        const run = await endedWithin(startWatch(sandbox), UNREADABLE_DEADLINE_MS);
        assert.equal(run.exit, FLAGGED_EXIT, run.stderr);
        assert.equal(run.stdout, "unreadable: a5\n");
        assert.equal(sandbox.read(`${REGISTRY}/a5`).kind, "absent");
        const next = watchOnce(sandbox);
        assert.equal(next.exit, 0, next.stderr);
        assert.equal(next.stdout, "all delegations ended\n");
      });
    });
  }

  test("an already-reported entry that turns long-running is not reported again", () => {
    withStateSandbox("workspace", (sandbox) => {
      sandbox.seed({
        ...seededAgent({ agentId: "a1", startedMinutesAgo: 200, marks: ["reported=true"] }, 90),
        ...seededAgent({ agentId: "a2", startedMinutesAgo: 70 }, 61),
      });
      const run = watchOnce(sandbox);
      assert.equal(run.exit, FLAGGED_EXIT, run.stderr);
      assert.equal(run.stdout, "stuck: a2 (oso-code:applier) silent 61 min\n");
    });
  });
});

describe("oso-state watch takes no arguments", () => {
  test("a trailing argument is a usage error and starts no watch", () => {
    withStateSandbox("workspace", (sandbox) => {
      const run = sandbox.run(CLI_SUBJECT, [...WATCH, "extra"]);
      assert.equal(run.exit, 1);
      assert.match(run.stderr, /^usage: oso-state/);
      assert.equal(sandbox.read(PID_FILE).kind, "absent");
      assert.equal(sandbox.read(STATE_FILE).kind, "absent");
    });
  });
});
