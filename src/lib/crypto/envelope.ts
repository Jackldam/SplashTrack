/**
 * The encryption envelope (D-096, as corrected by D-167; decryptor registry
 * D-097). Every encrypted value in this product is written and read here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FORMAT
 *
 *     v1:<keyId>:<nonce>:<ct>
 *
 * `nonce` and `ct` are base64url without padding; `ct` is the AES-256-GCM
 * ciphertext with its 16-byte authentication tag appended. The value is
 * authenticated with **AAD binding `(columnId, primary key, keyId)`**.
 *
 * Both halves are load-bearing, and D-096 says why:
 *
 *   - **The key id.** A rotation interrupted at 60% — container restart, OOM,
 *     an upgrade — leaves two keys in one column with no discriminator. Both
 *     decryptors are present; neither knows which applies, and every failed
 *     decrypt is indistinguishable from corruption. With a key id, rotation is
 *     resumable and observable: "how many rows remain under keyId=1" is a
 *     query.
 *   - **The AAD.** Without it a `v1:` blob is PORTABLE. Anyone with a SQL write
 *     primitive — or a careless de-duplication script — can copy child A's
 *     encrypted allergy note into child B's row, where it decrypts perfectly
 *     and authenticates. A child with a severe nut allergy is recorded as
 *     having none. Column encryption is assumed to prevent exactly this and,
 *     without AAD, does not.
 *
 * **The AAD binds the `columnId`, never the physical table and column name**
 * (D-167). See `./encrypted-columns.ts` for why, and for the one obligation
 * that survives: a migration that changes a row's primary key must decrypt and
 * re-encrypt inside the same migration.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO IMPLEMENTATION CHOICES THE DESIGN LEAVES OPEN, FIXED HERE FOREVER
 *
 *   1. **The AAD byte encoding** is `JSON.stringify([columnId, primaryKey,
 *      keyId])` in UTF-8 — exactly the three components D-096 names, in the
 *      order it names them. JSON quoting is what makes the concatenation
 *      unambiguous: a delimiter-joined string would let a crafted primary key
 *      containing the delimiter impersonate a different binding.
 *   2. **`keyId` names a generation of `SECRET_KEY`,** not a purpose. Purposes
 *      are HKDF `info` labels and are per-column (D-112); the key id is what a
 *      future `key:rotate` increments when the root secret changes. Today the
 *      keyring holds exactly one generation, `"1"`. An envelope naming a key id
 *      the keyring does not hold REFUSES — it does not fall back to the current
 *      key, because a successful decrypt under the wrong key is impossible and
 *      a silent null is exactly what D-166 forbids.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * D-166: ANYTHING THAT CANNOT DECRYPT REFUSES, LOUDLY
 *
 * Every failure path here throws {@link DecryptionRefusedError}. None returns
 * null, an empty string or the ciphertext. That rule is not stylistic: D-166
 * exists because a restore once reported success — row counts and schema green
 * — on an instance where every medical, pastoral, assessment and inquiry value
 * was permanently undecryptable. A decrypt helper that returns null on failure
 * is how that reappears one caller at a time.
 *
 * SERVER-ONLY.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import {
  encryptedColumn,
  type EncryptedColumnId,
  type EncryptedColumnRegistry,
  ENCRYPTED_COLUMNS,
} from "./encrypted-columns";
import { deriveKey, loadBootstrapSecret, type KeyPurpose } from "./secret-key";

/** Every ciphertext format this application has ever written (D-049/D-097). */
export const FORMAT_VERSIONS = ["v1"] as const;
export type FormatVersion = (typeof FORMAT_VERSIONS)[number];

/** The format NEW values are written in. Reading is never limited to it. */
export const CURRENT_FORMAT: FormatVersion = "v1";

/** AES-256-GCM parameters. Fixed for `v1`. */
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** The key-id vocabulary: short, opaque, and free of the `:` separator. */
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * What a format tag looks like, independent of whether THIS version has a
 * decryptor for it. Deliberately wider than {@link FORMAT_VERSIONS}: a value
 * written by a newer version must be reported as "no decryptor for this
 * format — upgrade or restore", not as "not an envelope", because the two call
 * for opposite responses and only one of them is recoverable.
 */
const FORMAT_PATTERN = /^v\d+$/;

/**
 * The key-id of the current `SECRET_KEY` generation. Incremented by a future
 * `key:rotate`, which re-encrypts row by row and can report progress because
 * every envelope says which generation it was written under.
 */
export const CURRENT_KEY_ID = "1";

/**
 * A value that has been through the envelope. A branded string: the ONLY way to
 * obtain one is {@link seal}, so a repository whose column type is
 * `Sealed<"students.medical_remarks">` cannot be handed a plaintext by
 * accident. That is the "encrypting a field is the easy path and forgetting to
 * is not" property, expressed in the type system rather than in a convention.
 *
 * The brand is erased at runtime — it is a `string` in the database and in
 * Prisma. What it buys is that every write site had to call `seal`.
 */
declare const sealedBrand: unique symbol;
export type Sealed<C extends string = EncryptedColumnId> = string & {
  readonly [sealedBrand]: C;
};

/** A value could not be decrypted, for any reason. Never swallowed. */
export class DecryptionRefusedError extends Error {
  constructor(detail: string) {
    super(
      `Refusing to decrypt: ${detail}. This is never recovered from by ` +
        "returning null or the raw value — an unreadable protected value is " +
        "reported, not hidden (D-166).",
    );
    this.name = "DecryptionRefusedError";
  }
}

/** The envelope names a key generation this instance does not hold. */
export class UnknownKeyIdError extends DecryptionRefusedError {
  constructor(keyId: string) {
    super(
      `the value was written under key id "${keyId}", which this instance ` +
        "does not hold. That is an interrupted rotation or a foreign value, " +
        "not corruption, and it is not fixed by trying the current key",
    );
    this.name = "UnknownKeyIdError";
  }
}

/**
 * Where key material for a generation comes from.
 *
 * Injectable so the committed golden vectors (D-097) and the wrong-key refusal
 * test run against fixed public key material, and so a future `key:rotate` can
 * hold the outgoing generation alongside the incoming one.
 */
export interface Keyring {
  /** The generation new values are written under. */
  readonly currentKeyId: string;
  /** Key material, or throw {@link UnknownKeyIdError}. */
  keyFor(keyId: string, purpose: KeyPurpose): Buffer;
}

/**
 * A keyring over one generation of key material. `createProcessKeyring()` is
 * this over the instance's own `SECRET_KEY`.
 */
export function createKeyring(
  secret: Buffer,
  keyId: string = CURRENT_KEY_ID,
): Keyring {
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new Error(
      `Invalid key id "${keyId}": it is written into the envelope between ` +
        "colon separators and must match /^[A-Za-z0-9_-]+$/.",
    );
  }
  return {
    currentKeyId: keyId,
    keyFor(requestedKeyId, purpose) {
      if (requestedKeyId !== keyId) throw new UnknownKeyIdError(requestedKeyId);
      return deriveKey(purpose, secret);
    },
  };
}

let processKeyring: Keyring | undefined;

/**
 * The instance's own keyring, derived from `SECRET_KEY` on first use. Throws
 * `MissingBootstrapSecretError` if the secret is not configured — which
 * `instrumentation.ts` has already turned into a boot failure, so reaching it
 * here means a non-HTTP entry point (a script, a migration) that has not been
 * configured.
 */
export function createProcessKeyring(): Keyring {
  processKeyring ??= createKeyring(loadBootstrapSecret(), CURRENT_KEY_ID);
  return processKeyring;
}

/** Drops the cached process keyring. TEST SEAM ONLY. */
export function resetProcessKeyring(): void {
  processKeyring = undefined;
}

/** Options every seal/open call may narrow, for tests and for rotation. */
export interface EnvelopeOptions {
  keyring?: Keyring;
  registry?: EncryptedColumnRegistry;
}

/**
 * The additional authenticated data for one value: exactly D-096's
 * `(columnId, primary key, keyId)`, JSON-encoded (see the header for why JSON
 * and not a delimiter).
 *
 * Exported because the AAD is the thing renames must not disturb, and
 * `tests/unit/envelope.test.ts` asserts that directly rather than only through
 * a round trip.
 */
export function encryptedColumnAad(
  columnId: string,
  primaryKey: string,
  keyId: string,
): Buffer {
  return Buffer.from(JSON.stringify([columnId, primaryKey, keyId]), "utf8");
}

interface ParsedEnvelope {
  format: FormatVersion;
  keyId: string;
  nonce: Buffer;
  ciphertext: Buffer;
}

/** A decryptor for one format version. */
type Decryptor = (parsed: ParsedEnvelope, aad: Buffer, key: Buffer) => string;

function decryptV1(parsed: ParsedEnvelope, aad: Buffer, key: Buffer): string {
  if (parsed.nonce.length !== NONCE_BYTES) {
    throw new DecryptionRefusedError(
      `the v1 nonce is ${parsed.nonce.length} bytes, expected ${NONCE_BYTES}`,
    );
  }
  if (parsed.ciphertext.length < TAG_BYTES) {
    throw new DecryptionRefusedError(
      "the v1 ciphertext is shorter than its authentication tag",
    );
  }

  const body = parsed.ciphertext.subarray(
    0,
    parsed.ciphertext.length - TAG_BYTES,
  );
  const tag = parsed.ciphertext.subarray(parsed.ciphertext.length - TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", key, parsed.nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    // GCM authentication failed. Deliberately ONE message for every cause —
    // wrong key, wrong column, wrong row, edited ciphertext — because they are
    // cryptographically indistinguishable and pretending otherwise would put a
    // guess in an error message an operator then trusts.
    throw new DecryptionRefusedError(
      "the value failed authentication. It was written under a different key " +
        "generation, bound to a different column or row, or has been modified",
    );
  }
}

/**
 * THE DECRYPTOR REGISTRY (D-097). One entry per format ever shipped, and
 * entries are never removed: D-048/D-049 oblige every later version to keep
 * reading every format written before it, and a backup contains ciphertext. The
 * committed golden vectors in `tests/fixtures/crypto-golden-vectors.json` are
 * what turn that obligation into a check — deleting a decryptor breaks the
 * build rather than a restore.
 *
 * The template had one decryptor that threw on any format mismatch, in TWO
 * independent copies with different HKDF labels. This is the single home D-097
 * requires.
 */
export const DECRYPTORS: Readonly<Record<FormatVersion, Decryptor>> = {
  v1: decryptV1,
};

/** True if `value` has the shape of an envelope this application wrote. */
export function isSealedEnvelope(value: string): boolean {
  const parts = value.split(":");
  return (
    parts.length === 4 &&
    FORMAT_PATTERN.test(parts[0]) &&
    KEY_ID_PATTERN.test(parts[1]) &&
    parts[2].length > 0 &&
    parts[3].length > 0
  );
}

/**
 * Asserts a value read from the database is an envelope and not a plaintext
 * that reached a protected column by another route — a hand-run `UPDATE`, an
 * import, a migration that forgot to encrypt. Without this, such a value would
 * fail decryption with the same message as tampering; with it, the report names
 * the real problem.
 */
export function assertSealedEnvelope(
  columnId: string,
  value: string,
): asserts value is Sealed {
  if (!isSealedEnvelope(value)) {
    throw new DecryptionRefusedError(
      `the stored value for "${columnId}" is not an envelope. A protected ` +
        "column holds only values written through `seal`; a plaintext here " +
        "means something wrote around the envelope",
    );
  }
}

function parse(columnId: string, value: string): ParsedEnvelope {
  assertSealedEnvelope(columnId, value);
  const [format, keyId, nonce, ciphertext] = value.split(":");
  if (!(format in DECRYPTORS)) {
    throw new DecryptionRefusedError(
      `format "${format}" has no decryptor. Every format ever shipped keeps ` +
        "one (D-049/D-097), so this value was written by a NEWER version " +
        "than the one reading it — restore, or upgrade, but do not discard it",
    );
  }
  return {
    format: format as FormatVersion,
    keyId,
    nonce: Buffer.from(nonce, "base64url"),
    ciphertext: Buffer.from(ciphertext, "base64url"),
  };
}

/**
 * Encrypts one value for one column of one row.
 *
 * `primaryKey` is the row's primary key, and it is authenticated: the value
 * cannot later be read against any other row. That is the binding that stops
 * one child's allergy note being copied into another's record, so passing a
 * placeholder or an empty string defeats the control rather than simplifying
 * the call.
 */
export function seal<C extends string>(
  columnId: C,
  primaryKey: string,
  plaintext: string,
  options: EnvelopeOptions = {},
): Sealed<C> {
  if (primaryKey.length === 0) {
    throw new Error(
      `seal("${columnId}") was called with an empty primary key. The primary ` +
        "key is authenticated data — it is what makes a ciphertext " +
        "non-portable between rows (D-096) — so it is never a placeholder.",
    );
  }

  const entry = encryptedColumn(
    columnId,
    options.registry ?? ENCRYPTED_COLUMNS,
  );
  const keyring = options.keyring ?? createProcessKeyring();
  const keyId = keyring.currentKeyId;
  const key = keyring.keyFor(keyId, entry.purpose);

  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(encryptedColumnAad(entry.columnId, primaryKey, keyId));
  const body = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const ciphertext = Buffer.concat([body, cipher.getAuthTag()]);

  return [
    CURRENT_FORMAT,
    keyId,
    nonce.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":") as Sealed<C>;
}

/**
 * Decrypts one value for one column of one row, or throws
 * {@link DecryptionRefusedError}.
 *
 * `columnId` and `primaryKey` must be the ones the value was sealed with. Only
 * the `columnId` is stable by construction; the primary key is the caller's
 * responsibility, and the migration rule in `./encrypted-columns.ts` is what
 * keeps it true across schema changes.
 */
export function open(
  columnId: string,
  primaryKey: string,
  value: string,
  options: EnvelopeOptions = {},
): string {
  const entry = encryptedColumn(
    columnId,
    options.registry ?? ENCRYPTED_COLUMNS,
  );
  const parsed = parse(entry.columnId, value);
  const keyring = options.keyring ?? createProcessKeyring();
  const key = keyring.keyFor(parsed.keyId, entry.purpose);
  const aad = encryptedColumnAad(entry.columnId, primaryKey, parsed.keyId);
  return DECRYPTORS[parsed.format](parsed, aad, key);
}

/**
 * Reads the key generation a stored value was written under, without
 * decrypting it. This is what makes a rotation observable: "how many rows
 * remain under keyId=1" is answerable from the column itself (D-096).
 */
export function keyIdOf(columnId: string, value: string): string {
  return parse(columnId, value).keyId;
}

/**
 * Constant-time comparison of two envelopes' ciphertext. Not used to decide
 * correctness — GCM already does that — but available to a future `key:rotate`
 * that must confirm it is not rewriting an identical value.
 */
export function envelopesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
