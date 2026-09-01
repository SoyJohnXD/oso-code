import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { firstExecutableOnPath } from "../../../src/install/verify-claude.ts";
import { isErrnoException } from "../../../src/state/store.ts";

export const DEPLOY_CLI_NAME = "vercel";
export const DEPLOY_PRODUCTION_FLAG = "--prod";

const DEPLOY_CLI_MARKER_NAME = "deploy-cli-ran";
const DEPLOY_SHIM_MODE = 0o700;

export function deployCliMarkerIn(root: string): string {
  return path.join(root, DEPLOY_CLI_MARKER_NAME);
}

export function installDeployCliShim(shimsDirectory: string, markerFile: string): void {
  const shim = path.join(shimsDirectory, DEPLOY_CLI_NAME);
  writeFileSync(shim, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${markerFile}\n`);
  chmodSync(shim, DEPLOY_SHIM_MODE);
}

export type DeployCliShadow =
  | Readonly<{ kind: "shadowed" }>
  | Readonly<{ kind: "not-shadowed"; reason: string }>;

export function deployCliShadowedByFixture(environment: NodeJS.ProcessEnv, shimsDirectory: string): DeployCliShadow {
  const expected = path.join(shimsDirectory, DEPLOY_CLI_NAME);
  const resolved = firstExecutableOnPath(environment, DEPLOY_CLI_NAME);
  if (resolved === expected) return { kind: "shadowed" };
  return {
    kind: "not-shadowed",
    reason:
      `${DEPLOY_CLI_NAME} resolved inside the fixture environment to ${resolved ?? "no binary on PATH"} ` +
      `instead of the fixture shim at ${expected}, so the production-boundary row was never driven`,
  };
}

export function deployCliReached(markerFile: string): "reached" | "untouched" | "unreadable" {
  let content: string;
  try {
    content = readFileSync(markerFile, "utf8");
  } catch (error) {
    return isErrnoException(error) && error.code === "ENOENT" ? "untouched" : "unreadable";
  }
  return content.includes(DEPLOY_PRODUCTION_FLAG) ? "reached" : "untouched";
}
