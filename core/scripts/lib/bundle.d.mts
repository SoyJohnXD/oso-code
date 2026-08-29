export function bundleText(entryPoint: string): Promise<string>;

export function importBundled(entryPoint: string): Promise<Record<string, unknown>>;

export function readTextOrNull(path: string): string | null;
