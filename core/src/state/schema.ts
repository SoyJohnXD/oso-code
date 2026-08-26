export type RawState = Readonly<Record<string, string>>;

export type Mode = "none" | "quick" | "debug" | "plan";

const KNOWN_MODES: readonly Mode[] = ["none", "quick", "debug", "plan"];
const NONE = "none";

export class StateInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateInvariantError";
  }
}

export type RuntimeState = Readonly<{
  mode: Mode;
  activeSlice: string;
  verifyGreen: boolean;
  auto: string | undefined;
  autoChange: string | undefined;
  autoWait: string | undefined;
  roadmap: string | undefined;
  session: string | undefined;
  fields: RawState;
}>;

export function parseRuntimeState(fields: RawState): RuntimeState {
  const mode = modeOf(fields);
  const activeSlice = fields["active_slice"] ?? NONE;
  if (mode === NONE && activeSlice !== NONE) {
    throw new StateInvariantError(`mode=none cannot carry active_slice=${activeSlice}`);
  }
  return {
    mode,
    activeSlice,
    verifyGreen: fields["verify_green"] === "true",
    auto: fields["auto"],
    autoChange: fields["auto_change"],
    autoWait: fields["auto_wait"],
    roadmap: fields["roadmap"],
    session: fields["session"],
    fields,
  };
}

function modeOf(fields: RawState): Mode {
  const value = fields["mode"] ?? NONE;
  if (isKnownMode(value)) return value;
  throw new StateInvariantError(`mode=${value} is not a recognised mode`);
}

function isKnownMode(value: string): value is Mode {
  return (KNOWN_MODES as readonly string[]).includes(value);
}
