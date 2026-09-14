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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE KEY RECORD IS WRAPPED ONCE, NOT PER ARCHIVE — RESOLVING A GAP §2/D-166
 * LEAVES OPEN
 *
 * D-166 says the record is "bound as AAD to the archive's manifest digest, so
 * it cannot be spliced from one archive into another" — read literally, that
 * means re-wrapping (a fresh Argon2id KDF pass, needing the RAW recovery
 * token) on every single backup. §5 (D-044) requires an AUTOMATIC
 * pre-migration backup at container start, with no operator present to type a
 * token, and §3.2 describes a SCHEDULED unattended backup with the same
 * requirement. Neither is buildable if every archive needs the raw token at
 * write time.
 *
 * D-114's own words resolve this, one paragraph over: the master key "is
 * generated at setup and stored wrapped by a KDF over the printed recovery
 * token" — STORED, past tense, once. This module takes that as authoritative:
 * `generateWrappedKeyRecord` runs ONCE (at setup, or whenever the operator
 * deliberately regenerates the Recovery Kit token), its output is PERSISTED
 * (`../infrastructure/key-record-store.ts`), and every subsequent archive —
 * on-demand or automatic — embeds that SAME wrap unchanged. The raw token is
 * therefore needed only twice in the whole lifecycle: once to CREATE the wrap,
 * and again at RESTORE time to open it. Never at ordinary backup time.
 *
 * The wrap is therefore bound to a FIXED, per-format AAD (`KEY_RECORD_AAD`)
 * rather than each archive's own manifest digest — it cannot BE bound to a
 * digest it does not yet know when it is computed once, ahead of any archive.
 * What this costs, stated plainly: splicing this SAME instance's OWN wrap
 * between its OWN archives is now a no-op (it unwraps to the identical master
 * key every time, so there is nothing to gain by doing it) rather than being
 * cryptographically prevented. Splicing a DIFFERENT instance's wrap into this
 * one still fails outright — it is sealed under THAT instance's own
 * token-derived KEK, which this instance's token does not open. That is the
 * property D-166 actually needs (an attacker cannot borrow key material across
 * instances); binding to a digest was one way to get it and not the only one.
 * Flagged here because the source document does not spell out the "wrapped
 * once, embedded many times" mechanics this forces — see the phase report.
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
  type WrappedKeyRecord as EnvelopeWrappedKeyRecord,
} from "@/lib/crypto/backup-envelope";
import { decryptFramed, encryptFramed } from "@/lib/crypto/framed-aead";
import { generateRecoveryToken } from "@/lib/crypto/recovery-token";

export const ARCHIVE_MAGIC = Buffer.from("STBAK1\0", "utf8");
export const ARCHIVE_FORMAT_VERSION = 1;

/** The fixed AAD the key record is bound to — see the module doc's "wrapped
 * once, not per archive" section for why this replaced a per-archive digest. */
export const KEY_RECORD_AAD = Buffer.from(
  "splashtrack-recovery-kit-key-record-v1",
  "utf8",
);

/**
 * Generates a fresh master key + wraps `{masterKey, secretKey}` under the
 * recovery token, ONCE — at setup, or whenever an operator deliberately
 * regenerates the Recovery Kit token. The result is meant to be PERSISTED
 * (`../infrastructure/key-record-store.ts`) and reused, unchanged, by every
 * archive built afterwards.
 */
export async function generateWrappedKeyRecord(
  tokenRaw: Buffer,
  secretKey: Buffer,
  masterKey: Buffer = generateKey(),
): Promise<EnvelopeWrappedKeyRecord> {
  const keyFingerprint = computeKeyFingerprint(secretKey);
  return wrapKeyRecord(
    { masterKey, secretKey, keyFingerprint },
    tokenRaw,
    KEY_RECORD_AAD,
  );
}

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
  /** The PERSISTED wrap from `generateWrappedKeyRecord` — see the module doc's
   * "wrapped once, not per archive" section. The raw recovery token is NOT an
   * input here; it was only needed to produce this wrap, earlier. */
  readonly wrappedKeyRecord: EnvelopeWrappedKeyRecord;
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
 * Builds one `.stbak` archive. `masterKey` is the running instance's own
 * master key; `wrappedKeyRecord` is the PERSISTED wrap produced once by
 * `generateWrappedKeyRecord` and embedded here unchanged (see the module
 * doc). A fresh per-archive data key is generated here and wrapped by the
 * master key.
 */
export function buildArchive(input: BuildArchiveInput): Buffer {
  const keyId = input.keyId ?? "1";
  const manifest: ArchiveManifest = {
    ...input.manifest,
    keyFingerprintHex: input.wrappedKeyRecord.keyFingerprint.toString("hex"),
  };
  const manifestJson = Buffer.from(JSON.stringify(manifest), "utf8");
  const digest = manifestDigest(manifestJson);

  const wrappedKeyRecord = input.wrappedKeyRecord;

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
export async function openArchive(
  archive: Buffer,
  tokenRaw: Buffer,
): Promise<OpenedArchive> {
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

  // §4.2 step 1: unwrap the key record. Bound to the FIXED `KEY_RECORD_AAD`
  // (see the module doc's "wrapped once, not per archive" section) — this wrap
  // was produced once, ahead of any archive, so it cannot be bound to a digest
  // it did not yet know.
  const wrappedKeyRecord = {
    salt: Buffer.from(header.wrappedKeyRecord.saltHex, "hex"),
    argon2Params: header.wrappedKeyRecord.argon2Params,
    sealed: Buffer.from(header.wrappedKeyRecord.sealedHex, "hex"),
    keyFingerprint: Buffer.from(
      header.wrappedKeyRecord.keyFingerprintHex,
      "hex",
    ),
  };

  // The AAD the MANIFEST and BODY (not the key record — see above) are bound
  // to. A wrong or tampered digest here simply fails every authentication
  // below, which is how a header edited in transit is caught rather than
  // trusted.
  const aad = Buffer.from(header.manifestDigestHex, "hex");

  let record: KeyRecord;
  try {
    record = await unwrapKeyRecord(wrappedKeyRecord, tokenRaw, KEY_RECORD_AAD);
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
export async function recoverSecretKeyFromArchive(
  archive: Buffer,
  tokenRaw: Buffer,
): Promise<Buffer> {
  return (await openArchive(archive, tokenRaw)).secretKey;
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
