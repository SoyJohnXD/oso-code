export type LexRecord =
  | { readonly kind: "commandWord"; readonly word: string }
  | { readonly kind: "argument"; readonly word: string }
  | { readonly kind: "stdinText"; readonly text: string }
  | { readonly kind: "unreadPayload" };

export const MAX_LEXED_INPUT_BYTES = 3072;
export const UNREAD_PAYLOAD_MARKER = "!unread-payload";

const MAX_PAYLOAD_DEPTH = 3;
const SPECIAL_CHARACTERS = "'\"\\$`#;&|(){}<> \t\n";
const QUOTED_SPECIAL_CHARACTERS = "\"\\$`";
const UNREAD_PAYLOAD: LexRecord = { kind: "unreadPayload" };

const PREFIX_WORDS = new Set([
  "env", "command", "builtin", "exec", "nice", "nohup", "time", "timeout", "stdbuf",
  "sudo", "doas", "setsid", "xargs", "flock", "ionice", "chrt", "taskset", "unbuffer",
  "then", "else", "elif", "do", "done", "fi", "in", "until", "while", "if", "for",
  "case", "esac", "select", "function", "!",
]);
const SHELL_INTERPRETERS = new Set(["bash", "sh", "dash", "zsh", "ksh"]);

export function lexShellCommands(commandLine: string): readonly LexRecord[] {
  return new CommandLineLexer(commandLine, 0).lex();
}

export function basenameOf(word: string): string {
  const lastSlash = word.lastIndexOf("/");
  return lastSlash === -1 ? word : word.slice(lastSlash + 1);
}

function isShellInterpreter(word: string): boolean {
  return SHELL_INTERPRETERS.has(basenameOf(word));
}

function isCommandPrefixWord(word: string): boolean {
  if (/^[A-Za-z_][\s\S]*=/.test(word)) return true;
  if (word.startsWith("-")) return true;
  if (!/[^0-9]/.test(word)) return word !== "";
  return PREFIX_WORDS.has(basenameOf(word));
}

function completesItsWordsFromStdin(word: string): boolean {
  return basenameOf(word) === "xargs";
}

function isSourcingBuiltin(word: string): boolean {
  return word === "source" || word === ".";
}

function withSpacesForNewlines(text: string): string {
  return text.replaceAll("\n", " ");
}

function leadingRunWithout(text: string, stoppers: string): string {
  let length = 0;
  while (length < text.length && !stoppers.includes(text[length] as string)) length += 1;
  return text.slice(0, length);
}

type PendingHeredoc = { readonly delimiter: string; readonly stripsTabs: boolean };

class CommandLineLexer {
  private rest: string;
  private readonly depth: number;
  private token = "";
  private tokenOpen = false;
  private redirectTargetPending = false;
  private herestringPending = false;
  private pendingHeredocs: PendingHeredoc[] = [];
  private nested: LexRecord[] = [];
  private unreadStdin = "";
  private commandTokens: string[] = [];
  private readonly records: LexRecord[] = [];

  constructor(commandLine: string, depth: number) {
    this.rest = `${commandLine}\n`;
    this.depth = depth;
  }

  lex(): readonly LexRecord[] {
    if (Buffer.byteLength(this.rest, "utf8") > MAX_LEXED_INPUT_BYTES) return [UNREAD_PAYLOAD];
    while (this.rest !== "") this.takeNext();
    this.endToken();
    this.takeHeredocBodies();
    this.endCommand();
    return this.records;
  }

  private takeNext(): void {
    const ordinary = leadingRunWithout(this.rest, SPECIAL_CHARACTERS);
    if (ordinary !== "") {
      this.token += ordinary;
      this.tokenOpen = true;
      this.rest = this.rest.slice(ordinary.length);
      return;
    }
    const character = this.rest.slice(0, 1);
    this.rest = this.rest.slice(1);
    this.takeSpecial(character);
  }

  private takeSpecial(character: string): void {
    switch (character) {
      case "'":
        this.tokenOpen = true;
        this.takeSingleQuoted();
        return;
      case '"':
        this.tokenOpen = true;
        this.takeDoubleQuoted();
        return;
      case "\\":
        this.takeEscape();
        return;
      case "$":
        this.tokenOpen = true;
        this.takeExpansion();
        return;
      case "`":
        this.tokenOpen = true;
        this.takeBacktick();
        return;
      case "#":
        if (this.tokenOpen) this.token += "#";
        else this.dropComment();
        return;
      case " ":
      case "\t":
        this.endToken();
        return;
      case ">":
        this.endToken();
        this.takeRedirect();
        return;
      case "<":
        this.takeInputRedirect();
        return;
      case "&":
        if (this.rest.startsWith(">")) {
          this.endToken();
          this.takeRedirect();
        } else {
          this.endCommand();
        }
        return;
      case "\n":
        this.endToken();
        this.takeHeredocBodies();
        this.endCommand();
        return;
      default:
        this.endCommand();
    }
  }

  private endToken(): void {
    if (this.tokenOpen && this.redirectTargetPending) {
      this.redirectTargetPending = false;
    } else if (this.tokenOpen) {
      this.commandTokens.push(this.token);
      if (this.herestringPending) {
        this.herestringPending = false;
        this.deferNestedCommands(this.token);
      }
    }
    this.token = "";
    this.tokenOpen = false;
  }

  private endCommand(): void {
    this.endToken();
    this.stripCommandPrefixes();
    this.deferPayloadCommands();
    this.emitCommand();
    this.commandTokens = [];
    this.nested = [];
    this.unreadStdin = "";
    this.redirectTargetPending = false;
  }

  private stripCommandPrefixes(): void {
    let prefixWord = "";
    let stdinCompletesTheWords = false;
    while (this.commandTokens.length > 0) {
      const leading = this.commandTokens[0] as string;
      if (!isCommandPrefixWord(leading)) {
        if (prefixWord.startsWith("-")) this.markUnread();
        if (stdinCompletesTheWords) this.unreadStdin += UNREAD_PAYLOAD_MARKER;
        return;
      }
      prefixWord = leading;
      if (completesItsWordsFromStdin(prefixWord)) stdinCompletesTheWords = true;
      this.commandTokens = this.commandTokens.slice(1);
    }
  }

  private deferPayloadCommands(): void {
    const leading = this.commandTokens[0];
    if (leading === undefined) return;
    if (isSourcingBuiltin(leading)) {
      this.markUnread();
      return;
    }
    if (basenameOf(leading) === "eval") {
      this.deferNestedCommands(this.commandTokens.slice(1).join(" "));
      return;
    }
    if (isShellInterpreter(leading)) this.deferInterpreterPayload();
  }

  private deferInterpreterPayload(): void {
    let commandFlagSeen = false;
    let valuePosition = false;
    for (const argument of this.commandTokens.slice(1)) {
      if (argument.startsWith("--")) {
        valuePosition = true;
      } else if (argument === "-c") {
        commandFlagSeen = true;
        valuePosition = false;
      } else if (argument.startsWith("-") && argument.slice(1).includes("c")) {
        commandFlagSeen = true;
        valuePosition = true;
      } else if (argument.startsWith("-")) {
        valuePosition = true;
      } else if (commandFlagSeen) {
        if (valuePosition) this.markUnread();
        this.deferNestedCommands(argument);
        return;
      }
    }
    if (this.nested.length === 0) this.markUnread();
  }

  private deferNestedCommands(payload: string): void {
    if (payload === "") return;
    if (this.depth >= MAX_PAYLOAD_DEPTH) {
      this.markUnread();
      return;
    }
    this.nested.push(...new CommandLineLexer(payload, this.depth + 1).lex());
  }

  private markUnread(): void {
    this.nested.push(UNREAD_PAYLOAD);
  }

  private emitCommand(): void {
    this.commandTokens.forEach((word, index) => {
      this.records.push(
        index === 0
          ? { kind: "commandWord", word: withSpacesForNewlines(word) }
          : { kind: "argument", word: withSpacesForNewlines(word) },
      );
    });
    if (this.unreadStdin !== "") {
      this.records.push({ kind: "stdinText", text: withSpacesForNewlines(this.unreadStdin) });
    }
    this.records.push(...this.nested);
  }

  private takeEscape(): void {
    if (this.rest.startsWith("\n")) {
      this.rest = this.rest.slice(1);
      return;
    }
    this.token += this.rest.slice(0, 1);
    this.tokenOpen = true;
    this.rest = this.rest.slice(1);
  }

  private takeSingleQuoted(): void {
    const span = this.spanBefore("'");
    this.token += span;
    this.rest = this.rest.slice(span.length + 1);
  }

  private takeDoubleQuoted(): void {
    while (this.rest !== "") {
      const ordinary = leadingRunWithout(this.rest, QUOTED_SPECIAL_CHARACTERS);
      if (ordinary !== "") {
        this.token += ordinary;
        this.rest = this.rest.slice(ordinary.length);
        continue;
      }
      const character = this.rest.slice(0, 1);
      this.rest = this.rest.slice(1);
      if (character === '"') return;
      if (character === "\\") {
        this.token += this.rest.slice(0, 1);
        this.rest = this.rest.slice(1);
      } else if (character === "$") {
        this.takeExpansion();
      } else if (character === "`") {
        this.takeBacktick();
      }
    }
  }

  private takeExpansion(): void {
    if (this.rest.startsWith("(")) {
      this.token += "$";
      this.rest = this.rest.slice(1);
      this.deferNestedCommands(this.takeSubstitutionBody());
      return;
    }
    if (this.rest.startsWith("{")) {
      const span = this.spanBefore("}");
      this.token += `$${span}}`;
      this.rest = this.rest.slice(span.length + 1);
      return;
    }
    this.token += "$";
  }

  private takeSubstitutionBody(): string {
    let nesting = 1;
    let body = "";
    while (this.rest !== "") {
      const ordinary = leadingRunWithout(this.rest, "()");
      body += ordinary;
      this.rest = this.rest.slice(ordinary.length);
      const character = this.rest.slice(0, 1);
      this.rest = this.rest.slice(1);
      if (character === "(") {
        nesting += 1;
        body += "(";
      } else if (character === ")") {
        nesting -= 1;
        if (nesting === 0) return body;
        body += ")";
      }
    }
    return body;
  }

  private takeBacktick(): void {
    const span = this.spanBefore("`");
    this.token += "$";
    this.rest = this.rest.slice(span.length + 1);
    this.deferNestedCommands(span);
  }

  private dropComment(): void {
    this.rest = this.rest.slice(this.spanBefore("\n").length);
  }

  private takeRedirect(): void {
    this.redirectTargetPending = true;
    while (this.rest !== "" && ">&|".includes(this.rest.slice(0, 1))) {
      this.rest = this.rest.slice(1);
    }
  }

  private takeInputRedirect(): void {
    if (this.rest.startsWith("<<")) {
      this.rest = this.rest.slice(2);
      this.endToken();
      this.herestringPending = true;
      return;
    }
    if (this.rest.startsWith("<")) {
      this.rest = this.rest.slice(1);
      const stripsTabs = this.rest.startsWith("-");
      if (stripsTabs) this.rest = this.rest.slice(1);
      this.pendingHeredocs.push({ delimiter: this.takeHeredocDelimiter(), stripsTabs });
      return;
    }
    this.endToken();
    this.takeRedirect();
  }

  private takeHeredocDelimiter(): string {
    let delimiter = "";
    while (this.rest !== "") {
      const leading = this.rest.slice(0, 1);
      if (leading === " " || leading === "\t") {
        if (delimiter !== "") return delimiter;
        this.rest = this.rest.slice(1);
        continue;
      }
      const ordinary = leadingRunWithout(this.rest, SPECIAL_CHARACTERS);
      if (ordinary !== "") {
        delimiter += ordinary;
        this.rest = this.rest.slice(ordinary.length);
        continue;
      }
      if (leading !== "'" && leading !== '"' && leading !== "\\") return delimiter;
      this.rest = this.rest.slice(1);
    }
    return delimiter;
  }

  private takeHeredocBodies(): void {
    if (this.pendingHeredocs.length === 0) return;
    this.stripCommandPrefixes();
    while (this.pendingHeredocs.length > 0) {
      const heredoc = this.pendingHeredocs.shift() as PendingHeredoc;
      const body = this.takeHeredocBody(heredoc);
      if (isShellInterpreter(this.commandTokens[0] ?? "")) this.deferNestedCommands(body);
      else this.unreadStdin += body;
    }
  }

  private takeHeredocBody(heredoc: PendingHeredoc): string {
    if (heredoc.stripsTabs) return this.takeBodyByLines(heredoc);
    return this.takeBodyToTerminator(heredoc.delimiter) ?? this.takeBodyByLines(heredoc);
  }

  private takeBodyToTerminator(delimiter: string): string | undefined {
    const at = this.rest.indexOf(`\n${delimiter}\n`);
    if (at === -1) return undefined;
    const body = this.rest.slice(0, at);
    this.rest = this.rest.slice(body.length + delimiter.length + 2);
    return body;
  }

  private takeBodyByLines(heredoc: PendingHeredoc): string {
    let body = "";
    while (this.rest !== "") {
      const line = this.spanBefore("\n");
      this.rest = this.rest.slice(line.length + 1);
      const probe = heredoc.stripsTabs ? line.replace(/^\t+/, "") : line;
      if (probe === heredoc.delimiter) return body;
      body += `${line}\n`;
    }
    return body;
  }

  private spanBefore(stopper: string): string {
    const at = this.rest.indexOf(stopper);
    return at === -1 ? this.rest : this.rest.slice(0, at);
  }
}
