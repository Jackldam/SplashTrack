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

import { applyRoleModel } from "../src/lib/database/apply-role-model";
import {
  migrationUrlFrom,
  REFERENCE_OWNER_ROLE,
  roleNameFrom,
} from "../src/lib/database/role-model";
import {
  databaseNameOf,
  resolveTestDatabaseUrl,
  resolveTestMaintenanceUrl,
} from "../tests/setup/test-db-url";

async function ensureTestDatabaseExists(maintenanceUrl: string): Promise<void> {
  const dbName = databaseNameOf(maintenanceUrl);

  // Connect to the maintenance database (always present) to issue CREATE
  // DATABASE, which cannot run against the database being created.
  //
  // AS THE RETENTION ROLE, not the runtime one. CREATEDB lives there (ADR-0002
  // §6): the harness genuinely needs it, production genuinely does not, and the
  // two were only ever coupled by one role serving both. Keeping it off the
  // runtime role is what makes a checkout's runtime role identical in shape to
  // a production one, so a missing grant fails on a laptop rather than for the
  // first time after a deploy.
  const adminUrl = new URL(maintenanceUrl);
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
      // OWNER is the non-connecting owner role, so the schema and every table
      // in this database belong where ADR-0002 §3 requires — the precondition
      // without which D-149 part 2's REVOKE is decorative. `applyRoleModel`
      // asserts it afterwards rather than assuming it took.
      await client.query(
        `CREATE DATABASE "${dbName}" OWNER "${REFERENCE_OWNER_ROLE}"`,
      );
      console.log(`[setup-test-db] Created database "${dbName}".`);
    } else {
      console.log(`[setup-test-db] Database "${dbName}" already exists.`);
    }
  } finally {
    await client.end();
  }
}

function applyMigrations(maintenanceUrl: string): void {
  console.log(
    `[setup-test-db] Applying migrations to "${databaseNameOf(maintenanceUrl)}"...`,
  );
  // prisma.config.ts resolves env("DATABASE_MAINTENANCE_URL") and adds
  // `options=-c role=<owner>` to it; dotenv does not override an already-set
  // variable, so passing it here pins the CLI to the test database regardless
  // of what .env contains. It is the MAINTENANCE variable now, not
  // DATABASE_URL: the runtime role owns nothing and cannot migrate, which is
  // D-116 working rather than a gap.
  // Run Prisma's JS entrypoint directly with the current Node binary. Avoids
  // spawning `npx`/`npx.cmd` (which on Windows would require shell:true and trip
  // Node's DEP0190 warning) — fully cross-platform, no shell.
  const require = createRequire(import.meta.url);
  const prismaPkg = require.resolve("prisma/package.json");
  const prismaBin = path.join(path.dirname(prismaPkg), "build", "index.js");
  execFileSync(process.execPath, [prismaBin, "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_MAINTENANCE_URL: maintenanceUrl },
  });
}

/**
 * Empties the audit trail so the audit-export tests always start
 * below the export cap. See step 4 in the file header for why a FULL truncate is
 * the chain-safe choice. Idempotent — a no-op on an already-empty table.
 */
async function resetAuditTrail(maintenanceUrl: string): Promise<void> {
  // AS THE OWNER. TRUNCATE is a privilege NO application role holds on
  // `AuditEvent` — not the runtime role, which is append-only, and not the
  // retention role, which may only DELETE behind a checkpoint (D-168). Only
  // the table's owner can do this, and only the test harness ever should. That
  // this line needs the owner's identity is the control being real.
  const client = new Client({
    connectionString: migrationUrlFrom(maintenanceUrl, REFERENCE_OWNER_ROLE),
  });
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
  const maintenanceUrl = resolveTestMaintenanceUrl();

  await ensureTestDatabaseExists(maintenanceUrl);
  applyMigrations(maintenanceUrl);

  // Step 5, new with ADR-0002: the test database gets the SAME role model as a
  // real one. Not a nicety — every proof in
  // `tests/integration/database-role-model.test.ts` asserts what the runtime
  // role cannot do, and against an unprovisioned database those tests would
  // pass or fail for reasons that have nothing to do with production.
  const outcome = await applyRoleModel(maintenanceUrl, {
    owner: REFERENCE_OWNER_ROLE,
    app: roleNameFrom(testUrl),
    retention: roleNameFrom(maintenanceUrl),
  });
  if (outcome.failures.length > 0) {
    throw new Error(
      "The ADR-0002 role model is not in force on the test database:\n" +
        outcome.failures.map((failure) => `  - ${failure}`).join("\n"),
    );
  }
  console.log(
    `[setup-test-db] Role model applied as ${outcome.acting} ` +
      `(session ${outcome.session}).`,
  );

  await resetAuditTrail(maintenanceUrl);
  console.log("[setup-test-db] Test database ready.");
}

main().catch((error) => {
  console.error("[setup-test-db] Failed to prepare the test database:");
  console.error(error);
  process.exit(1);
});
