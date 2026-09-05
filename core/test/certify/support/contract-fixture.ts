import path from "node:path";
import { installOpenCode } from "../../../src/install/opencode-install.ts";
import { fixtureEnvironmentFor, fixtureShimsIn, writeFixtureEngramShim } from "../../../src/install/verify-opencode.ts";
import { repositoryRoot, StateSandbox } from "../../support/state-sandbox.ts";
import type { ResolvedProbe } from "./opencode-binary.ts";

export type ContractFixture = Readonly<{
  sandbox: StateSandbox;
  environment: NodeJS.ProcessEnv;
  exitCode: number;
  report: string;
}>;

export function configHomeOf(fixture: ContractFixture): string {
  return path.join(fixture.sandbox.home, ".config", "opencode");
}

export function installContractFixture(probe: ResolvedProbe): ContractFixture {
  const sandbox = new StateSandbox("contract-bar-fixture");
  writeFixtureEngramShim(fixtureShimsIn(sandbox.root));
  const environment = fixtureEnvironmentFor(
    { ...process.env, PATH: `${path.dirname(probe.binary)}${path.delimiter}${process.env["PATH"] ?? ""}` },
    sandbox.home,
    sandbox.root,
  );
  const outcome = installOpenCode({
    homeDirectory: sandbox.home,
    repositoryRoot,
    workingDirectory: sandbox.cwd,
    environment,
    platform: process.platform,
    host: { version: probe.version },
    assumeYes: true,
    installImpeccable: false,
    installGitHook: false,
  });
  return { sandbox, environment, exitCode: outcome.exitCode, report: outcome.report };
}
