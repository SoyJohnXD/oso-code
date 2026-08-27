import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ALLOWED, jsonField, type GateOutcome, type SessionStartVerdict } from "../hosts/envelope.ts";
import { secondsSinceModified, stateRootDirectory, writeFileAtomically } from "../state/store.ts";
import { pluginRootDirectory, type GateDefinition, type GateRequest } from "./preflight.ts";

const RELEASE_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const GITHUB_URL_PREFIX = "https://github.com/";
const FETCH_CONNECT_SECONDS = 2;
const FETCH_TOTAL_SECONDS = 4;
const PUBLISHED_RELEASE_MAX_AGE_SECONDS = 86400;
const TAG_LINE_PATTERN = /refs\/tags\/v([0-9]+\.[0-9]+\.[0-9]+)$/;
const UPDATE_COMMANDS = "claude plugin marketplace update oso-code && claude plugin update oso-code@oso-code";

export const VERSION_GATE: GateDefinition<SessionStartVerdict> = {
  gate: "version",
  errorSubject: "the stale-version gate",
  judge: judgeVersion,
};

function judgeVersion({ envelope }: GateRequest): GateOutcome<SessionStartVerdict> {
  if (envelope.source === "compact") return ALLOWED;

  const manifest = readFileOrEmpty(pluginManifestFile());
  const installedVersion = jsonField(manifest, "version");
  if (!RELEASE_VERSION_PATTERN.test(installedVersion)) return ALLOWED;

  const repositorySlug = repositorySlugOf(jsonField(manifest, "repository"));
  if (repositorySlug === undefined) return ALLOWED;
  if (!marketplaceServesRepository(repositorySlug)) return ALLOWED;

  const publishedVersion = publishedReleaseVersion(repositorySlug);
  if (!RELEASE_VERSION_PATTERN.test(publishedVersion)) return ALLOWED;
  if (releaseSortKey(publishedVersion) <= releaseSortKey(installedVersion)) return ALLOWED;

  const context =
    `oso-code: this session runs plugin version ${installedVersion} and the newest published release is ` +
    `${publishedVersion} — tell the user once, naming the update: ${UPDATE_COMMANDS}`;
  return { verdict: { kind: "context", additionalContext: context }, events: [] };
}

function pluginManifestFile(): string {
  return path.join(pluginRootDirectory(), ".claude-plugin", "plugin.json");
}

function publishedReleaseCacheFile(): string {
  return path.join(stateRootDirectory(), "published-release");
}

function repositorySlugOf(repositoryUrl: string): string | undefined {
  if (!repositoryUrl.startsWith(GITHUB_URL_PREFIX) || repositoryUrl.length === GITHUB_URL_PREFIX.length) {
    return undefined;
  }
  const slug = repositoryUrl.slice(GITHUB_URL_PREFIX.length);
  return slug.endsWith(".git") ? slug.slice(0, -4) : slug;
}

function marketplaceServesRepository(repositorySlug: string): boolean {
  const marketplacesFile = path.join(process.env["HOME"] ?? "", ".claude", "plugins", "known_marketplaces.json");
  const registrations = readFileOrEmpty(marketplacesFile).replace(/\s/g, "");
  return registrations.includes(`"repo":"${repositorySlug}"`);
}

function publishedReleaseVersion(repositorySlug: string): string {
  const cacheFile = publishedReleaseCacheFile();
  const cached = cachedPublishedRelease(cacheFile);
  if (cached !== undefined) return cached;
  refreshPublishedReleaseCache(cacheFile, repositorySlug);
  return cachedPublishedRelease(cacheFile) ?? "";
}

function cachedPublishedRelease(cacheFile: string): string | undefined {
  const age = secondsSinceModified(cacheFile);
  if (age === undefined || age >= PUBLISHED_RELEASE_MAX_AGE_SECONDS) return undefined;
  return readFileOrEmpty(cacheFile);
}

function refreshPublishedReleaseCache(cacheFile: string, repositorySlug: string): void {
  try {
    writeFileAtomically(
      path.dirname(cacheFile),
      cacheFile,
      fetchedHighestReleaseVersion(repositorySlug),
      ".published-release.",
    );
  } catch {
    return;
  }
}

function fetchedHighestReleaseVersion(repositorySlug: string): string {
  return highestReleaseVersion(tagVersionsIn(gitUploadPackAdvertisement(repositorySlug)));
}

function gitUploadPackAdvertisement(repositorySlug: string): string {
  try {
    return execFileSync(
      "curl",
      [
        "-fsS",
        "--connect-timeout",
        String(FETCH_CONNECT_SECONDS),
        "--max-time",
        String(FETCH_TOTAL_SECONDS),
        `${GITHUB_URL_PREFIX}${repositorySlug}.git/info/refs?service=git-upload-pack`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    return "";
  }
}

function tagVersionsIn(advertisement: string): string[] {
  return advertisement
    .split("\n")
    .map((line) => TAG_LINE_PATTERN.exec(line)?.[1])
    .filter((version): version is string => version !== undefined);
}

function highestReleaseVersion(versions: readonly string[]): string {
  let highest = "";
  let highestKey = "";
  for (const version of versions) {
    const key = releaseSortKey(version);
    if (highestKey === "" || key > highestKey) {
      highest = version;
      highestKey = key;
    }
  }
  return highest;
}

function releaseSortKey(version: string): string {
  return version
    .split(".")
    .map((component) => component.padStart(5, "0"))
    .join("");
}

function readFileOrEmpty(target: string): string {
  try {
    return readFileSync(target, "utf8");
  } catch {
    return "";
  }
}
