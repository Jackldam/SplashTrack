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
  //
  // IDEMPOTENT, deliberately. `tests/setup/test-env.ts` assigns the result back
  // to `process.env.DATABASE_URL`, so anything that resolves again afterwards —
  // `resolveTestMaintenanceUrl` does, to keep both connections on ONE database
  // — would otherwise derive `splashtrack_test_test` and fail against a
  // database that does not exist. A name that already ends in `_test` is
  // already the answer.
  url.pathname = devDbName.endsWith("_test")
    ? `/${devDbName}`
    : `/${devDbName}_test`;
  return assertTestDb(url.toString());
}

/**
 * The MAINTENANCE connection for the test database — the retention role
 * (ADR-0002 §7.4), pointed at the same `_test` database.
 *
 * The suite needs it for three things the runtime role deliberately cannot do,
 * and that is the point rather than an inconvenience:
 *
 *   - CREATE DATABASE, for the `_test` database itself and for the throwaway
 *     ones `boot-state-matrix` builds. CREATEDB sits on this role and never on
 *     the runtime role, so a checkout's runtime role is shaped EXACTLY like a
 *     production one (ADR-0002 §4, §6).
 *   - `prisma migrate deploy`, which must create tables owned by the
 *     non-connecting owner.
 *   - the audit-trail reset in `pretest`, which is a TRUNCATE — a privilege no
 *     application role holds on `AuditEvent` at all.
 *
 * Subject to the SAME `_test`-suffix guard as the runtime URL. That guard
 * matters more here, not less: this is the connection that can delete audit
 * rows.
 */
export function resolveTestMaintenanceUrl(env: EnvLike = process.env): string {
  const base = env.DATABASE_MAINTENANCE_URL;
  if (!base || base.length === 0) {
    throw new Error(
      "Cannot resolve the test maintenance URL: DATABASE_MAINTENANCE_URL is " +
        "not set. It is the second of the two credentials ADR-0002 requires, " +
        "and the suite can neither create nor migrate its test database " +
        "without it. Copy .env.example to .env before running tests.",
    );
  }

  // The database NAME comes from the runtime URL's own derivation, so the two
  // connections cannot be pointed at different databases by a stale
  // TEST_DATABASE_URL. They must be the same database, or the suite would be
  // asserting things about two unrelated ones.
  const url = new URL(base);
  url.pathname = `/${databaseNameOf(resolveTestDatabaseUrl(env))}`;
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
