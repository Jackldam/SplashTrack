/**
 * The Recovery Kit's two-level key envelope (D-114, amended by D-166 —
 * `docs/design/14-backup-restore-upgrade.md` §2.1 and §2.3).
 *
 * ```text
 * recovery token  ──Argon2id──▶  KEK  ──unwraps──▶  key record
 *                                                      │  { masterKey, secretKey, keyFingerprint }
 *                                                 unwraps per-archive data key
 *                                                      │
 *                                            framed AEAD over the archive body
 *                                                (see ./framed-aead.ts)
 * ```
 *
 * TWO LEVELS, NOT ONE (D-114). The printed token is a PASSPHRASE — it derives a
 * key-encryption key, never key material itself — so it can be rotated
 * (re-wrap the key record under a new token; old archives, wrapped by the same
 * master key, stay readable) without re-encrypting a single archive already
 * written. Each archive carries its own random data key, wrapped by the master
 * key, so a leaked archive compromises only itself.
 *
 * THE KEY RECORD CARRIES `SECRET_KEY`, NOT ONLY THE MASTER KEY (D-166). An
 * earlier design wrapped only the backup master key, which recovers the
 * *archive* but not the instance's own root key — so a restore onto a fresh
 * `SECRET_KEY` (which `secret:init` must generate, since the application never
 * ships or guesses one) leaves every medical remark, every stored settings
 * secret and every TOTP enrolment permanently undecryptable while the restore
 * itself reports success (F-135). Carrying `SECRET_KEY` in the token-wrapped
 * record — never in the clear anywhere in the archive (D-113 stands, §3.1.1) —
 * is what makes "archive + token" sufficient on its own, which is D-040's whole
 * promise.
 *
 * ARGON2ID PARAMETERS (D-114 §2.1): `m = 64 MiB`, `t = 3`, `p = 1`, a 128-bit
 * random salt. Recorded beside the wrap so a future wrap can raise them without
 * invalidating archives already written — each `WrappedKeyRecord` is
 * self-describing.
 *
 * NATIVE `node:crypto` ARGON2ID. Node exposes `argon2Sync` natively (this
 * repository targets Node 24; verified present at the version pinned in
 * `Dockerfile`/`package.json`'s `engines`). No `argon2`/`libsodium-wrappers`
 * dependency was added for this — the KDF D-114 names is available without one,
 * and adding a native-binding dependency to a data-critical path this project
 * did not already carry is exactly the kind of retrofit-hostile choice
 * `CLAUDE.md` asks this build to avoid making casually.
 */

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  argon2Sync,
  timingSafeEqual,
} from "node:crypto";

const KEY_BYTES = 32;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const FINGERPRINT_BYTES = 16;

/** D-114 §2.1's fixed Argon2id parameters. Recorded per-wrap so a future
 * `key:rotate`/token-rotation can raise them without breaking older wraps. */
export interface Argon2Params {
  readonly memoryKiB: number;
  readonly passes: number;
  readonly parallelism: number;
}

export const DEFAULT_ARGON2_PARAMS: Argon2Params = {
  memoryKiB: 64 * 1024, // 64 MiB
  passes: 3,
  parallelism: 1,
};

/** Thrown when a wrapped record cannot be opened under the supplied token or
 * key — a wrong token, corruption, or an archive from elsewhere. ONE message
 * for every cause (see `envelope.ts`'s `open()`), so the failure cannot be used
 * as an oracle for which part was wrong. */
export class EnvelopeAuthenticationError extends Error {
  constructor(detail: string) {
    super(`Recovery envelope did not authenticate: ${detail}.`);
    this.name = "EnvelopeAuthenticationError";
  }
}

/** Derives the Argon2id KEK over the recovery token's raw entropy. */
function deriveKek(
  tokenRaw: Buffer,
  salt: Buffer,
  params: Argon2Params,
): Buffer {
  return Buffer.from(
    argon2Sync("argon2id", {
      message: tokenRaw,
      nonce: salt,
      memory: params.memoryKiB,
      passes: params.passes,
      parallelism: params.parallelism,
      tagLength: KEY_BYTES,
    }),
  );
}

function aesGcmSeal(key: Buffer, plaintext: Buffer, aad: Buffer): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
}

function aesGcmOpen(key: Buffer, sealed: Buffer, aad: Buffer): Buffer {
  if (sealed.length < NONCE_BYTES + TAG_BYTES) {
    throw new EnvelopeAuthenticationError("sealed value is too short");
  }
  const nonce = sealed.subarray(0, NONCE_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  const ciphertext = sealed.subarray(NONCE_BYTES, sealed.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new EnvelopeAuthenticationError("authentication tag mismatch");
  }
}

/**
 * The key-check fingerprint (D-166): `HKDF(secretKey, info="key-check-v1")`,
 * truncated to 16 bytes. A one-way function of `SECRET_KEY` — it identifies
 * WHICH key an archive needs without revealing it, travels in the clear in the
 * archive header, and is what §4.2.2's fingerprint gate compares against the
 * running instance before anything is written.
 */
export function computeKeyFingerprint(secretKey: Buffer): Buffer {
  return Buffer.from(
    hkdfSync("sha256", secretKey, Buffer.alloc(0), "key-check-v1", KEY_BYTES),
  ).subarray(0, FINGERPRINT_BYTES);
}

/** True fingerprints match, compared in constant time. */
export function fingerprintsMatch(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The plaintext contents of the key record (D-166) — never serialized outside
 * the wrap below. */
export interface KeyRecord {
  readonly masterKey: Buffer;
  readonly secretKey: Buffer;
  readonly keyFingerprint: Buffer;
}

/** The key record as it travels in the archive header: everything needed to
 * unwrap it given the recovery token, plus the cleartext fingerprint. */
export interface WrappedKeyRecord {
  readonly salt: Buffer;
  readonly argon2Params: Argon2Params;
  readonly sealed: Buffer;
  /** Cleartext — see `computeKeyFingerprint`'s doc comment for why this one
   * field sits outside the wrap. */
  readonly keyFingerprint: Buffer;
}

/**
 * Wraps a key record under a fresh Argon2id KEK derived from the recovery
 * token. `aad` binds the wrap to the archive's manifest digest (D-166: "the
 * record is bound as AAD to the archive's manifest digest, so it cannot be
 * spliced from one archive into another").
 */
export function wrapKeyRecord(
  record: KeyRecord,
  tokenRaw: Buffer,
  aad: Buffer,
  params: Argon2Params = DEFAULT_ARGON2_PARAMS,
): WrappedKeyRecord {
  const salt = randomBytes(SALT_BYTES);
  const kek = deriveKek(tokenRaw, salt, params);
  const plaintext = Buffer.concat([record.masterKey, record.secretKey]);
  const sealed = aesGcmSeal(kek, plaintext, aad);
  return {
    salt,
    argon2Params: params,
    sealed,
    keyFingerprint: record.keyFingerprint,
  };
}

/**
 * Unwraps a key record given the recovery token and the same AAD it was
 * wrapped under. Throws {@link EnvelopeAuthenticationError} on a wrong token,
 * a wrong AAD (the record was spliced from another archive), or corruption.
 */
export function unwrapKeyRecord(
  wrapped: WrappedKeyRecord,
  tokenRaw: Buffer,
  aad: Buffer,
): KeyRecord {
  const kek = deriveKek(tokenRaw, wrapped.salt, wrapped.argon2Params);
  const plaintext = aesGcmOpen(kek, wrapped.sealed, aad);
  if (plaintext.length !== KEY_BYTES * 2) {
    throw new EnvelopeAuthenticationError("unwrapped record has wrong length");
  }
  const masterKey = plaintext.subarray(0, KEY_BYTES);
  const secretKey = plaintext.subarray(KEY_BYTES);
  return { masterKey, secretKey, keyFingerprint: wrapped.keyFingerprint };
}

/** Wraps a fresh per-archive data key (D-114) under the master key. AES-256-GCM,
 * random nonce — the master key never wraps more than one thing per archive, so
 * nonce reuse across data-key wraps cannot happen within one archive; across
 * archives, a fresh random nonce per wrap is the ordinary AEAD requirement. */
export function wrapDataKey(dataKey: Buffer, masterKey: Buffer): Buffer {
  return aesGcmSeal(masterKey, dataKey, Buffer.alloc(0));
}

export function unwrapDataKey(sealed: Buffer, masterKey: Buffer): Buffer {
  return aesGcmOpen(masterKey, sealed, Buffer.alloc(0));
}

/** A fresh random 256-bit key — used for both the master key (once, at
 * setup) and each archive's data key (every backup). */
export function generateKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

export { KEY_BYTES as BACKUP_KEY_BYTES };
