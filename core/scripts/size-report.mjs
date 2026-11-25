import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const AREAS = ["core/src", "core/test", "core/test/fixtures", "plugin", "opencode", "bootstrap", "docs", "tools"];
const BINARY_SNIFF_BYTES = 8192;
const NEWLINE = 0x0a;

function gitLines(args) {
  const listing = spawnSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (listing.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${listing.stderr}`);
  return listing.stdout.split("\n").filter((line) => line !== "");
}

function trackedFiles() {
  const deleted = new Set(gitLines(["ls-files", "--deleted"]));
  return gitLines(["ls-files", "--cached", "--others", "--exclude-standard"]).filter((file) => !deleted.has(file));
}

function measure(file) {
  const content = readFileSync(file);
  const isBinary = content.subarray(0, BINARY_SNIFF_BYTES).includes(0);
  const lines = isBinary ? 0 : content.reduce((count, byte) => count + (byte === NEWLINE ? 1 : 0), 0);
  return { lines, bytes: content.length };
}

function totalsOf(measured) {
  return measured.reduce(
    (total, { lines, bytes }) => ({ files: total.files + 1, lines: total.lines + lines, bytes: total.bytes + bytes }),
    { files: 0, lines: 0, bytes: 0 },
  );
}

function row(label, { files, lines, bytes }) {
  return [label.padEnd(20), String(files).padStart(7), String(lines).padStart(9), String(bytes).padStart(11)].join(" ");
}

const measuredByFile = new Map(trackedFiles().map((file) => [file, measure(file)]));
const rows = AREAS.map((area) => {
  const inside = [...measuredByFile].filter(([file]) => file.startsWith(`${area}/`)).map(([, measured]) => measured);
  return row(area, totalsOf(inside));
});

const header = ["area".padEnd(20), "files".padStart(7), "lines".padStart(9), "bytes".padStart(11)].join(" ");
process.stdout.write(`${[header, ...rows, row("total", totalsOf([...measuredByFile.values()]))].join("\n")}\n`);
