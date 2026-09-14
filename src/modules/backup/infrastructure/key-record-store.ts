/**
 * Persists the ONE token-wrapped key record every archive embeds (D-114 —
 * "stored wrapped by a KDF over the printed recovery token") — see
 * `../domain/archive-format.ts`'s module doc, "THE KEY RECORD IS WRAPPED
 * ONCE, NOT PER ARCHIVE", for the full argument.
 *
 * STORED AS A FILE UNDER `$DATA_DIR`, NOT IN THE DATABASE. Two reasons:
 *
 *   - `$DATA_DIR` already holds the ONE other piece of state that must exist
 *     before — or independently of — the database (`@/lib/setup/data-dir.ts`:
 *     the setup token; `@/lib/crypto/secret-key.ts`: `SECRET_KEY_FILE`,
 *     conventionally alongside it). The wrapped key record belongs to the same
 *     family: it must be readable to build a backup even when nothing about
 *     the database's own state is trusted yet.
 *   - It is EXCLUDED from the archive's own asset capture, on the same D-113
 *     basis as `SECRET_KEY_FILE` — not because its bytes are cleartext key
 *     material (they are not; they are Argon2id-sealed ciphertext, safe to
 *     store casually by D-114's own design), but so there is exactly ONE rule
 *     ("nothing under the key-material path ships in an archive") rather than
 *     a second, narrower one for "except this file, which is fine actually".
 *     `backup-service.ts`'s asset capture (§3.1, when it walks `$DATA_DIR` for
 *     uploaded assets) MUST exclude this path the same way it excludes
 *     `SECRET_KEY_FILE` — flagged here for that call site.
 *
 * FILE FORMAT: one JSON object, mode 0600 — `{ saltHex, argon2Params,
 * sealedHex, keyFingerprintHex }`, exactly `WrappedKeyRecord`'s own shape
 * hex-encoded, so this file is a direct, inspectable analogue of the
 * archive header's own `wrappedKeyRecord` section.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

import type { Argon2Params, WrappedKeyRecord } from "@/lib/crypto/backup-envelope";
import { dataDir, type SetupEnv } from "@/lib/setup/data-dir";

interface StoredWrappedKeyRecord {
  saltHex: string;
  argon2Params: Argon2Params;
  sealedHex: string;
  keyFingerprintHex: string;
}

/** The file's path — also the path `backup-service.ts`'s (future) asset
 * capture must exclude, alongside `SECRET_KEY_FILE`. */
export function keyRecordStorePath(env: SetupEnv = process.env): string {
  return path.join(dataDir(env), "backup-key-record.json");
}

/** True once a wrapped key record has been stored — the diagnostics-page
 * check §2.2 asks for ("recovery token acknowledged: yes/no"), at the file
 * level. */
export function hasWrappedKeyRecord(env: SetupEnv = process.env): boolean {
  return existsSync(keyRecordStorePath(env));
}

/** Writes the wrap. Refuses to overwrite an existing one — replacing it
 * without the OLD token first (a genuine "rotate the token" flow, not yet
 * built — flagged) would strand every archive already written under the old
 * wrap's master key if the master key also changed; since the master key here
 * is HKDF-derived from `SECRET_KEY` (`../application/backup-service.ts`), the
 * SAME master key survives a re-wrap, so this restriction is conservative
 * rather than load-bearing crypto — it exists so an accidental double-write
 * cannot orphan the printed token silently. */
export function storeWrappedKeyRecord(
  record: WrappedKeyRecord,
  env: SetupEnv = process.env,
): void {
  const target = keyRecordStorePath(env);
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  if (existsSync(target)) {
    throw new Error(
      `A Recovery Kit key record already exists at ${target}. Overwriting it ` +
        "without a deliberate token-rotation flow would orphan the printed " +
        "token. This is not built yet — flagged in the phase report.",
    );
  }
  const stored: StoredWrappedKeyRecord = {
    saltHex: record.salt.toString("hex"),
    argon2Params: record.argon2Params,
    sealedHex: record.sealed.toString("hex"),
    keyFingerprintHex: record.keyFingerprint.toString("hex"),
  };
  writeFileSync(target, JSON.stringify(stored), { mode: 0o600, flag: "wx" });
}

export class MissingWrappedKeyRecordError extends Error {
  constructor(target: string) {
    super(
      `No Recovery Kit key record found at ${target}. Generate one first — ` +
        "the admin UI's \"Set up the Recovery Kit\" action, or the CLI's " +
        "`splashtrack backup:init-token`.",
    );
    this.name = "MissingWrappedKeyRecordError";
  }
}

/** Reads the wrap back. Throws {@link MissingWrappedKeyRecordError} if none
 * has been generated yet — a backup cannot be built without it. */
export function readWrappedKeyRecord(
  env: SetupEnv = process.env,
): WrappedKeyRecord {
  const target = keyRecordStorePath(env);
  if (!existsSync(target)) {
    throw new MissingWrappedKeyRecordError(target);
  }
  const stored = JSON.parse(readFileSync(target, "utf8")) as StoredWrappedKeyRecord;
  return {
    salt: Buffer.from(stored.saltHex, "hex"),
    argon2Params: stored.argon2Params,
    sealed: Buffer.from(stored.sealedHex, "hex"),
    keyFingerprint: Buffer.from(stored.keyFingerprintHex, "hex"),
  };
}
