/**
 * The one-time setup token (D-101) — every property the decision states,
 * including the ones that only fail when somebody breaks them on purpose.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY EACH CASE IS HERE
 *
 * This token is the ONLY thing standing between a stranger and the
 * administrator account of an instance that is about to hold children's
 * records (D-039's race, closed by D-101). Every claim the design makes about
 * it is asserted here, and the negative direction is asserted too — a suite
 * that only proves the happy path proves nothing about a credential.
 *
 * IT USES A REAL FILESYSTEM, in a temporary `DATA_DIR`. The mode of the file is
 * one of the properties under test, so a mocked `fs` would assert the mock.
 */

import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { SetupEnv } from "@/lib/setup/data-dir";
import {
  SETUP_TOKEN_TTL_MINUTES,
  clearSetupToken,
  consumeSetupToken,
  ensureSetupToken,
  hasUsableSetupToken,
  issueSetupToken,
  normaliseSetupToken,
  readSetupToken,
  setupTokenPath,
  setupTokenStatus,
  usedSetupTokenPath,
} from "@/lib/setup/token";

/** A throwaway `DATA_DIR`, so nothing here touches the checkout's own. */
function scratchEnv(): SetupEnv {
  return { DATA_DIR: mkdtempSync(path.join(tmpdir(), "splashtrack-setup-")) };
}

/** Reads the token value out of the file — what the OPERATOR does. */
function tokenValue(env: SetupEnv): string {
  const record = readSetupToken(env);
  if (!record) throw new Error("no token issued");
  return record.token;
}

const scratches: SetupEnv[] = [];
function env(): SetupEnv {
  const created = scratchEnv();
  scratches.push(created);
  return created;
}

afterEach(() => {
  for (const scratch of scratches.splice(0)) clearSetupToken(scratch);
});

describe("issuing", () => {
  it("writes the token at mode 0600 and returns only a path", () => {
    const scratch = env();
    const result = issueSetupToken(scratch);

    expect(result.path).toBe(setupTokenPath(scratch));
    // THE RETURN VALUE CANNOT LEAK THE TOKEN, because it does not contain it.
    // A caller that logs this object logs a path and a timestamp.
    expect(JSON.stringify(result)).not.toContain(tokenValue(scratch));

    // 0600 — the file is a credential on a volume an operator may share.
    expect(statSync(result.path).mode & 0o777).toBe(0o600);
  });

  it("expires within D-101's sixty-minute ceiling", () => {
    const scratch = env();
    const now = new Date("2026-09-05T10:00:00.000Z");
    const { expiresAt } = issueSetupToken(scratch, now);

    expect(expiresAt.getTime() - now.getTime()).toBe(
      SETUP_TOKEN_TTL_MINUTES * 60 * 1000,
    );
    expect(SETUP_TOKEN_TTL_MINUTES).toBeLessThanOrEqual(60);
  });

  it("says on its own first line that it is a credential", () => {
    // F-20: this file WILL be opened, and its content pasted, by somebody
    // debugging at 23:00. The warning has to be in the artefact, not only in
    // the log line that named it.
    const scratch = env();
    const file = readFileSync(issueSetupToken(scratch).path, "utf8");
    expect(file).toContain("THIS FILE IS A CREDENTIAL");
    expect(file).toContain("Never");
  });

  it("mints a different token every time", () => {
    const scratch = env();
    issueSetupToken(scratch);
    const first = tokenValue(scratch);
    issueSetupToken(scratch);
    expect(tokenValue(scratch)).not.toBe(first);
  });

  it("uses an alphabet with no transcribable ambiguity", () => {
    // The operator reads this off one machine and types it into another.
    // Crockford base32 omits I, L, O and U for exactly that reason.
    const scratch = env();
    issueSetupToken(scratch);
    expect(tokenValue(scratch)).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{32}$/);
  });
});

describe("ensure", () => {
  it("leaves a usable token alone", () => {
    const scratch = env();
    issueSetupToken(scratch);
    const original = tokenValue(scratch);

    const result = ensureSetupToken(scratch);
    expect(result.issued).toBe(false);
    // THE PROPERTY THAT MATTERS ON A RESTART: the token the operator wrote
    // down still works.
    expect(tokenValue(scratch)).toBe(original);
  });

  it("replaces an expired one", () => {
    const scratch = env();
    const issuedAt = new Date("2026-09-05T10:00:00.000Z");
    issueSetupToken(scratch, issuedAt);
    const original = tokenValue(scratch);

    const later = new Date(issuedAt.getTime() + 61 * 60 * 1000);
    expect(ensureSetupToken(scratch, later).issued).toBe(true);
    expect(tokenValue(scratch)).not.toBe(original);
  });
});

describe("consuming", () => {
  it("accepts the issued token exactly once", () => {
    const scratch = env();
    issueSetupToken(scratch);
    const token = tokenValue(scratch);

    expect(consumeSetupToken(token, scratch)).toEqual({ ok: true });
    // SINGLE-USE. The second presentation of a token that was valid a
    // millisecond ago is refused, and refused with the reason that tells the
    // operator to issue a new one rather than to check their typing.
    expect(consumeSetupToken(token, scratch)).toEqual({
      ok: false,
      refusal: "ALREADY_USED",
    });
  });

  it("accepts it however the operator retyped it", () => {
    const scratch = env();
    issueSetupToken(scratch);
    const token = tokenValue(scratch);
    const retyped = `  ${token.toLowerCase().replace(/(.{4})/g, "$1-")}  `;

    expect(normaliseSetupToken(retyped)).toBe(token);
    expect(consumeSetupToken(retyped, scratch)).toEqual({ ok: true });
  });

  it("refuses a wrong token, and does not consume the real one", () => {
    const scratch = env();
    issueSetupToken(scratch);
    const token = tokenValue(scratch);

    expect(consumeSetupToken("0".repeat(32), scratch)).toEqual({
      ok: false,
      refusal: "MISMATCH",
    });
    // A failed attempt must NOT burn the token — otherwise one typo from a
    // stranger locks the owner out of their own install.
    expect(consumeSetupToken(token, scratch)).toEqual({ ok: true });
  });

  it("refuses an expired token", () => {
    const scratch = env();
    const issuedAt = new Date("2026-09-05T10:00:00.000Z");
    issueSetupToken(scratch, issuedAt);
    const token = tokenValue(scratch);

    const late = new Date(
      issuedAt.getTime() + SETUP_TOKEN_TTL_MINUTES * 60_000,
    );
    expect(consumeSetupToken(token, scratch, late)).toEqual({
      ok: false,
      refusal: "EXPIRED",
    });
  });

  it("refuses everything when no token was ever issued", () => {
    const scratch = env();
    expect(consumeSetupToken("anything", scratch)).toEqual({
      ok: false,
      refusal: "NO_TOKEN_ISSUED",
    });
  });

  it("refuses a token file that has been hand-edited into nonsense", () => {
    // NON-VACUOUS: break it deliberately. A parse failure must read as "no
    // usable token" and refuse, never as "no expiry, therefore never expires".
    const scratch = env();
    issueSetupToken(scratch);
    const token = tokenValue(scratch);
    writeFileSync(setupTokenPath(scratch), "{ not json", { mode: 0o600 });

    expect(readSetupToken(scratch)).toBeNull();
    expect(consumeSetupToken(token, scratch)).toEqual({
      ok: false,
      refusal: "NO_TOKEN_ISSUED",
    });
  });

  it("refuses a token whose stored value was replaced under it", () => {
    // The other deliberate break: the file still parses, the token in it is
    // simply not the one the caller holds. This is the case a `startsWith` or
    // a length-only check would pass.
    const scratch = env();
    issueSetupToken(scratch);
    const token = tokenValue(scratch);

    const record = readSetupToken(scratch)!;
    writeFileSync(
      setupTokenPath(scratch),
      JSON.stringify({ ...record, token: "Z".repeat(32) }),
      { mode: 0o600 },
    );

    expect(consumeSetupToken(token, scratch)).toEqual({
      ok: false,
      refusal: "MISMATCH",
    });
  });
});

describe("status", () => {
  it("never contains the token value, in any state", () => {
    // THE PROPERTY D-101 IS ABOUT. `setup:token` prints this object, the
    // entrypoint prints what that command says, and a diagnostics page will
    // eventually render it. If the value could reach it, it reaches the log.
    const scratch = env();
    issueSetupToken(scratch);
    const token = tokenValue(scratch);

    expect(JSON.stringify(setupTokenStatus(scratch))).not.toContain(token);
    expect(setupTokenStatus(scratch).state).toBe("VALID");

    consumeSetupToken(token, scratch);
    expect(JSON.stringify(setupTokenStatus(scratch))).not.toContain(token);
    expect(setupTokenStatus(scratch).state).toBe("USED");
  });

  it("tells 'never issued' apart from 'already used'", () => {
    const scratch = env();
    expect(setupTokenStatus(scratch).state).toBe("NONE");

    issueSetupToken(scratch);
    consumeSetupToken(tokenValue(scratch), scratch);
    expect(setupTokenStatus(scratch).state).toBe("USED");
  });

  it("reports an expired token as expired rather than usable", () => {
    const scratch = env();
    const issuedAt = new Date("2026-09-05T10:00:00.000Z");
    issueSetupToken(scratch, issuedAt);

    const late = new Date(issuedAt.getTime() + 61 * 60 * 1000);
    expect(setupTokenStatus(scratch, late).state).toBe("EXPIRED");
    expect(hasUsableSetupToken(scratch, late)).toBe(false);
    expect(hasUsableSetupToken(scratch, issuedAt)).toBe(true);
  });
});

describe("clearing", () => {
  it("removes the token and its claim marker", () => {
    const scratch = env();
    issueSetupToken(scratch);
    consumeSetupToken(tokenValue(scratch), scratch);
    // Both files exist at this point — the claim marker is what `USED` reads.
    expect(statSync(usedSetupTokenPath(scratch)).isFile()).toBe(true);

    clearSetupToken(scratch);
    expect(setupTokenStatus(scratch).state).toBe("NONE");
  });

  it("is safe on a data directory that never had one", () => {
    expect(() => clearSetupToken(env())).not.toThrow();
  });
});

describe("the claim marker", () => {
  it("is written at 0600 like the token it replaces", () => {
    const scratch = env();
    issueSetupToken(scratch);
    consumeSetupToken(tokenValue(scratch), scratch);
    expect(statSync(usedSetupTokenPath(scratch)).mode & 0o777).toBe(0o600);
  });

  it("does not make a freshly issued token look used", () => {
    const scratch = env();
    issueSetupToken(scratch);
    consumeSetupToken(tokenValue(scratch), scratch);

    issueSetupToken(scratch);
    expect(setupTokenStatus(scratch).state).toBe("VALID");
    expect(consumeSetupToken(tokenValue(scratch), scratch)).toEqual({
      ok: true,
    });
  });
});

describe("the data directory itself", () => {
  it("is created at 0700 when it does not exist", () => {
    // The token is 0600 inside it; a directory anybody can list is half the
    // protection gone. `dataDir()` creates it rather than assuming the image
    // did, because a bind-mounted volume arrives with the host's own mode.
    const base = mkdtempSync(path.join(tmpdir(), "splashtrack-base-"));
    const nested = path.join(base, "data");
    const scratch: SetupEnv = { DATA_DIR: nested };

    issueSetupToken(scratch);
    expect(statSync(nested).mode & 0o777).toBe(0o700);
    clearSetupToken(scratch);
  });

  it("still yields a 0600 token when the directory is more permissive", () => {
    // A pre-existing volume is NOT re-chmod'ed by `mkdir -p`, which is the real
    // deployment shape. The file's own mode has to carry the protection.
    const base = mkdtempSync(path.join(tmpdir(), "splashtrack-open-"));
    chmodSync(base, 0o755);
    const scratch: SetupEnv = { DATA_DIR: base };

    const { path: file } = issueSetupToken(scratch);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    clearSetupToken(scratch);
  });
});
