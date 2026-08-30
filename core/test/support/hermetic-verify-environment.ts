export const HERMETIC_VERIFY_PATH = "/usr/bin:/bin:/usr/local/bin";

export function hermeticVerifyEnvironment(fixtureHome: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    OSO_VERIFY_SKIP_SLOW: "1",
    HOME: fixtureHome,
    USERPROFILE: fixtureHome,
    PATH: HERMETIC_VERIFY_PATH,
  };
}
