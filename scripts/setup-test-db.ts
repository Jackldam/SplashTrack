/**
 * `pretest` step — prepares the isolated test database before vitest runs.
 *
 * Run via `npm test` (package.json `pretest` hook) with `tsx`. It is idempotent
 * and self-healing:
 *
 *   1. Derives+validates the test database URL from .env (same resolver the
 *      vitest setup file uses — so the "must end in _test" guard applies here
 *      too; this can never act on the dev database).
 *   2. Ensures the test database EXISTS, creating it if missing by connecting
 *      to the always-present `postgres` maintenance database on the same
 *      server. This covers already-initialised Postgres volumes where the
 *      docker-entrypoint-initdb.d init script never ran (it only runs on a fresh
 *      volume). On a fresh volume the init script creates the DB and this step
 *      is a no-op — either way the database is present.
 *   3. Applies migrations with `prisma migrate deploy` against the test database
 *      (mirrors the app container's migrate-on-boot pattern), so a brand-new,
 *      empty test database gets a full schema rather than failing at query
 *      time.
 *   4. Resets the audit trail (TRUNCATE "AuditEvent"). The test database
 *      PERSISTS across runs and audit rows are append-only, so they accumulate
 *      unbounded — and `verifyAuditChain` walks from genesis, so a chain
 *      carrying every row every prior run ever wrote gets slower and less
 *      meaningful with each one. Rows from a PRIOR run carry no meaning for a
 *      fresh run (every test seeds its own), and a FULL truncate is the only
 *      chain-safe reset: a partial delete would orphan `previousHash` links and
 *      make integrity verification report tampering that never happened. Runs
 *      in `pretest`, before vitest starts, so it only ever clears leftovers.
 *
 *      This is the TEST database and nothing else. The production audit trail is
 *      append-only by design (D-149) and is never truncated — retention there
 *      goes through checkpointing (D-168, phase 0.4), precisely so a legitimate
 *      retention run does not break the chain permanently.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

import { config as loadEnv } from "dotenv";
import { Client } from "pg";

import {
  databaseNameOf,
  resolveTestDatabaseUrl,
} from "../tests/setup/test-db-url";

async function ensureTestDatabaseExists(testUrl: string): Promise<void> {
  const dbName = databaseNameOf(testUrl);

  // Connect to the maintenance database (always present) to issue CREATE
  // DATABASE, which cannot run against the database being created.
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = "/postgres";

  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const existing = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName],
    );
    if (existing.rowCount === 0) {
      // dbName came from resolveTestDatabaseUrl(), which already validated it
      // ends in "_test" — not arbitrary user input — so inlining it is safe.
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log(`[setup-test-db] Created database "${dbName}".`);
    } else {
      console.log(`[setup-test-db] Database "${dbName}" already exists.`);
    }
  } finally {
    await client.end();
  }
}

function applyMigrations(testUrl: string): void {
  console.log(
    `[setup-test-db] Applying migrations to "${databaseNameOf(testUrl)}"...`,
  );
  // prisma.config.ts resolves env("DATABASE_URL"); dotenv does not override an
  // already-set variable, so passing DATABASE_URL here pins the CLI to the test
  // database regardless of what .env contains.
  // Run Prisma's JS entrypoint directly with the current Node binary. Avoids
  // spawning `npx`/`npx.cmd` (which on Windows would require shell:true and trip
  // Node's DEP0190 warning) — fully cross-platform, no shell.
  const require = createRequire(import.meta.url);
  const prismaPkg = require.resolve("prisma/package.json");
  const prismaBin = path.join(path.dirname(prismaPkg), "build", "index.js");
  execFileSync(process.execPath, [prismaBin, "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: testUrl },
  });
}

/**
 * Empties the audit trail so the audit-export tests always start
 * below the export cap. See step 4 in the file header for why a FULL truncate is
 * the chain-safe choice. Idempotent — a no-op on an already-empty table.
 */
async function resetAuditTrail(testUrl: string): Promise<void> {
  const client = new Client({ connectionString: testUrl });
  await client.connect();
  try {
    // BOTH tables, together. A checkpoint anchors verification at a sequence in
    // a trail that no longer exists once the events are truncated, so clearing
    // one and not the other leaves the next run reporting tampering that never
    // happened — the same orphaning hazard a partial delete has, one level up.
    await client.query('TRUNCATE TABLE "AuditEvent", "AuditCheckpoint"');
    console.log(
      '[setup-test-db] Reset the audit trail (TRUNCATE "AuditEvent", "AuditCheckpoint").',
    );
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  loadEnv({ path: path.resolve(process.cwd(), ".env") });
  const testUrl = resolveTestDatabaseUrl();
  await ensureTestDatabaseExists(testUrl);
  applyMigrations(testUrl);
  await resetAuditTrail(testUrl);
  console.log("[setup-test-db] Test database ready.");
}

main().catch((error) => {
  console.error("[setup-test-db] Failed to prepare the test database:");
  console.error(error);
  process.exit(1);
});
