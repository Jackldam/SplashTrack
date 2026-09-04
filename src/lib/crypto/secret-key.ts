/**
 * The bootstrap secret and every key derived from it (D-112).
 *
 * `13-configuration-and-setup.md` §3.1.1 is the single authoritative statement
 * of this key's lifecycle, and this file is its implementation. There is
 * exactly ONE bootstrap secret, `SECRET_KEY`. It is the root of every key the
 * application uses — including the Better Auth signing secret, which is DERIVED
 * from it rather than configured separately:
 *
 *     SECRET_KEY  (32 random bytes, operator-held, supplied via SECRET_KEY_FILE)
 *        ├─ HKDF-SHA256(info="auth-signing-v1")    → Better Auth signing secret
 *        ├─ HKDF-SHA256(info="totp-v1")            → TOTP secret encryption
 *        ├─ HKDF-SHA256(info="settings-secret-v1") → SMTP / OAuth / registry secrets
 *        ├─ HKDF-SHA256(info="medical-v1")         → special-category columns
 *        ├─ HKDF-SHA256(info="backup-master-v1")   → backup master key (D-114)
 *        └─ HKDF-SHA256(info="audit-anchor-v1")    → audit checkpoint MAC (D-168)
 *
 * WHY THE DERIVATION MATTERS, and why `BETTER_AUTH_SECRET` is gone. The
 * template had no `SECRET_KEY` at all: at-rest encryption derived from
 * `BETTER_AUTH_SECRET`, which ALSO signed sessions and encrypted TOTP secrets.
 * Both readings of "is `SECRET_KEY` that value?" fail (F-95). Same value ⇒ the
 * Recovery Kit prints a session-forging key on paper. Different values ⇒ a
 * restore supplies `SECRET_KEY` while the fresh container holds a NEW
 * `BETTER_AUTH_SECRET`, so every TOTP enrolment and every Better
 * Auth-encrypted value in the restored archive is silently dead — while MFA is
 * mandatory for administrators, so the Recovery Kit fails at precisely the
 * moment it exists for. Deriving the signing secret means a restore reproduces
 * it IDENTICALLY, and it is not a second variable an operator can get out of
 * step (D-166).
 *
 * SUPPLIED AS A FILE, NOT AN ENVIRONMENT VARIABLE. `SECRET_KEY_FILE` names a
 * mounted file or Docker secret. An environment variable is readable via
 * `docker inspect`, `/proc/<pid>/environ`, crash dumps and — most commonly —
 * the operator's own `docker-compose.yml` committed to a repository. A plain
 * `SECRET_KEY` variable is accepted as a DEPRECATED fallback and reports itself
 * through {@link describeSecretKeySource} so the diagnostics page can warn.
 *
 * The application NEVER generates the bootstrap secret. With neither variable
 * set, every derivation throws — see {@link MissingBootstrapSecretError} — and
 * `assertRequiredEnv` turns that into a boot failure rather than a surprise on
 * the first encrypted write.
 *
 * SERVER-ONLY. The secret is never logged, never serialized and never returned
 * from any API.
 */

import { hkdfSync } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The purpose labels a key may be derived under. FROZEN VOCABULARY: a label is
 * the `info` input to HKDF, so changing one changes the key and orphans every
 * value encrypted under it. Adding a label is additive and safe; editing or
 * removing one is not.
 *
 * The first five are D-112's own diagram, reproduced here so a future author
 * invents no second spelling of a label that already exists — `totp-v1` and
 * `backup-master-v1` have no consumer in this phase and are listed for exactly
 * that reason. `audit-anchor-v1` is D-168's checkpoint MAC. `fixture-v1` exists
 * only for the committed golden vectors (D-097) and is never used by a real
 * column; the registry sync test enforces that.
 */
export const KEY_PURPOSES = [
  "auth-signing-v1",
  "totp-v1",
  "settings-secret-v1",
  "medical-v1",
  "backup-master-v1",
  "audit-anchor-v1",
  "fixture-v1",
  /**
   * ADDED IN PHASE 1.1, for `PersonRelationship.evidence` (D-063) — the record
   * of HOW a guardian's authority claim was established.
   *
   * A LABEL OF ITS OWN rather than `medical-v1`, for the reason per-purpose
   * derivation exists at all. `medical-v1` is D-112's branch for
   * SPECIAL-CATEGORY columns (Art. 9): medical remarks, `SafetyNote`,
   * assessment remarks. Guardian evidence is not special category — it is
   * ordinary personal data that happens to be sensitive free text about a
   * family's legal arrangements. Deriving both from one branch would make a
   * single key the compromise point for two data classes with two lawful bases
   * and two retention policies, which is the same collapse `BETTER_AUTH_SECRET`
   * performed in the template (F-95), one layer down.
   *
   * Adding a label is additive and safe. The vocabulary is frozen against
   * EDITING and REMOVAL, because either orphans every value written under it.
   */
  "relationship-evidence-v1",
] as const;

export type KeyPurpose = (typeof KEY_PURPOSES)[number];

/** Every derived key is 256 bits — AES-256-GCM and HMAC-SHA256 both take it. */
export const DERIVED_KEY_BYTES = 32;

/**
 * The bootstrap secret is missing or unusable. Thrown rather than defaulted:
 * D-166's rule is that anything which cannot decrypt refuses loudly, and the
 * cheapest way to violate it is a helper that quietly derives from an empty
 * string.
 */
export class MissingBootstrapSecretError extends Error {
  constructor(detail: string) {
    super(
      `SECRET_KEY is not usable: ${detail}. Set SECRET_KEY_FILE to a file ` +
        "holding the bootstrap secret (see .env.example and " +
        "docs/design/13-configuration-and-setup.md §3.1.1). The application " +
        "never generates this key for you.",
    );
    this.name = "MissingBootstrapSecretError";
  }
}

/** Where the process got its bootstrap secret, for diagnostics. */
export interface SecretKeySource {
  kind: "file" | "environment";
  /** The path, when read from a file. Never the value. */
  path?: string;
  /** True for the deprecated plain-variable path, which must warn. */
  deprecated: boolean;
}

/**
 * The minimum accepted length of the raw secret, in bytes after decoding
 * whitespace-trimmed text. D-112 specifies 32 random bytes; anything shorter is
 * an operator mistake (an empty file, a truncated copy-paste) and must fail at
 * boot rather than silently produce a weak root key.
 */
const MIN_SECRET_BYTES = 32;

let cachedSecret: Buffer | undefined;
let cachedSource: SecretKeySource | undefined;

/**
 * Reads the bootstrap secret once per process and caches it. Callers should
 * prefer {@link deriveKey}; this is exported for the boot check and for tests
 * that need to assert the loading rules themselves.
 *
 * The returned buffer is the process's own copy — do not mutate it.
 */
export function loadBootstrapSecret(
  env: Record<string, string | undefined> = process.env,
): Buffer {
  if (cachedSecret) return cachedSecret;

  const { secret, source } = readBootstrapSecret(env);
  cachedSecret = secret;
  cachedSource = source;
  return secret;
}

/** How this process obtained its secret, or null if it has not needed it yet. */
export function describeSecretKeySource(): SecretKeySource | null {
  return cachedSource ?? null;
}

/**
 * Drops the cached secret. TEST SEAM ONLY — a running server reads the file
 * once at boot, deliberately, so a mid-flight change to the key cannot
 * half-apply across requests.
 */
export function resetBootstrapSecretCache(): void {
  cachedSecret = undefined;
  cachedSource = undefined;
}

function readBootstrapSecret(env: Record<string, string | undefined>): {
  secret: Buffer;
  source: SecretKeySource;
} {
  const filePath = env.SECRET_KEY_FILE?.trim();
  if (filePath) {
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch (error) {
      throw new MissingBootstrapSecretError(
        `SECRET_KEY_FILE points at ${filePath}, which could not be read ` +
          `(${(error as Error).message})`,
      );
    }
    return {
      secret: decodeSecret(raw, `the file at ${filePath}`),
      source: { kind: "file", path: filePath, deprecated: false },
    };
  }

  // The deprecated fallback. Accepted so an install supplying the plain
  // variable is not bricked; reported so the diagnostics page can say so.
  const inline = env.SECRET_KEY?.trim();
  if (inline) {
    return {
      secret: decodeSecret(inline, "the SECRET_KEY environment variable"),
      source: { kind: "environment", deprecated: true },
    };
  }

  throw new MissingBootstrapSecretError(
    "neither SECRET_KEY_FILE nor SECRET_KEY is set",
  );
}

/**
 * Interprets the stored text as key material. Base64 is the documented shape
 * (that is what `secret:init` writes), but a raw 32+ byte passphrase is
 * accepted too: HKDF extracts from arbitrary input keying material, so
 * rejecting it would only push operators into a worse workaround.
 *
 * The length floor is applied to whichever interpretation is used, so an
 * eight-character password cannot pose as a 32-byte key.
 */
function decodeSecret(raw: string, origin: string): Buffer {
  const text = raw.trim();
  if (text.length === 0) {
    throw new MissingBootstrapSecretError(`${origin} is empty`);
  }

  const base64 = Buffer.from(text, "base64");
  // Buffer.from ignores non-base64 characters instead of failing, so a
  // re-encode round trip is what actually decides whether this WAS base64.
  const looksBase64 =
    base64.length >= MIN_SECRET_BYTES &&
    base64.toString("base64").replace(/=+$/, "") ===
      text.replace(/\s+/g, "").replace(/=+$/, "");

  const material = looksBase64 ? base64 : Buffer.from(text, "utf8");
  if (material.length < MIN_SECRET_BYTES) {
    throw new MissingBootstrapSecretError(
      `${origin} decodes to ${material.length} bytes; at least ` +
        `${MIN_SECRET_BYTES} are required (D-112 specifies 32 random bytes)`,
    );
  }
  return material;
}

/**
 * HKDF-SHA256 over the bootstrap secret with a purpose label — the ONE
 * derivation every application key goes through (D-112).
 *
 * The salt is deliberately empty. HKDF's salt is optional by construction
 * (RFC 5869 §3.1) and a non-empty one would have to be stored somewhere, which
 * would add a second artefact to the Recovery Kit that D-166 exists to keep at
 * two. Domain separation comes from `info`, which is what `info` is for.
 *
 * Pass `secret` explicitly to derive from key material other than the process's
 * own — the golden-vector test and the wrong-key refusal test both do, and a
 * future `key:rotate` will need it for the outgoing generation.
 */
export function deriveKey(purpose: KeyPurpose, secret?: Buffer): Buffer {
  const ikm = secret ?? loadBootstrapSecret();
  return Buffer.from(
    hkdfSync("sha256", ikm, Buffer.alloc(0), purpose, DERIVED_KEY_BYTES),
  );
}

/**
 * The Better Auth signing secret, derived rather than configured (D-112).
 * Returned base64-encoded because Better Auth takes a string.
 *
 * CHANGING THE BOOTSTRAP SECRET CHANGES THIS VALUE, which invalidates every
 * live session and every Better Auth-encrypted value. That is the same blast
 * radius `BETTER_AUTH_SECRET` always had; what the derivation buys is that a
 * RESTORE reproduces it exactly, so the Recovery Kit works.
 */
export function deriveAuthSigningSecret(): string {
  return deriveKey("auth-signing-v1").toString("base64");
}
