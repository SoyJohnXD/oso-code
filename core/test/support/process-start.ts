import { processStartOf } from "../../src/state/watch.ts";

export function ownProcessStartTime(): number {
  const start = processStartOf(process.pid);
  if (start === undefined) throw new Error(`/proc holds no start time for this process, ${process.pid}`);
  return Number(start);
}

export function ownWatchdogRecord(): string {
  return `watch=${process.pid}:${ownProcessStartTime()}\n`;
}
