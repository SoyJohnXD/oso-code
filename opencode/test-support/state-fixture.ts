import { writeStateValues } from "@oso-code/core";

const HOME_PROVENANCES = ["HOME", "USERPROFILE"] as const;

function pinHome(home: string): () => void {
  const restored = HOME_PROVENANCES.map((name) => [name, process.env[name]] as const);
  for (const name of HOME_PROVENANCES) {
    process.env[name] = home;
  }
  return () => {
    for (const [name, value] of restored) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  };
}

export function underFixtureHome<T>(home: string, run: () => T): T {
  const release = pinHome(home);
  try {
    return run();
  } finally {
    release();
  }
}

export async function underFixtureHomeAsync<T>(home: string, run: () => Promise<T>): Promise<T> {
  const release = pinHome(home);
  try {
    return await run();
  } finally {
    release();
  }
}

export function armStateUnder(home: string, directory: string, session: string, pairs: readonly string[]): void {
  underFixtureHome(home, () => writeStateValues(directory, session, pairs));
}
