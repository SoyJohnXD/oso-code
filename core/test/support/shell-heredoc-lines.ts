export type SourceLine = Readonly<{ number: number; text: string }>;

type HeredocOpener = Readonly<{ stripsTabs: boolean; delimiter: string }>;

const HEREDOC_OPENER_PATTERN = /<<(-?)[ \t]*("[^"]*"|'[^']*'|[A-Za-z_][A-Za-z0-9_]*)/g;

function heredocOpenersOn(line: string): HeredocOpener[] {
  return [...line.matchAll(HEREDOC_OPENER_PATTERN)]
    .filter((match) => {
      const start = match.index as number;
      const end = start + (match[0] as string).length;
      return line[start - 1] !== "<" && line[end] !== "<";
    })
    .map((match) => ({ stripsTabs: match[1] === "-", delimiter: (match[2] as string).replace(/^["']|["']$/g, "") }));
}

export function linesOutsideHeredocBodies(text: string): SourceLine[] {
  const pending: HeredocOpener[] = [];
  const kept: SourceLine[] = [];
  text.split("\n").forEach((line, index) => {
    const opener = pending[0];
    if (opener !== undefined) {
      const probe = opener.stripsTabs ? line.replace(/^\t+/, "") : line;
      if (probe === opener.delimiter) pending.shift();
      return;
    }
    kept.push({ number: index + 1, text: line });
    pending.push(...heredocOpenersOn(line));
  });
  return kept;
}
