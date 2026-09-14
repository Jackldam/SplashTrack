import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  computeKeyFingerprint,
  EnvelopeAuthenticationError,
  fingerprintsMatch,
  generateKey,
  unwrapDataKey,
  unwrapKeyRecord,
  wrapDataKey,
  wrapKeyRecord,
  type KeyRecord,
} from "@/lib/crypto/backup-envelope";
import { generateRecoveryToken } from "@/lib/crypto/recovery-token";

// Small Argon2id params so the suite stays fast; production uses
// DEFAULT_ARGON2_PARAMS (64 MiB / t=3), which this test does not need to pay
// for to prove the envelope's correctness.
const FAST_PARAMS = { memoryKiB: 8 * 1024, passes: 1, parallelism: 1 };

function record(): KeyRecord {
  const secretKey = randomBytes(32);
  return {
    masterKey: generateKey(),
    secretKey,
    keyFingerprint: computeKeyFingerprint(secretKey),
  };
}

describe("two-level key envelope (D-114, D-166)", () => {
  it("wraps and unwraps a key record under the recovery token", () => {
    const token = generateRecoveryToken();
    const rec = record();
    const aad = Buffer.from("manifest-digest-1");

    const wrapped = wrapKeyRecord(rec, token.raw, aad, FAST_PARAMS);
    const opened = unwrapKeyRecord(wrapped, token.raw, aad);

    expect(opened.masterKey).toEqual(rec.masterKey);
    expect(opened.secretKey).toEqual(rec.secretKey);
    expect(wrapped.keyFingerprint).toEqual(rec.keyFingerprint);
  });

  it("refuses the wrong token", () => {
    const token = generateRecoveryToken();
    const wrongToken = generateRecoveryToken();
    const rec = record();
    const aad = Buffer.from("manifest-digest-1");

    const wrapped = wrapKeyRecord(rec, token.raw, aad, FAST_PARAMS);
    expect(() => unwrapKeyRecord(wrapped, wrongToken.raw, aad)).toThrow(
      EnvelopeAuthenticationError,
    );
  });

  it("refuses a key record spliced from a different archive (AAD mismatch)", () => {
    const token = generateRecoveryToken();
    const rec = record();
    const wrapped = wrapKeyRecord(
      rec,
      token.raw,
      Buffer.from("archive-A-digest"),
      FAST_PARAMS,
    );
    expect(() =>
      unwrapKeyRecord(wrapped, token.raw, Buffer.from("archive-B-digest")),
    ).toThrow(EnvelopeAuthenticationError);
  });

  it("rotation: re-wrapping under a new token keeps the master key identical, so archives written under the old wrap stay readable", () => {
    const oldToken = generateRecoveryToken();
    const newToken = generateRecoveryToken();
    const rec = record();
    const aad = Buffer.from("manifest-digest-1");

    const wrappedOld = wrapKeyRecord(rec, oldToken.raw, aad, FAST_PARAMS);
    const wrappedNew = wrapKeyRecord(rec, newToken.raw, aad, FAST_PARAMS);

    const openedOld = unwrapKeyRecord(wrappedOld, oldToken.raw, aad);
    const openedNew = unwrapKeyRecord(wrappedNew, newToken.raw, aad);

    expect(openedOld.masterKey).toEqual(rec.masterKey);
    expect(openedNew.masterKey).toEqual(rec.masterKey);
    // The old token no longer opens the NEW wrap.
    expect(() => unwrapKeyRecord(wrappedNew, oldToken.raw, aad)).toThrow(
      EnvelopeAuthenticationError,
    );
  });

  it("wraps and unwraps a per-archive data key under the master key", () => {
    const rec = record();
    const dataKey = generateKey();

    const wrapped = wrapDataKey(dataKey, rec.masterKey);
    expect(unwrapDataKey(wrapped, rec.masterKey)).toEqual(dataKey);
  });

  it("data key wrapped under a different master key does not unwrap", () => {
    const dataKey = generateKey();
    const wrapped = wrapDataKey(dataKey, generateKey());
    expect(() => unwrapDataKey(wrapped, generateKey())).toThrow(
      EnvelopeAuthenticationError,
    );
  });

  it("computeKeyFingerprint is deterministic and one-way over SECRET_KEY", () => {
    const secretKey = randomBytes(32);
    const a = computeKeyFingerprint(secretKey);
    const b = computeKeyFingerprint(secretKey);
    expect(fingerprintsMatch(a, b)).toBe(true);
    expect(fingerprintsMatch(a, computeKeyFingerprint(randomBytes(32)))).toBe(
      false,
    );
    // Not a truncation/prefix of the key itself.
    expect(a.equals(secretKey.subarray(0, a.length))).toBe(false);
  });
});
