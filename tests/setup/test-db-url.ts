/**
 * Single source of truth for the TEST database connection string.
 *
 * The test suite runs against a REAL Postgres database and several integration
 * tests wipe global platform tables. It must therefore NEVER resolve to the
 * development/production database. Rather than keep a separate `.env.test`
 * secret file, we DERIVE the test URL from the same `.env` the app already uses
 * (reusing its credentials, host and port) and forcibly swap the database name
 * to a dedicated, disposable `<dev-db-name>_test`.
 *
 * This is deliberately stricter than a fallback: `assertTestDb` refuses to
 * return any URL whose database name does not end in `_test`, so a
 * misconfigured environment fails LOUDLY instead of silently pointing the suite
 * at the dev database (the exact failure mode that caused real data loss).
 *
 * An explicit `TEST_DATABASE_URL` may be set to override the derivation (e.g. a
 * different host in CI), but it is subject to the same `_test`-suffix guard.
 */
type EnvLike = Record<string, string | undefined>;

/** Resolves (and validates) the URL the test suite must use. Throws on any
 *  configuration that would let tests reach a non-test database. */
export function resolveTestDatabaseUrl(env: EnvLike = process.env): string {
  const explicit = env.TEST_DATABASE_URL;
  if (explicit && explicit.length > 0) {
    return assertTestDb(explicit);
  }

  const base = env.DATABASE_URL;
  if (!base || base.length === 0) {
    throw new Error(
      "Cannot resolve the test database URL: neither TEST_DATABASE_URL nor " +
        "DATABASE_URL is set. Copy .env.example to .env before running tests.",
    );
  }

  const url = new URL(base);
  const devDbName = databaseNameOf(url.toString());
  // Reuse everything from the dev URL (user, password, host, port, params) and
  // ONLY replace the database name with the dedicated `<dev-db-name>_test`.
  url.pathname = `/${devDbName}_test`;
  return assertTestDb(url.toString());
}

/** Returns the database name portion of a Postgres URL. */
export function databaseNameOf(rawUrl: string): string {
  return new URL(rawUrl).pathname.replace(/^\/+/, "");
}

/** Guard: only ever hand back a URL that targets a dedicated test database. */
function assertTestDb(rawUrl: string): string {
  const name = databaseNameOf(rawUrl);
  if (!name.endsWith("_test")) {
    throw new Error(
      `Refusing to run tests against database "${name}". The suite may run ` +
        `ONLY against a database whose name ends in "_test" so it can never ` +
        `touch development or production data. Fix DATABASE_URL/TEST_DATABASE_URL.`,
    );
  }
  return rawUrl;
}
