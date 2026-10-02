export const UNREAD_PAYLOAD_MARKER = "!unread-payload";

const BACKSLASH_OR_DOLLAR = /[\\$]/;

export function basenameOf(word: string): string {
  const lastSlash = word.lastIndexOf("/");
  return lastSlash === -1 ? word : word.slice(lastSlash + 1);
}

export function holdsABackslashOrADollar(text: string): boolean {
  return BACKSLASH_OR_DOLLAR.test(text);
}
