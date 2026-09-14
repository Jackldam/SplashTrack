/**
 * The `.stbak` Recovery Kit archive format (D-040, D-102, D-166 —
 * `docs/design/14-backup-restore-upgrade.md` §2).
 *
 * ```text
 * ┌── splashtrack-backup-<timestamp>.stbak ──────────────────────────────────┐
 * │  MAGIC "STBAK1\0"                                                        │
 * │  header length (u32) + header JSON                                      │
 * │    { format, keyId, wrappedKeyRecord, wrappedDataKey }                  │
 * │  manifest AEAD length (u32) + manifest AEAD message  ← authenticated    │
 * │    FIRST, before the body is parsed at all (D-102)                      │
 * │  body: framed AEAD (../../../lib/crypto/framed-aead.ts) over the        │
 * │    logical export payload (D-095/D-169)                                 │
 * └───────────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * WHY THE MANIFEST IS ITS OWN AEAD MESSAGE, SEPARATE FROM THE BODY. D-102:
 * "the manifest is authenticated as a separate AEAD message before it is
 * parsed" — reading manifest fields (row counts, migration list, format
 * version) to decide how to interpret the body would be acting on
 * attacker-controlled data before authentication, which is exactly what
 * §4.2.1 (D-116/D-169) says an archive from anywhere else must be treated as.
 * `openArchive` authenticates the manifest, THEN the body, in that order, and
 * refuses before parsing either on any failure.
 *
 * THE KEY RECORD TRAVELS IN THE HEADER, IN THE CLEAR STRUCTURE (its CONTENTS
 * are ciphertext — see `../../../lib/crypto/backup-envelope.ts`). This is
 * D-166's own requirement: without it, a restore on a fresh host — the only
 * place a restore ever runs — has no database to read the wrap from, because
 * the database that held it is the one being restored.
 *
 * KEY MATERIAL IS NEVER IN THE ARCHIVE IN THE CLEAR (D-113, restated by
 * D-166's amendment). `assertNoKeyMaterial` in this module's test file greps
 * every shipped fixture for the raw key bytes, per §3.1.1.
 */

import { createHash } from "node:crypto";

import {
  computeKeyFingerprint,
  fingerprintsMatch,
  generateKey,
  unwrapDataKey,
  unwrapKeyRecord,
  wrapDataKey,
  wrapKeyRecord,
  type Argon2Params,
  type KeyRecord,
} from "@/lib/crypto/backup-envelope";
import { decryptFramed, encryptFramed } from "@/lib/crypto/framed-aead";
import { generateRecoveryToken } from "@/lib/crypto/recovery-token";

export const ARCHIVE_MAGIC = Buffer.from("STBAK1\0", "utf8");
export const ARCHIVE_FORMAT_VERSION = 1;

/** Thrown for any structural or authentication failure while opening an
 * archive — a wrong token, corruption, a foreign archive, or a malformed
 * header. `openArchive` never partially applies: on any of these nothing about
 * the archive's contents is trusted, matching §4.2's "nothing is written until
 * authentication succeeds". */
export class ArchiveFormatError extends Error {
  constructor(detail: string) {
    super(`Recovery Kit archive could not be opened: ${detail}.`);
    this.name = "ArchiveFormatError";
  }
}

/** Thrown specifically when the key record decrypts but its fingerprint does
 * not match the running instance's `SECRET_KEY` (D-166's fingerprint gate,
 * §4.2.2) — distinct from {@link ArchiveFormatError} because the caller's
 * remedy differs: `splashtrack secret:recover`, not "check the token". */
export class KeyFingerprintMismatchError extends Error {
  constructor() {
    super(
      "The archive's key fingerprint does not match this instance's " +
        "SECRET_KEY. Nothing has been written. Run `splashtrack " +
        "secret:recover` to recover the archive's original SECRET_KEY, or " +
        "restore onto an instance whose key matches.",
    );
    this.name = "KeyFingerprintMismatchError";
  }
}

/** One row per table in the manifest (D-095's row counts). */
export type RowCounts = Readonly<Record<string, number>>;

/**
 * The manifest — authenticated as its own AEAD message before the body is
 * touched (see the module doc). Everything a restore needs to refuse an
 * incompatible archive BEFORE parsing the body (§3.1, §4.3.2).
 */
export interface ArchiveManifest {
  readonly archiveFormatVersion: number;
  /** `package.json` version of the application that WROTE this archive. */
  readonly appVersion: string;
  /**
   * Every `_prisma_migrations` name applied at backup time, sorted — D-046's
   * "the dump carries its own schema *and* Prisma's `_prisma_migrations`
   * table" as a manifest field (D-095's §3.1.1 note).
   */
  readonly appliedMigrations: readonly string[];
  /** The lowest release this archive may be restored by, per D-048. At v1.0
   * there is no prior release, so this equals `appVersion` — see
   * `restore-service.ts` for what changes the day that stops being true. */
  readonly minimumRestorableVersion: string;
  readonly createdAt: string; // ISO 8601
  readonly rowCounts: RowCounts;
  /** Hex-encoded `computeKeyFingerprint(SECRET_KEY)` at backup time — restated
   * in the manifest (in addition to the header) purely for human-readable
   * diagnostics; the header's copy is authoritative for the gate. */
   readonly keyFingerprintHex: string;
}

export interface ArchiveHeader {
  readonly format: "STBAK1";
  readonly keyId: string;
  /**
   * `sha256(manifest JSON)`, in the clear. This is what the key record is
   * bound to as AAD (D-166), and what the manifest and body AEAD messages are
   * bound to as well — computed once at build time, before anything is
   * encrypted, and carried here so a reader can obtain the AAD WITHOUT first
   * decrypting anything (decrypting the manifest requires the AAD as an
   * input, so it cannot itself be the source of the AAD). A hash is not
   * secret; what makes splicing fail is that every AEAD message in this
   * archive is bound to the SAME digest, so a section copied from a
   * different archive carries a different (or absent) matching digest and
   * fails to authenticate.
   */
  readonly manifestDigestHex: string;
  readonly wrappedKeyRecord: {
    readonly saltHex: string;
    readonly argon2Params: Argon2Params;
    readonly sealedHex: string;
    readonly keyFingerprintHex: string;
  };
  readonly wrappedDataKeyHex: string;
}

export interface BuildArchiveInput {
  readonly manifest: Omit<ArchiveManifest, "keyFingerprintHex">;
  /** The logical export payload (D-095) — already serialized to bytes by the
   * caller (`../infrastructure/logical-export.ts`), opaque to this module. */
  readonly exportPayload: Buffer;
  readonly masterKey: Buffer;
  readonly secretKey: Buffer;
  readonly tokenRaw: Buffer;
  readonly keyId?: string;
}

export interface OpenedArchive {
  readonly manifest: ArchiveManifest;
  readonly exportPayload: Buffer;
  readonly secretKey: Buffer;
  readonly masterKey: Buffer;
}

function manifestDigest(manifestJson: Buffer): Buffer {
  return createHash("sha256").update(manifestJson).digest();
}

function lengthPrefixed(buffer: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(buffer.length, 0);
  return Buffer.concat([length, buffer]);
}

/**
 * Builds one `.stbak` archive. `masterKey`/`secretKey` are the RUNNING
 * instance's own key material (D-166) — a fresh per-archive data key is
 * generated here and wrapped by the master key; the master key and
 * `secretKey` are themselves wrapped by an Argon2id KEK derived from
 * `tokenRaw`.
 */
export function buildArchive(input: BuildArchiveInput): Buffer {
  const keyId = input.keyId ?? "1";
  const keyFingerprint = computeKeyFingerprint(input.secretKey);
  const manifest: ArchiveManifest = {
    ...input.manifest,
    keyFingerprintHex: keyFingerprint.toString("hex"),
  };
  const manifestJson = Buffer.from(JSON.stringify(manifest), "utf8");
  const digest = manifestDigest(manifestJson);

  const record: KeyRecord = {
    masterKey: input.masterKey,
    secretKey: input.secretKey,
    keyFingerprint,
  };
  const wrappedKeyRecord = wrapKeyRecord(record, input.tokenRaw, digest);

  const dataKey = generateKey();
  const wrappedDataKey = wrapDataKey(dataKey, input.masterKey);

  const header: ArchiveHeader = {
    format: "STBAK1",
    keyId,
    manifestDigestHex: digest.toString("hex"),
    wrappedKeyRecord: {
      saltHex: wrappedKeyRecord.salt.toString("hex"),
      argon2Params: wrappedKeyRecord.argon2Params,
      sealedHex: wrappedKeyRecord.sealed.toString("hex"),
      keyFingerprintHex: wrappedKeyRecord.keyFingerprint.toString("hex"),
    },
    wrappedDataKeyHex: wrappedDataKey.toString("hex"),
  };
  const headerJson = Buffer.from(JSON.stringify(header), "utf8");

  // The manifest AEAD is keyed by the DATA key too, bound to the digest as its
  // own AAD — so it authenticates independently of (and before) the body.
  const manifestAead = encryptFramed(manifestJson, dataKey, digest);
  const body = encryptFramed(input.exportPayload, dataKey, digest);

  return Buffer.concat([
    ARCHIVE_MAGIC,
    lengthPrefixed(headerJson),
    lengthPrefixed(manifestAead),
    body,
  ]);
}

function readLengthPrefixed(
  buffer: Buffer,
  offset: number,
): { value: Buffer; next: number } {
  if (offset + 4 > buffer.length) {
    throw new ArchiveFormatError("truncated length prefix");
  }
  const length = buffer.readUInt32BE(offset);
  const start = offset + 4;
  if (start + length > buffer.length) {
    throw new ArchiveFormatError("truncated section");
  }
  return { value: buffer.subarray(start, start + length), next: start + length };
}

/**
 * Opens an archive per §4.2's sequence: unwrap the key record, gate on the
 * fingerprint (§4.2.2, D-166), unwrap the data key, authenticate the manifest,
 * THEN authenticate the body. Throws before returning anything if any step
 * fails — nothing is "partially" opened.
 */
export function openArchive(
  archive: Buffer,
  tokenRaw: Buffer,
): OpenedArchive {
  if (
    archive.length < ARCHIVE_MAGIC.length ||
    !archive.subarray(0, ARCHIVE_MAGIC.length).equals(ARCHIVE_MAGIC)
  ) {
    throw new ArchiveFormatError("not a SplashTrack Recovery Kit archive");
  }
  let offset = ARCHIVE_MAGIC.length;

  const headerRead = readLengthPrefixed(archive, offset);
  offset = headerRead.next;
  let header: ArchiveHeader;
  try {
    header = JSON.parse(headerRead.value.toString("utf8")) as ArchiveHeader;
  } catch {
    throw new ArchiveFormatError("header is not valid JSON");
  }
  if (header.format !== "STBAK1") {
    throw new ArchiveFormatError(`unrecognised format "${header.format}"`);
  }

  const manifestAeadRead = readLengthPrefixed(archive, offset);
  offset = manifestAeadRead.next;
  const body = archive.subarray(offset);

  // §4.2 step 1: unwrap the key record, bound to the manifest digest carried
  // in the (untrusted-but-hash-only) header — see ArchiveHeader.manifestDigestHex.
  const wrappedKeyRecord = {
    salt: Buffer.from(header.wrappedKeyRecord.saltHex, "hex"),
    argon2Params: header.wrappedKeyRecord.argon2Params,
    sealed: Buffer.from(header.wrappedKeyRecord.sealedHex, "hex"),
    keyFingerprint: Buffer.from(
      header.wrappedKeyRecord.keyFingerprintHex,
      "hex",
    ),
  };

  // The AAD every AEAD message in this archive is bound to. A wrong or
  // tampered digest here simply fails every authentication below — including,
  // crucially, the manifest's own, which is how a header edited in transit is
  // caught rather than trusted.
  const aad = Buffer.from(header.manifestDigestHex, "hex");

  let record: KeyRecord;
  try {
    record = unwrapKeyRecord(wrappedKeyRecord, tokenRaw, aad);
  } catch {
    throw new ArchiveFormatError(
      "the recovery token did not unwrap this archive's key record — wrong " +
        "token, or a corrupted/foreign file",
    );
  }

  // §4.2.2 — the fingerprint gate. Compared against the CALLER's running
  // SECRET_KEY, so this function takes no position on that; it exposes the
  // opened record's fingerprint and `restore-service.ts` performs the compare
  // before this function is even called for real key adoption. Here we only
  // assert the header's cleartext fingerprint matches the one bound inside the
  // record we just decrypted — protects against a header edited in transit.
  if (!fingerprintsMatch(record.keyFingerprint, wrappedKeyRecord.keyFingerprint)) {
    throw new ArchiveFormatError("key fingerprint mismatch inside the archive");
  }

  const dataKey = unwrapDataKey(
    Buffer.from(header.wrappedDataKeyHex, "hex"),
    record.masterKey,
  );

  let manifestJson: Buffer;
  try {
    manifestJson = decryptFramed(manifestAeadRead.value, dataKey, aad);
  } catch {
    throw new ArchiveFormatError("manifest did not authenticate");
  }
  let manifest: ArchiveManifest;
  try {
    manifest = JSON.parse(manifestJson.toString("utf8")) as ArchiveManifest;
  } catch {
    throw new ArchiveFormatError("manifest is not valid JSON");
  }

  let exportPayload: Buffer;
  try {
    exportPayload = decryptFramed(body, dataKey, aad);
  } catch {
    throw new ArchiveFormatError("archive body did not authenticate");
  }

  return {
    manifest,
    exportPayload,
    secretKey: record.secretKey,
    masterKey: record.masterKey,
  };
}

/**
 * §4.2.2's fingerprint gate, run BEFORE anything else in a restore. Compares
 * the archive's key record fingerprint against the running instance's own
 * `SECRET_KEY`. On mismatch throws {@link KeyFingerprintMismatchError} and
 * nothing is written — the restore never adopts key material from an
 * uploaded file (§4.2.1: an archive from elsewhere is untrusted input).
 */
export function assertFingerprintMatches(
  opened: OpenedArchive,
  runningSecretKey: Buffer,
): void {
  const running = computeKeyFingerprint(runningSecretKey);
  const archiveFp = computeKeyFingerprint(opened.secretKey);
  if (!fingerprintsMatch(running, archiveFp)) {
    throw new KeyFingerprintMismatchError();
  }
}

/**
 * `secret:recover` (D-166 §2.3): unwraps ONLY the key record's `secretKey`,
 * given the archive and token, without requiring the running instance's key to
 * match anything. This is the one path that lets an operator recover
 * `SECRET_KEY` after generating a fresh one by mistake.
 */
export function recoverSecretKeyFromArchive(
  archive: Buffer,
  tokenRaw: Buffer,
): Buffer {
  return openArchive(archive, tokenRaw).secretKey;
}

/** A fresh recovery token plus the master key it will wrap, for `setup:init`
 * and for the admin UI's "generate a new Recovery Kit token" action. Exposed
 * here rather than duplicated at each call site. */
export function generateRecoveryKitToken(): {
  readonly formatted: string;
  readonly raw: Buffer;
} {
  return generateRecoveryToken();
}
