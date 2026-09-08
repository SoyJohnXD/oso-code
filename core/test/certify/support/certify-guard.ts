export const CERTIFY = process.env["OSO_CERTIFY"] === "1";

export const CERTIFY_SKIP_REASON =
  "certification tests introspect a real, pinned OpenCode binary against a fixture install and never run on the PR gate; set OSO_CERTIFY=1 to run them";

export const CERTIFY_GUARD: { skip: false | string } = { skip: CERTIFY ? false : CERTIFY_SKIP_REASON };

export const CODEX_CERTIFY_GUARD: { skip: false | string } = {
  skip:
    CERTIFY ? false : "certification tests introspect a real, pinned Codex binary and never run on the PR gate; set OSO_CERTIFY=1 to run them",
};
