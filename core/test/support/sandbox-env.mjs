import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const sandboxRoot = mkdtempSync(path.join(tmpdir(), "oso-test-sandbox-"));
const home = path.join(sandboxRoot, "home");
const temp = path.join(sandboxRoot, "temp");

mkdirSync(home, { recursive: true });
mkdirSync(temp, { recursive: true });

Object.assign(process.env, {
  HOME: home,
  USERPROFILE: home,
  XDG_CONFIG_HOME: path.join(home, ".config"),
  XDG_DATA_HOME: path.join(home, ".local", "share"),
  XDG_STATE_HOME: path.join(home, ".local", "state"),
  XDG_CACHE_HOME: path.join(home, ".cache"),
  TMPDIR: temp,
  TEMP: temp,
  TMP: temp,
});

process.once("exit", () => {
  rmSync(sandboxRoot, { recursive: true, force: true });
});
