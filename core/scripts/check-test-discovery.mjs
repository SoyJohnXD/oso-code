import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";

const testDirectory = "test";
const testFileSuffix = ".test.ts";
const testGlob = `${testDirectory}/**/*${testFileSuffix}`;
const nodeTestArgs = ["--experimental-strip-types", "--test", testGlob];
const reportedTestCountPattern = /^[ℹ#] tests (\d+)$/m;
const budgetVariable = "OSO_TEST_BUDGET_SECONDS";

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

function secondsBudgetFromEnvironment() {
  const raw = process.env[budgetVariable];
  if (raw === undefined || raw.trim() === "") return undefined;
  const budget = Number(raw);
  if (!Number.isFinite(budget) || budget < 0) {
    process.stderr.write(`oso-code: ${budgetVariable}="${raw}" is not a non-negative number\n`);
    process.exit(1);
  }
  return budget;
}

const budgetSeconds = secondsBudgetFromEnvironment();
const discovered = discoveredTestFiles();
if (discovered.length === 0) {
  process.stderr.write(
    `oso-code: zero files under ${testDirectory}/ match *${testFileSuffix} — node --test would report success having run nothing\n`,
  );
  process.exit(1);
}

const startedAt = performance.now();
const { exitCode, stdout } = await runNodeTestSuite();
const elapsedSeconds = (performance.now() - startedAt) / 1000;
const ranCount = reportedTestCount(stdout);
if (ranCount < discovered.length) {
  process.stderr.write(
    `oso-code: node --test reported ${ranCount} test(s) for "${testGlob}" but ${discovered.length} file(s) sit under ${testDirectory}/ matching *${testFileSuffix} — the glob stopped matching them\n`,
  );
  process.exit(1);
}
if (budgetSeconds !== undefined) {
  process.stderr.write(
    `oso-code: node --test took ${elapsedSeconds.toFixed(1)}s against a budget of ${budgetSeconds}s (${budgetVariable})\n`,
  );
  if (elapsedSeconds > budgetSeconds) process.exit(1);
}
process.exit(exitCode);
