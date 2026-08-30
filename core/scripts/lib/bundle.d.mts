export function bundleText(entryPoint: string, external?: readonly string[]): Promise<string>;

export function importBundled(entryPoint: string): Promise<Record<string, unknown>>;

export function readTextOrNull(path: string): string | null;
