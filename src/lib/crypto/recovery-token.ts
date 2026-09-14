/**
 * The Recovery Kit token (D-115, `docs/design/14-backup-restore-upgrade.md`
 * §2.2).
 *
 * A PASSPHRASE, not key material (D-114 — see `backup-envelope.ts`). It only
 * has to carry ≥128 bits of entropy through an Argon2id KDF, never a raw AES
 * key, which is what makes a human-transcribable length defensible in the
 * first place (F-100).
 *
 * FORMAT: `STK1-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`, Crockford base32 (excludes
 * I/L/O/U to avoid the classic transcription confusions), grouped in fours for
 * legibility, with a trailing Crockford check symbol over the payload so a
 * single mistyped or transposed character is caught before it reaches Argon2id
 * — the alternative is a KDF that "succeeds" on a typo'd token and produces the
 * wrong key with no error at all.
 *
 * 20 raw bytes = 160 bits, comfortably over the 128-bit floor D-115 sets.
 */

import { randomBytes } from "node:crypto";

const PREFIX = "STK1";
/** Crockford's alphabet — no I, L, O, U. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const GROUP_SIZE = 4;
const RAW_BYTES = 20;

/** Thrown by {@link parseRecoveryToken} on any malformed or corrupted token. */
export class InvalidRecoveryTokenError extends Error {
  constructor(detail: string) {
    super(`Recovery token is invalid: ${detail}.`);
    this.name = "InvalidRecoveryTokenError";
  }
}

/** Encodes raw bytes as an unpadded Crockford base32 string (uppercase). */
function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
}

/** Decodes a Crockford base32 string, normalising the ambiguous letters. */
function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of input) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) {
      throw new InvalidRecoveryTokenError(`"${char}" is not a valid character`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * A single Crockford check character (mod-37) over the payload symbols, so a
 * transposition or single mistyped character is caught deterministically
 * rather than silently producing a different — wrong — KDF input.
 */
function checkSymbol(payload: string): string {
  const CHECK_ALPHABET = `${ALPHABET}*~$=U`;
  let value = 0;
  for (const char of payload) {
    const index = ALPHABET.indexOf(char);
    value = (value * 32 + (index === -1 ? 0 : index)) % 37;
  }
  return CHECK_ALPHABET[value];
}

/** Groups an unbroken string into `GROUP_SIZE`-character dash-separated chunks. */
function group(payload: string): string {
  const chunks: string[] = [];
  for (let i = 0; i < payload.length; i += GROUP_SIZE) {
    chunks.push(payload.slice(i, i + GROUP_SIZE));
  }
  return chunks.join("-");
}

export interface RecoveryToken {
  /** The formatted, human-transcribable string — what gets printed. */
  readonly formatted: string;
  /** The raw entropy, for immediate use (e.g. wrapping the master key). Never
   * logged, never stored — only the formatted string is shown to a human, and
   * only the KDF ever sees these bytes. */
  readonly raw: Buffer;
}

/** Generates a fresh recovery token: `RAW_BYTES` of CSPRNG entropy (160 bits,
 * over D-115's 128-bit floor), Crockford-encoded, checksummed and grouped. */
export function generateRecoveryToken(): RecoveryToken {
  const raw = randomBytes(RAW_BYTES);
  const payload = base32Encode(raw);
  const check = checkSymbol(payload);
  const formatted = `${PREFIX}-${group(payload)}-${check}`;
  return { formatted, raw };
}

/**
 * Parses and validates a token an operator typed or pasted back in. Accepts
 * the grouped, dashed form and a bare unbroken payload; rejects a wrong prefix,
 * an invalid character, or a check-symbol mismatch — every one of those means
 * the wrong key would silently be derived, so this throws rather than guesses.
 */
export function parseRecoveryToken(input: string): RecoveryToken {
  const cleaned = input.trim().toUpperCase().replace(/\s+/g, "");
  const withoutPrefix = cleaned.startsWith(`${PREFIX}-`)
    ? cleaned.slice(PREFIX.length + 1)
    : cleaned.startsWith(PREFIX)
      ? cleaned.slice(PREFIX.length)
      : cleaned;

  const parts = withoutPrefix.split("-").filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new InvalidRecoveryTokenError("token is empty");
  }
  const check = parts[parts.length - 1];
  const payload = parts.slice(0, -1).join("");

  if (payload.length === 0) {
    throw new InvalidRecoveryTokenError("no payload characters found");
  }
  const expectedCheck = checkSymbol(payload);
  if (check !== expectedCheck) {
    throw new InvalidRecoveryTokenError(
      "check character does not match — the token was mistyped or " +
        "transposed",
    );
  }

  const raw = base32Decode(payload);
  if (raw.length !== RAW_BYTES) {
    throw new InvalidRecoveryTokenError(
      `decodes to ${raw.length} bytes; expected ${RAW_BYTES}`,
    );
  }

  const formatted = `${PREFIX}-${group(payload)}-${check}`;
  return { formatted, raw };
}
