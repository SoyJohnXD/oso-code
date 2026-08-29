import { build } from "esbuild";
import { readFileSync } from "node:fs";

export async function bundleText(entryPoint, external = []) {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: "node",
    format: "esm",
    external,
    write: false,
  });
  return result.outputFiles[0].text;
}

export async function importBundled(entryPoint) {
  const text = await bundleText(entryPoint);
  return import(`data:text/javascript;base64,${Buffer.from(text, "utf8").toString("base64")}`);
}

export function readTextOrNull(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
