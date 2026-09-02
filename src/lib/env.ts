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
  /** Where persistent state lives. No default — see `@/lib/database/client`. */
  "DATABASE_URL",
  /** Read at Better Auth context construction, before any database read. */
  "BETTER_AUTH_SECRET",
  /** Cookie/redirect origin and the WebAuthn relying-party id (D-132). */
  "BETTER_AUTH_URL",
] as const;

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
}
