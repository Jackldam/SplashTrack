/**
 * Vitest setup file — loaded via `setupFiles` in vitest.config.ts BEFORE any
 * test module is evaluated.
 *
 * Responsibilities:
 *   1. Load `.env` into process.env (the same file dev uses) WITHOUT override,
 *      so shared runtime config (BETTER_AUTH_SECRET, BETTER_AUTH_URL, ...) is
 *      available to the tests.
 *   2. Pin `process.env.DATABASE_URL` to the dedicated `<dev-db-name>_test`
 *      database, derived+validated by resolveTestDatabaseUrl().
 *
 * Because this runs before each test file, and each test file's own
 * `import "dotenv/config"` uses the default (non-overriding) dotenv behaviour,
 * the DATABASE_URL pinned here is what `@/lib/database` reads at import time.
 * There is no code path by which the suite can reach the dev/prod database:
 * resolveTestDatabaseUrl throws unless the target database name ends in `_test`.
 */
import path from "node:path";

import { config as loadEnv } from "dotenv";

import { resolveTestDatabaseUrl } from "./test-db-url";

// Populate process.env from .env (non-overriding, mirroring app/runtime).
loadEnv({ path: path.resolve(process.cwd(), ".env") });

// Force the suite onto the isolated test database (throws on any non-test URL).
process.env.DATABASE_URL = resolveTestDatabaseUrl();
