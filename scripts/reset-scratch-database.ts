/**
 * Empties every application table in an already-migrated SCRATCH database,
 * in place — TRUNCATE, not drop-and-recreate.
 *
 *     npx tsx scripts/reset-scratch-database.ts splashtrack_scratch_e2e_test
 *
 * WHY NOT `scripts/recreate-database.ts` FOR THIS. That script does
 * `DROP DATABASE ... WITH (FORCE)`, and `FORCE` terminates every other backend
 * connected to the database first — which requires `pg_signal_backend` over
 * those OTHER sessions' role. The e2e harness's own `next start` server (a
 * DIFFERENT role, `splashtrack_app_dev`) is one of those other sessions by the
 * time `test.beforeAll` runs (Playwright's `webServer` starts before any spec
 * body), and the retention role recreate-database.ts connects as does not
 * hold that privilege over it — by the same least-privilege design ADR-0002
 * §6 argues for everywhere else. Granting it would be a security regression
 * to satisfy a test harness. TRUNCATE needs no such privilege: it locks the
 * tables, not the other session, and the app server's already-open connection
 * pool keeps working against the now-empty tables on its very next query.
 *
 * Only ever targets a database whose name matches the same
 * `splashtrack_(freshcheck|scratch|migrationcheck)...` pattern
 * `recreate-database.ts` restricts itself to, so this can never be pointed at
 * dev/prod by a slip of the shell either.
 */
import path from "node:path";

import { config as loadEnv } from "dotenv";
import { Client } from "pg";

import {
  migrationUrlFrom,
  REFERENCE_OWNER_ROLE,
} from "../src/lib/database/role-model";

const ALLOWED_NAME =
  /^splashtrack_(freshcheck|scratch|migrationcheck)[a-z0-9_]*$/;

async function main(): Promise<void> {
  loadEnv({ path: path.resolve(process.cwd(), ".env") });

  const name = process.argv[2];
  if (!name || !ALLOWED_NAME.test(name)) {
    throw new Error(
      `Refusing to reset "${name}". This script only ever truncates a scratch ` +
        `database matching ${ALLOWED_NAME}.`,
    );
  }

  const base = process.env.DATABASE_MAINTENANCE_URL;
  if (!base) throw new Error("DATABASE_MAINTENANCE_URL is not set.");

  const target = new URL(base);
  target.pathname = `/${name}`;
  // Double-checked, not just pattern-matched: the URL's own database name
  // must be the scratch name, so a caller cannot pass the right name on the
  // command line while DATABASE_MAINTENANCE_URL quietly points elsewhere.
  const actualName = target.pathname.replace(/^\/+/, "");
  if (actualName !== name) {
    throw new Error(
      `DATABASE_MAINTENANCE_URL resolves to "${actualName}", not "${name}".`,
    );
  }

  // AS THE OWNER, on the same reasoning `setup-test-db.ts`'s audit-trail reset
  // uses: TRUNCATE is a privilege no application role holds, and only the
  // table's owner may do it.
  const client = new Client({
    connectionString: migrationUrlFrom(target.toString(), REFERENCE_OWNER_ROLE),
  });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    if (rows.length > 0) {
      const tableList = rows.map((row) => `"${row.tablename}"`).join(", ");
      await client.query(
        `TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`,
      );
    }
    console.log(
      `[reset-scratch-database] Truncated ${rows.length} table(s) in "${name}".`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("[reset-scratch-database] Failed:");
  console.error(error);
  process.exit(1);
});
