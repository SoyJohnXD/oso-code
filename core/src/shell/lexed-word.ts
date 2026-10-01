export const UNREAD_PAYLOAD_MARKER = "!unread-payload";

export function basenameOf(word: string): string {
  const lastSlash = word.lastIndexOf("/");
  return lastSlash === -1 ? word : word.slice(lastSlash + 1);
}
