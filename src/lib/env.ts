/**
 * Startup environment validation.
 *
 * D-037 permits an application-owned environment variable only when the value
 * must be known before the database can be read, or when it determines where
 * persistent state lives. The list below is the whole of that surface today;
 * adding an entry requires an ADR, and everything else is a database-backed
 * setting (`@/lib/settings`).
 *
 * These were previously validated only the first time Better Auth handled a
 * request, which turns a misconfigured deployment into a confusing runtime 500
 * instead of a clear boot-time failure. `assertRequiredEnv` fails fast: it is
 * called once from `instrumentation.ts`, before the server accepts traffic.
 */

const REQUIRED_ENV_VARS = [
  /**
   * Where persistent state lives, as the RUNTIME role — which owns nothing and
   * holds neither UPDATE nor DELETE on `AuditEvent` (D-116, D-149 part 2). No
   * default — see `@/lib/database/client`.
   */
  "DATABASE_URL",
  /**
   * The second credential D-182 requires: the retention role, which holds the
   * only `DELETE` on `AuditEvent`, and through which migrations run as the
   * non-connecting schema owner.
   *
   * REQUIRED AT BOOT, not merely when retention runs. D-181 makes upgrades
   * apply migrations unattended, so an instance missing this variable would
   * start fine, serve fine, and then fail at the moment recovery is hardest —
   * the next upgrade, against a schema the image has already moved past. A
   * missing credential should be a refusal to start, which is one line in a
   * `.env` to fix.
   *
   * ADR-0002 §8 is the ADR D-037 requires for it.
   */
  "DATABASE_MAINTENANCE_URL",
  /** Cookie/redirect origin and the WebAuthn relying-party id (D-132). */
  "BETTER_AUTH_URL",
] as const;

/**
 * The bootstrap secret, in the two shapes D-112 accepts: `SECRET_KEY_FILE`
 * (the documented one — a mounted file or Docker secret) and a plain
 * `SECRET_KEY` (deprecated, kept so an install supplying it is not bricked).
 * Exactly one of them must be present.
 *
 * `BETTER_AUTH_SECRET` IS DELIBERATELY NOT HERE ANY MORE. D-112 makes the
 * Better Auth signing secret a DERIVATION of this one root — see
 * `@/lib/crypto/secret-key` for why two independent secrets is the failure
 * mode, not the safe option.
 *
 * Only the PRESENCE of a variable is checked here. Whether the file exists and
 * decodes to usable key material is checked by `loadBootstrapSecret()` in
 * `instrumentation.ts`, which runs on the Node.js runtime only — this module is
 * also evaluated on the Edge runtime, where `node:fs` is not available.
 */
const BOOTSTRAP_SECRET_VARS = ["SECRET_KEY_FILE", "SECRET_KEY"] as const;

/** Throws if any required environment variable is missing or empty. */
export function assertRequiredEnv(
  env: Record<string, string | undefined> = process.env,
): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        "See .env.example.",
    );
  }

  if (!BOOTSTRAP_SECRET_VARS.some((key) => env[key]?.trim())) {
    throw new Error(
      "The bootstrap secret is not configured: set SECRET_KEY_FILE to a file " +
        "holding it (D-112). Generate one with `npm run secret:init -- " +
        "./secrets/secret_key`. The plain SECRET_KEY variable is accepted as a " +
        "deprecated fallback. See .env.example.",
    );
  }
}
