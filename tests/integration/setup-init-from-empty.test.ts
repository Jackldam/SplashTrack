/**
 * `setup:init` on a GENUINELY EMPTY database, end to end, as a self-hoster runs
 * it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS PINS
 *
 * `setup:init` migrates and then seeds. The migration runs as
 * `splashtrack_owner` (prisma.config.ts), so every table it creates is owned by
 * the owner role and carries no privileges for the runtime role at all. The
 * seed runs as the RUNTIME role, because that is what `@/lib/database` connects
 * as. Between those two steps the grants have to be applied, and they were not:
 * the seed died on its first statement with
 *
 *     permission denied for table Organization
 *
 * and the only way forward was for the operator to know that `db:apply-grants`
 * belongs between two halves of a command that presents itself as one command.
 *
 * BOTH DIRECTIONS ARE ASSERTED, and the negative one is why this file is not a
 * tautology. The first case migrates WITHOUT applying the model and proves the
 * runtime role really is locked out — so the second case, which runs the real
 * command and finds a seeded catalogue, is evidence that `setup:init` closed
 * the gap rather than evidence that the gap never existed.
 *
 * IT RUNS THE ACTUAL CLI, in a child process, against a throwaway database.
 * Calling `setupInit()` in-process could not work: `@/lib/database` resolves
 * `DATABASE_URL` when it is imported, so the seed would reach the suite's own
 * `_test` database rather than the empty one under test. A child process with
 * its own environment is also simply what the operator types.
 */

import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { claimSchemaForOwner } from "@/lib/database/apply-role-model";
import {
  migrationUrlFrom,
  REFERENCE_OWNER_ROLE,
} from "@/lib/database/role-model";

/** Databases created here, dropped in `afterAll` whatever happens. */
const created: string[] = [];

function adminUrl(): string {
  const url = new URL(process.env.DATABASE_MAINTENANCE_URL as string);
  url.pathname = "/postgres";
  return url.toString();
}

/** The maintenance (retention) credential against one throwaway database. */
function maintenanceUrlFor(database: string): string {
  const url = new URL(process.env.DATABASE_MAINTENANCE_URL as string);
  url.pathname = `/${database}`;
  return url.toString();
}

/** The RUNTIME credential against one throwaway database — the seed's identity. */
function runtimeUrlFor(database: string): string {
  const url = new URL(process.env.DATABASE_URL as string);
  url.pathname = `/${database}`;
  return url.toString();
}

async function withAdmin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: adminUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * An empty database with a name the `_test` guard permits. Schema `public` is
 * handed to the owner immediately, which is what `infra/provision-roles.sql`
 * does for the real database — so what is under test is the GRANTS, not a
 * schema-ownership accident this file created.
 */
async function createEmptyDatabase(suffix: string): Promise<string> {
  const database = `splashtrack_setupinit_${suffix}_test`;
  await withAdmin(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${database}"`);
    await client.query(`CREATE DATABASE "${database}"`);
  });
  await claimSchemaForOwner(maintenanceUrlFor(database), REFERENCE_OWNER_ROLE);
  created.push(database);
  return database;
}

/**
 * Runs the real CLI, with the environment pointed at one throwaway database,
 * and returns everything it said.
 *
 * `spawnSync` rather than `execFileSync` because every command in `src/cli`
 * logs to STDERR and reserves stdout for machine output (`boot:state` prints
 * `<STATE> <ACTION>` there) — so the operator-facing narrative this asserts on
 * is only visible if both streams are captured.
 */
function runCli(database: string, ...args: string[]): string {
  const result = spawnSync(
    process.execPath,
    [
      path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
      path.resolve(process.cwd(), "scripts/cli-dev.ts"),
      ...args,
    ],
    {
      env: {
        ...process.env,
        DATABASE_URL: runtimeUrlFor(database),
        DATABASE_MAINTENANCE_URL: maintenanceUrlFor(database),
      },
      encoding: "utf8",
    },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(
      `splashtrack ${args.join(" ")} exited ${result.status}:\n${output}`,
    );
  }
  return output;
}

/** `prisma migrate deploy` alone — the half `setup:init` used to run unaided. */
function migrateOnly(database: string): void {
  execFileSync(
    process.execPath,
    [
      path.resolve(process.cwd(), "node_modules/prisma/build/index.js"),
      "migrate",
      "deploy",
    ],
    {
      env: {
        ...process.env,
        DATABASE_URL: runtimeUrlFor(database),
        DATABASE_MAINTENANCE_URL: maintenanceUrlFor(database),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

/** One query as the RUNTIME role — the identity the seed actually has. */
async function asRuntime<T>(
  database: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: runtimeUrlFor(database) });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

afterAll(async () => {
  for (const database of created) {
    await withAdmin((client) =>
      client.query(`DROP DATABASE IF EXISTS "${database}"`),
    );
  }
});

describe("setup:init on an empty database", () => {
  it(
    "leaves the runtime role locked out when only the migration runs",
    { timeout: 120_000 },
    async () => {
      const database = await createEmptyDatabase("bare");
      migrateOnly(database);

      // The negative half. `Organization` exists — the migration created it —
      // and the runtime role cannot touch it, which is exactly the failure the
      // operator met.
      await asRuntime(database, async (client) => {
        await expect(
          client.query('SELECT 1 FROM "Organization"'),
        ).rejects.toThrow(/permission denied for table Organization/i);
      });

      // And it is a GRANT problem, not a missing table: the owner reads it.
      const owner = new Client({
        connectionString: migrationUrlFrom(
          maintenanceUrlFor(database),
          REFERENCE_OWNER_ROLE,
        ),
      });
      await owner.connect();
      try {
        await expect(
          owner.query('SELECT 1 FROM "Organization"'),
        ).resolves.toBeTruthy();
      } finally {
        await owner.end();
      }
    },
  );

  it(
    "migrates, grants and seeds in one command",
    { timeout: 120_000 },
    async () => {
      const database = await createEmptyDatabase("full");

      const output = runCli(database, "setup:init");
      expect(output).toContain("Migrations applied.");
      expect(output).toContain("D-149 part 2 is in force");

      // The seeded catalogue, read AS THE RUNTIME ROLE. Reading it as the owner
      // would prove the seed ran and nothing about whether the application can
      // see it.
      await asRuntime(database, async (client) => {
        const permissions = await client.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM "Permission"',
        );
        expect(Number(permissions.rows[0].count)).toBeGreaterThan(0);

        const roles = await client.query<{ key: string }>(
          'SELECT key FROM "Role" ORDER BY key',
        );
        expect(roles.rows.map((row) => row.key)).toEqual([
          "instance_administrator",
          "self",
        ]);

        const organizations = await client.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM "Organization"',
        );
        expect(organizations.rows[0].count).toBe("1");
      });

      // The audit exception survived: the runtime role may INSERT an audit row
      // and may not delete one. `setup:init` applying the grants must not have
      // widened them.
      await asRuntime(database, async (client) => {
        const writes = await client.query<{ privilege_type: string }>(
          `SELECT privilege_type FROM information_schema.table_privileges
            WHERE table_name = 'AuditEvent' AND grantee = current_user
              AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')`,
        );
        expect(writes.rows).toEqual([]);

        const inserts = await client.query<{ privilege_type: string }>(
          `SELECT privilege_type FROM information_schema.table_privileges
            WHERE table_name = 'AuditEvent' AND grantee = current_user
              AND privilege_type = 'INSERT'`,
        );
        expect(inserts.rowCount).toBe(1);
      });
    },
  );
});
