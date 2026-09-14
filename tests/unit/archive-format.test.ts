import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { computeKeyFingerprint } from "@/lib/crypto/backup-envelope";
import { generateRecoveryToken } from "@/lib/crypto/recovery-token";
import {
  ArchiveFormatError,
  assertFingerprintMatches,
  buildArchive,
  KeyFingerprintMismatchError,
  openArchive,
  recoverSecretKeyFromArchive,
  type ArchiveManifest,
} from "@/modules/backup/domain/archive-format";

function baseManifest(): Omit<ArchiveManifest, "keyFingerprintHex"> {
  return {
    archiveFormatVersion: 1,
    appVersion: "1.0.0",
    appliedMigrations: ["0001_init", "0002_add_thing"],
    minimumRestorableVersion: "1.0.0",
    createdAt: new Date().toISOString(),
    rowCounts: { Organization: 1, Person: 3 },
  };
}

function build(overrides?: {
  token?: Buffer;
  secretKey?: Buffer;
  masterKey?: Buffer;
  payload?: Buffer;
}) {
  const token = overrides?.token ?? generateRecoveryToken().raw;
  const secretKey = overrides?.secretKey ?? randomBytes(32);
  const masterKey = overrides?.masterKey ?? randomBytes(32);
  const payload =
    overrides?.payload ?? Buffer.from(JSON.stringify({ hello: "world" }));

  const archive = buildArchive({
    manifest: baseManifest(),
    exportPayload: payload,
    masterKey,
    secretKey,
    tokenRaw: token,
  });
  return { archive, token, secretKey, masterKey, payload };
}

describe("Recovery Kit archive format (D-040, D-102, D-166)", () => {
  it("round-trips: builds and opens with the correct token", () => {
    const { archive, token, secretKey, masterKey, payload } = build();
    const opened = openArchive(archive, token);
    expect(opened.exportPayload).toEqual(payload);
    expect(opened.secretKey).toEqual(secretKey);
    expect(opened.masterKey).toEqual(masterKey);
    expect(opened.manifest.rowCounts).toEqual({ Organization: 1, Person: 3 });
    expect(opened.manifest.appliedMigrations).toEqual([
      "0001_init",
      "0002_add_thing",
    ]);
  });

  it("refuses the wrong token, nothing parsed", () => {
    const { archive } = build();
    const wrongToken = generateRecoveryToken().raw;
    expect(() => openArchive(archive, wrongToken)).toThrow(ArchiveFormatError);
  });

  it("refuses a corrupted magic prefix", () => {
    const { archive } = build();
    const corrupted = Buffer.from(archive);
    corrupted[0] = 0x00;
    expect(() => openArchive(corrupted, generateRecoveryToken().raw)).toThrow(
      ArchiveFormatError,
    );
  });

  it("refuses a bit-flipped body (framed AEAD failure surfaces as ArchiveFormatError)", () => {
    const { archive, token } = build();
    const tampered = Buffer.from(archive);
    tampered[tampered.length - 10] ^= 0xff;
    expect(() => openArchive(tampered, token)).toThrow(ArchiveFormatError);
  });

  it("refuses a truncated archive", () => {
    const { archive, token } = build();
    const truncated = archive.subarray(0, archive.length - 50);
    expect(() => openArchive(truncated, token)).toThrow(ArchiveFormatError);
  });

  it("refuses a header spliced from a different archive (manifest digest mismatch)", () => {
    const a = build();
    const b = build();
    // Splice archive B's header onto archive A's manifest+body.
    const aMagicLen = 7;
    const aHeaderLen = a.archive.readUInt32BE(aMagicLen);
    const bHeaderLen = b.archive.readUInt32BE(aMagicLen);
    const spliced = Buffer.concat([
      a.archive.subarray(0, aMagicLen),
      b.archive.subarray(aMagicLen, aMagicLen + 4 + bHeaderLen),
      a.archive.subarray(aMagicLen + 4 + aHeaderLen),
    ]);
    expect(() => openArchive(spliced, a.token)).toThrow(ArchiveFormatError);
    expect(() => openArchive(spliced, b.token)).toThrow(ArchiveFormatError);
  });

  it("the fingerprint gate (§4.2.2/D-166) refuses a mismatched running SECRET_KEY", () => {
    const { archive, token } = build();
    const opened = openArchive(archive, token);
    expect(() => assertFingerprintMatches(opened, randomBytes(32))).toThrow(
      KeyFingerprintMismatchError,
    );
  });

  it("the fingerprint gate accepts the matching running SECRET_KEY", () => {
    const { archive, token, secretKey } = build();
    const opened = openArchive(archive, token);
    expect(() => assertFingerprintMatches(opened, secretKey)).not.toThrow();
  });

  it("recoverSecretKeyFromArchive (D-166 §2.3 secret:recover) returns just the SECRET_KEY", () => {
    const { archive, token, secretKey } = build();
    expect(recoverSecretKeyFromArchive(archive, token)).toEqual(secretKey);
  });

  it("key material never appears in the clear anywhere in the archive bytes (D-113)", () => {
    const { archive, secretKey, masterKey } = build();
    expect(archive.includes(secretKey)).toBe(false);
    expect(archive.includes(masterKey)).toBe(false);
    // Nor as hex, the encoding the header uses for everything else.
    expect(
      archive.includes(Buffer.from(secretKey.toString("hex"), "utf8")),
    ).toBe(false);
    expect(
      archive.includes(Buffer.from(masterKey.toString("hex"), "utf8")),
    ).toBe(false);
  });

  it("the manifest's cleartext fingerprint matches the key record's", () => {
    const { archive, token, secretKey } = build();
    const opened = openArchive(archive, token);
    expect(opened.manifest.keyFingerprintHex).toBe(
      computeKeyFingerprint(secretKey).toString("hex"),
    );
  });

  it("rotation: an archive built before a token rotation is still openable with the OLD token — rotation only affects future wraps, per D-114", () => {
    // Simulates: the archive itself always carries its OWN wrap (there is no
    // shared on-disk wrap to rotate), so "rotation" for an archive means it
    // keeps opening with whatever token it was built under, forever. This
    // pins that a later, unrelated `generateRecoveryToken()` call does not
    // change that.
    const { archive, token } = build();
    generateRecoveryToken(); // a "new" token minted elsewhere, unrelated
    expect(() => openArchive(archive, token)).not.toThrow();
  });
});
