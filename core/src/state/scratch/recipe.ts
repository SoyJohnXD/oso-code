import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { sha256Hex } from "../store.ts";
import { assertCanonicalPath, inventoryFor, type ScratchRecipe } from "./materialization.ts";

type RuntimeFile = Readonly<{ path: string; digest: string }>;
export type RuntimeInventory = Readonly<{ node: RuntimeFile; npm?: RuntimeFile; shell?: RuntimeFile; npmPackage?: RuntimeFile }>;

export function reviewCommand(sourceRoot: string, recipe: ScratchRecipe, argv: readonly string[]): void {
  if (argv[0] === "npm") {
    reviewNpmCommand(sourceRoot, recipe, argv);
    return;
  }
  const scriptName = argv[1] ?? "";
  if (argv[0] !== process.execPath || argv.length !== 2 || !/\.(?:mjs|cjs|js)$/.test(scriptName) ||
      !inventoryFor(sourceRoot, recipe).some((entry) => entry.name === scriptName && !entry.dependency)) {
    throw new Error("scratch refuses opaque nesting; use an inventoried foreground Node script or reviewed npm route");
  }
  const script = readFileSync(path.join(sourceRoot, scriptName), "utf8");
  if (recipe.cacheRouting !== "node-only" || (recipe.tools !== undefined && JSON.stringify(recipe.tools) !== '["node"]')) throw new Error("scratch Node checks require node-only cache/tool routing");
  if (/\b(?:detached|setsid|daemon|unref|npm|npx|require|eval|Function|Worker|createRequire|getBuiltinModule)\b|child_process|node:cluster|\bimport\s*\(/.test(script)) {
    throw new Error("scratch recipe contains unsupported detach/daemon/process nesting");
  }
  const supportedBuiltins = new Set(["fs", "fs/promises", "path", "os", "assert", "assert/strict", "crypto", "url", "util", "timers", "timers/promises", "buffer", "stream"]);
  for (const imported of script.matchAll(/\b(?:from|import)\s*["']([^"']+)["']/g)) {
    if (!supportedBuiltins.has(imported[1]!.replace(/^node:/, ""))) throw new Error(`scratch Node import/cache routing is not reviewed: ${imported[1]}`);
  }
}

function reviewNpmCommand(sourceRoot: string, recipe: ScratchRecipe, argv: readonly string[]): void {
  const route = argv[2];
  if (recipe.cacheRouting !== "node-npm" || argv.length !== 3 || argv[1] !== "run" || !["build", "check", "typecheck"].includes(route ?? "")) {
    throw new Error("scratch npm supports only reviewed build/check/typecheck; tests, certification and setup/install use no-export");
  }
  const tools = [...new Set(["node", "npm", "sh", ...recipe.commands.map((command) => command.argv[2] === "typecheck" ? "typescript" : "esbuild")])];
  if (!Array.isArray(recipe.tools) || recipe.tools.length !== tools.length || tools.some((tool) => !recipe.tools!.includes(tool))) {
    throw new Error(`scratch requires explicit transitive tool inventory: ${tools.join(", ")}`);
  }
  const inventory = inventoryFor(sourceRoot, recipe);
  if (!inventory.some((entry) => entry.name === "package.json")) throw new Error("scratch npm requires inventoried package.json");
  const manifest = JSON.parse(readFileSync(path.join(sourceRoot, "package.json"), "utf8")) as { scripts?: Record<string, string>; config?: unknown };
  const builders = ["build-oso-state", "build-gates", "build-prose", "build-oso"];
  const expected = route === "typecheck" ? "tsc -p tsconfig.json" : builders.map((builder) => `node core/scripts/${builder}.mjs${route === "check" ? " --check" : ""}`).join(" && ");
  if (manifest.scripts?.[route!] !== expected || manifest.scripts?.[`pre${route}`] !== undefined || manifest.scripts?.[`post${route}`] !== undefined || manifest.config !== undefined) {
    throw new Error("scratch package script/lifecycle/config differs from the reviewed project route");
  }
  const required = route === "typecheck" ? ["tsconfig.json", "node_modules/typescript/bin/tsc"] : builders.map((builder) => `core/scripts/${builder}.mjs`);
  if (required.some((name) => !inventory.some((entry) => entry.name === name))) throw new Error("scratch project route lacks inventoried inputs/dependencies");
  const dependencyRoots = route === "typecheck" ? ["typescript", `@typescript/typescript-linux-${process.arch}`, "@types/node", "undici-types", "smol-toml"] : ["esbuild", `@esbuild/linux-${process.arch}`, "smol-toml"];
  for (const dependency of dependencyRoots) {
    const root = `node_modules/${dependency}`;
    if (!inventory.some((entry) => entry.name === root && entry.kind === "directory" && entry.dependency) ||
        !inventory.some((entry) => entry.name === `${root}/package.json` && entry.dependency) ||
        recipe.exclusions.some((excluded) => excluded === root || excluded.startsWith(`${root}/`))) {
      throw new Error(`scratch requires the complete copied dependency package: ${dependency}`);
    }
  }
  if (route !== "typecheck") {
    for (const name of required) {
      if (/\b(?:spawn|execFile|execSync|detached|setsid|daemon|unref|require|eval|Function|Worker|createRequire|getBuiltinModule)\b|child_process|node:cluster/.test(readFileSync(path.join(sourceRoot, name), "utf8"))) {
        throw new Error(`scratch builder command has unreviewed process nesting: ${name}`);
      }
    }
  }
  if (inventory.some((entry) => entry.name.startsWith("node_modules/.bin/"))) throw new Error("scratch uses its owned tool launchers; exclude node_modules/.bin");
}

export function runtimeInventory(recipe: ScratchRecipe): RuntimeInventory {
  const node = runtimeFile(process.execPath);
  if (recipe.cacheRouting === "node-only") return { node };
  const npm = runtimeFile(realpathSync(path.join(path.dirname(process.execPath), "npm")));
  if (path.basename(npm.path) !== "npm-cli.js") throw new Error("scratch requires the Node installation's npm CLI, not a shim");
  const npmRoot = path.resolve(npm.path, "../..");
  const builtin = path.join(npmRoot, "npmrc");
  if (existsSync(builtin) && readFileSync(builtin, "utf8").split(/\r?\n/).some((line) => line.trim() !== "" && !/^\s*[#;]/.test(line) && !/^\s*(?:prefix|globalconfig)\s*=/.test(line))) {
    throw new Error("scratch npm builtin settings are unreviewed; use no-export");
  }
  return { node, npm, shell: runtimeFile(realpathSync("/bin/sh")), npmPackage: runtimeFile(path.join(npmRoot, "package.json")) };
}

function runtimeFile(file: string): RuntimeFile {
  assertCanonicalPath(file);
  if (!lstatSync(file).isFile()) throw new Error(`scratch runtime is not a regular file: ${file}`);
  return { path: file, digest: sha256Hex(readFileSync(file)) };
}

export function commandRuntime(argv: readonly string[], runtime: RuntimeInventory): readonly string[] {
  if (argv[0] !== "npm") return argv;
  if (runtime.npm === undefined) throw new Error("scratch npm runtime was not inventoried");
  return [runtime.node.path, runtime.npm.path, ...argv.slice(1)];
}

export function assertInheritedEnvironment(): void {
  const unsafe = Object.keys(process.env).find((name) => process.env[name] && /^(?:npm_config_|NODE_OPTIONS$|NODE_PATH$|NODE_COMPILE_CACHE$|LD_|DYLD_|BASH_ENV$|ENV$|ESBUILD_BINARY_PATH$|TSGO_)/i.test(name));
  if (unsafe !== undefined) throw new Error(`scratch unsafe inherited setting refused: ${unsafe}`);
}

export function prepareEnvironment(payload: string, recipe: ScratchRecipe, runtime: RuntimeInventory): Record<string, string> {
  const environment = { HOME: path.join(payload, "home"), USERPROFILE: path.join(payload, "home"), CODEX_HOME: path.join(payload, "codex"),
    XDG_CONFIG_HOME: path.join(payload, "config"), XDG_CACHE_HOME: path.join(payload, "cache"), XDG_DATA_HOME: path.join(payload, "data"), XDG_STATE_HOME: path.join(payload, "state"),
    TMP: path.join(payload, "tmp"), TEMP: path.join(payload, "tmp"), TMPDIR: path.join(payload, "tmp"),
    PATH: `${path.join(payload, "bin")}:${path.dirname(runtime.node.path)}`, LANG: "C", LC_ALL: "C", NODE_DISABLE_COMPILE_CACHE: "1" };
  if (recipe.cacheRouting === "node-only") return environment;
  return { ...environment, npm_config_cache: path.join(payload, "cache/npm"), npm_config_userconfig: path.join(payload, "config/npm-user"), npm_config_globalconfig: path.join(payload, "config/npm-global"),
    npm_config_ignore_scripts: "true", npm_config_script_shell: path.join(payload, "bin/npm-shell"), npm_config_update_notifier: "false", npm_config_audit: "false", npm_config_fund: "false",
    ESBUILD_BINARY_PATH: path.join(payload, `work/node_modules/@esbuild/linux-${process.arch}/bin/esbuild`) };
}
