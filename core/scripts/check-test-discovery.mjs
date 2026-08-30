import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";

const testDirectory = "test";
const testFileSuffix = ".test.ts";
const testGlob = `${testDirectory}/**/*${testFileSuffix}`;
const nodeTestArgs = ["--experimental-strip-types", "--test", testGlob];
const reportedTestCountPattern = /^[ℹ#] tests (\d+)$/m;

function discoveredTestFiles() {
  return readdirSync(testDirectory, { recursive: true }).filter((entry) => entry.endsWith(testFileSuffix));
}

function runNodeTestSuite() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, nodeTestArgs, { stdio: ["inherit", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.on("close", (exitCode) => resolve({ exitCode: exitCode ?? 1, stdout }));
  });
}

function reportedTestCount(stdout) {
  const match = stdout.match(reportedTestCountPattern);
  return match ? Number(match[1]) : 0;
}

const discovered = discoveredTestFiles();
if (discovered.length === 0) {
  process.stderr.write(
    `oso-code: zero files under ${testDirectory}/ match *${testFileSuffix} — node --test would report success having run nothing\n`,
  );
  process.exit(1);
}

const { exitCode, stdout } = await runNodeTestSuite();
const ranCount = reportedTestCount(stdout);
if (ranCount < discovered.length) {
  process.stderr.write(
    `oso-code: node --test reported ${ranCount} test(s) for "${testGlob}" but ${discovered.length} file(s) sit under ${testDirectory}/ matching *${testFileSuffix} — the glob stopped matching them\n`,
  );
  process.exit(1);
}
process.exit(exitCode);
