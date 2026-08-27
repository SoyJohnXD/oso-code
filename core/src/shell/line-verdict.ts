import { lexShellCommands } from "./lexer.ts";
import type { LexedCommand } from "./lexed-command.ts";

export type LexerVerdict = "clear" | "unread";

type LineJudge<GateVerdicts extends string> = (
  command: LexedCommand,
  verdict: GateVerdicts | LexerVerdict,
) => GateVerdicts | LexerVerdict;

export function lineVerdict<GateVerdicts extends string>(
  commandLine: string,
  judge: LineJudge<GateVerdicts>,
): GateVerdicts | LexerVerdict {
  let verdict: GateVerdicts | LexerVerdict = "clear";
  let tokens: string[] = [];
  let stdin = "";
  for (const record of lexShellCommands(commandLine)) {
    switch (record.kind) {
      case "unreadPayload":
        if (verdict === "clear") verdict = "unread";
        break;
      case "commandWord":
        verdict = judge({ tokens, stdin }, verdict);
        tokens = [record.word];
        stdin = "";
        break;
      case "argument":
        tokens.push(record.word);
        break;
      case "stdinText":
        stdin += record.text;
        break;
    }
  }
  return judge({ tokens, stdin }, verdict);
}
