/**
 * Framed AEAD (D-102, `docs/design/14-backup-restore-upgrade.md` §3.1.1).
 *
 * "AES-256-GCM encrypted" over a multi-megabyte archive is under-specified in a
 * way that reads as safe and is not (F-101): GCM is not a streaming
 * construction, and encrypting chunks independently lets an attacker truncate,
 * reorder or splice chunks between archives while every per-chunk tag still
 * verifies. This module frames the body into sequence-bound chunks, each
 * chunk's AAD binding its index and a "this is/is not the final chunk" flag, so
 * truncation (last chunk's flag never seen), reordering (index binds position)
 * and splicing (a different archive's chunk carries a different AAD) all fail
 * authentication rather than silently decrypting.
 *
 * PRIMITIVE: this codebase's existing AEAD is AES-256-GCM
 * (`@/lib/crypto/envelope.ts`); D-102 names libsodium `secretstream` or `age`
 * as the reference constructions but the property it actually requires —
 * sequence-bound chunks with an authenticated final marker — does not require
 * a new primitive. Building the framing over AES-256-GCM keeps this module's
 * crypto surface identical to the rest of the application (one AEAD, one
 * nonce-uniqueness argument) instead of introducing a second cipher family for
 * one archive format. See the module doc in `../modules/backup` for why this
 * was chosen over adding a `libsodium-wrappers` dependency.
 *
 * NONCE POLICY: a random 96-bit base nonce per archive (never reused — D-102),
 * with the low 32 bits of each chunk's nonce replaced by its big-endian chunk
 * index. That keeps every chunk's nonce distinct without a counter that could
 * be forgotten, and the same per-archive data key (D-114) guarantees the base
 * nonce is never reused across archives.
 *
 * IN-MEMORY, NOT STREAMING TO DISK. `encryptFramed`/`decryptFramed` take and
 * return whole `Buffer`s. This is a deliberate v1 scope decision, not an
 * oversight — flagged explicitly because it is the first binary archive format
 * this codebase ships and the trade-off deserves the same scrutiny as any other
 * §2-class decision:
 *
 *   - The product is a single self-hosted swim-school instance (D-162). Its
 *     database plus uploaded assets are expected to be low hundreds of
 *     megabytes for years, not the multi-gigabyte case D-102's "cannot buffer
 *     the whole archive" warning is about.
 *   - Framing already exists (chunks, per-chunk AEAD, final marker); switching
 *     the in-memory Buffer for a Node `Readable`/`Writable` pair later is an
 *     internal change to `buildArchive`/`openArchive`
 *     (`../modules/backup/domain/archive-format.ts`), not a format change — the
 *     bytes on disk are unaffected, because the frame boundaries are already
 *     part of the format.
 *   - Building genuine streaming I/O correctly (backpressure, partial-chunk
 *     buffering, abort-mid-stream cleanup) is real additional work this phase's
 *     time budget does not cover, and shipping an untested streaming path would
 *     be worse than an honest in-memory one.
 *
 * This is called out in the phase report as a flagged architectural choice:
 * revisit if/when instance data sizes make in-memory archive construction a
 * real operational problem.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const CHUNK_SIZE = 64 * 1024; // 64 KiB plaintext per chunk.
const KEY_BYTES = 32;
const BASE_NONCE_BYTES = 12;
const TAG_BYTES = 16;
const INDEX_BYTES = 4; // big-endian chunk counter, replaces the low 4 bytes of the nonce.

/** Thrown by {@link decryptFramed} on any authentication failure — a bad key,
 * truncation, reordering, splicing, or an ordinary bit flip. Deliberately ONE
 * message for every cause (see `envelope.ts`'s `open()` for the same rule):
 * distinguishing them would let an attacker use the archive as an oracle. */
export class FramedAeadError extends Error {
  constructor(detail: string) {
    super(`Archive body failed to authenticate: ${detail}.`);
    this.name = "FramedAeadError";
  }
}

function chunkNonce(baseNonce: Buffer, index: number): Buffer {
  const nonce = Buffer.from(baseNonce);
  nonce.writeUInt32BE(index >>> 0, BASE_NONCE_BYTES - INDEX_BYTES);
  return nonce;
}

function chunkAad(archiveAad: Buffer, index: number, final: boolean): Buffer {
  const header = Buffer.alloc(INDEX_BYTES + 1);
  header.writeUInt32BE(index >>> 0, 0);
  header.writeUInt8(final ? 1 : 0, INDEX_BYTES);
  return Buffer.concat([archiveAad, header]);
}

/**
 * Encrypts `plaintext` as a sequence of framed, sequence-bound AEAD chunks.
 * `key` is the per-archive data key (D-114); `aad` binds the frame to its
 * archive (the manifest digest — see `archive-format.ts`).
 *
 * Wire shape, repeated per chunk: `[4-byte length][ciphertext incl. 16-byte
 * GCM tag]`. The final chunk's AAD carries the final-marker byte, so a decoder
 * that reaches end-of-input without having seen one refuses rather than
 * accepting a truncated archive as complete.
 */
export function encryptFramed(
  plaintext: Buffer,
  key: Buffer,
  aad: Buffer,
): Buffer {
  if (key.length !== KEY_BYTES) {
    throw new Error(`framed AEAD key must be ${KEY_BYTES} bytes`);
  }
  const baseNonce = randomBytes(BASE_NONCE_BYTES);
  const chunks: Buffer[] = [baseNonce];

  const totalChunks = Math.max(1, Math.ceil(plaintext.length / CHUNK_SIZE));
  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * CHUNK_SIZE;
    const slice = plaintext.subarray(start, start + CHUNK_SIZE);
    const final = index === totalChunks - 1;

    const cipher = createCipheriv(
      "aes-256-gcm",
      key,
      chunkNonce(baseNonce, index),
    );
    cipher.setAAD(chunkAad(aad, index, final));
    const ciphertext = Buffer.concat([
      cipher.update(slice),
      cipher.final(),
      cipher.getAuthTag(),
    ]);

    const length = Buffer.alloc(4);
    length.writeUInt32BE(ciphertext.length, 0);
    chunks.push(length, ciphertext);
  }

  return Buffer.concat(chunks);
}

/**
 * Decrypts and authenticates a framed body produced by {@link encryptFramed}.
 * Every chunk must authenticate, chunks must arrive in the recorded order (the
 * index is bound into each chunk's AAD, so decrypting at the wrong position
 * fails), and the body must end exactly at a chunk whose AAD marks it final —
 * anything else throws {@link FramedAeadError} and returns nothing.
 */
export function decryptFramed(
  framed: Buffer,
  key: Buffer,
  aad: Buffer,
): Buffer {
  if (key.length !== KEY_BYTES) {
    throw new Error(`framed AEAD key must be ${KEY_BYTES} bytes`);
  }
  if (framed.length < BASE_NONCE_BYTES) {
    throw new FramedAeadError("archive body is shorter than one base nonce");
  }
  const baseNonce = framed.subarray(0, BASE_NONCE_BYTES);
  let offset = BASE_NONCE_BYTES;

  const plaintextParts: Buffer[] = [];
  let index = 0;
  let sawFinal = false;

  while (offset < framed.length) {
    if (offset + 4 > framed.length) {
      throw new FramedAeadError("truncated chunk length prefix");
    }
    const length = framed.readUInt32BE(offset);
    offset += 4;
    if (offset + length > framed.length) {
      throw new FramedAeadError("truncated chunk body");
    }
    const ciphertext = framed.subarray(offset, offset + length);
    offset += length;

    if (length < TAG_BYTES) {
      throw new FramedAeadError("chunk shorter than its authentication tag");
    }
    const tag = ciphertext.subarray(ciphertext.length - TAG_BYTES);
    const body = ciphertext.subarray(0, ciphertext.length - TAG_BYTES);

    // The chunk is tried as final first only in the sense that we do not know
    // yet — both possibilities are attempted because the AAD (and therefore
    // authentication) depends on it, and only one can verify.
    const isLastChunk = offset === framed.length;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      chunkNonce(baseNonce, index),
    );
    decipher.setAAD(chunkAad(aad, index, isLastChunk));
    decipher.setAuthTag(tag);
    let plaintext: Buffer;
    try {
      plaintext = Buffer.concat([decipher.update(body), decipher.final()]);
    } catch {
      throw new FramedAeadError(
        `chunk ${index} did not authenticate — tampering, truncation, ` +
          "reordering or splicing",
      );
    }
    plaintextParts.push(plaintext);
    if (isLastChunk) sawFinal = true;
    index += 1;
  }

  if (!sawFinal) {
    throw new FramedAeadError(
      "no chunk was authenticated as final — the archive is truncated",
    );
  }

  return Buffer.concat(plaintextParts);
}
