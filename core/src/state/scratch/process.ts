import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { isErrnoException } from "../store.ts";

export type ProcessIdentity = Readonly<{ pid: number; start: string; boot: string; group: number; session: number }>;

export function requireScratchRuntime(): void {
  if (process.platform !== "linux" || process.getuid === undefined) {
    throw new Error("scratch requires Linux process/proc/path capabilities; use the no-export route");
  }
  const identity = processIdentity(process.pid);
  if (identity === undefined || realpathSync("/proc/self") !== `/proc/${process.pid}`) {
    throw new Error("scratch process identity capability unavailable");
  }
  sessionMembers(identity);
}

export function processIdentity(pid: number): ProcessIdentity | undefined {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("scratch invalid process identity PID");
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch (error) {
    if (isErrnoException(error) && (error.code === "ENOENT" || error.code === "ESRCH")) return undefined;
    throw error;
  }
  const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
  if (fields[0] === "Z" || fields[0] === "X") return undefined;
  const group = Number(fields[2]);
  const session = Number(fields[3]);
  const start = fields[19];
  if (!Number.isSafeInteger(group) || !Number.isSafeInteger(session) || start === undefined || !/^\d+$/.test(start)) {
    throw new Error(`scratch cannot establish process identity for ${pid}`);
  }
  return { pid, start, group, session, boot: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() };
}

export function identityIsLive(identity: ProcessIdentity): boolean {
  if (identity === null || typeof identity !== "object" || !/^\d+$/.test(identity.start) || typeof identity.boot !== "string" ||
      !Number.isSafeInteger(identity.group) || identity.group < 1 || !Number.isSafeInteger(identity.session) || identity.session < 1) {
    throw new Error("scratch invalid recorded process identity");
  }
  const current = processIdentity(identity.pid);
  if (current === undefined) return false;
  if (current.boot !== identity.boot || current.start !== identity.start) {
    throw new Error(`scratch process identity changed for ${identity.pid}; recovery is uncertain`);
  }
  if (current.group !== identity.group || current.session !== identity.session) {
    throw new Error(`scratch process escaped its reviewed group/session: ${identity.pid}`);
  }
  return true;
}

export function sessionMembers(identity: ProcessIdentity): ProcessIdentity[] {
  const members: ProcessIdentity[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const current = processIdentity(Number(entry));
    if (current !== undefined && (current.group === identity.group || current.session === identity.session)) {
      if (current.boot !== identity.boot) throw new Error("scratch boot identity changed; recovery is uncertain");
      members.push(current);
    }
  }
  return members;
}

export function assertQuiescent(identity: ProcessIdentity): void {
  identityIsLive(identity);
  if (sessionMembers(identity).length !== 0) throw new Error("scratch owned group/session remains active; cleanup refused");
}

export async function waitForQuiescence(identity: ProcessIdentity, tracked: readonly ProcessIdentity[]): Promise<void> {
  const deadline = Date.now() + 1000;
  while (true) {
    const live = tracked.filter(identityIsLive);
    if (sessionMembers(identity).length === 0 && live.length === 0) return;
    if (Date.now() >= deadline) throw new Error("scratch tracked processes/group/session remain active; cleanup refused");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function signalOwnedGroup(identity: ProcessIdentity, signal: NodeJS.Signals): void {
  identityIsLive(identity);
  const members = sessionMembers(identity);
  if (members.length === 0) return;
  if (members.some((member) => member.group !== identity.group || member.session !== identity.session)) {
    throw new Error("scratch recipe changed group/session; termination is uncertain");
  }
  try {
    process.kill(-identity.group, signal);
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ESRCH") throw error;
    assertQuiescent(identity);
  }
}
