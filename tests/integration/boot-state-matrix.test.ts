/**
 * The boot state machine's test matrix — one case per state.
 *
 * D-055's own trade-off paragraph asks for exactly this: *"the entrypoint …
 * carries a small state machine, and that state machine is security- and
 * data-critical code. It is therefore covered by its own test matrix, one case
 * per state."* D-099 adds `TAMPERED` to that matrix by name.
 *
 * EVERY CASE IS A REAL DATABASE, not a stub. A stub would test the branch
 * structure and nothing else, and the failure this suite has to catch is a
 * predicate that reads the wrong thing — `_prisma_migrations` semantics, a
 * table-existence check against the wrong schema, a count that silently returns
 * zero because the table is missing. Each case therefore creates a throwaway
 * database, puts it in the state under test, and asks the real detector.
 *
 * Database names all end in `_test`, matching the guard in
 * `tests/setup/test-db-url.ts`: there is no path by which this suite can act on
 * the development database.
 */

import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import {
  ACTION_BY_STATE,
  detectBootState,
  imageMigrationNames,
  type BootStateReader,
} from "@/lib/boot/state";

const IMAGE_MIGRATIONS = imageMigrationNames();

/** Databases created by this file, torn down in `afterAll` whatever happens. */
const created: string[] = [];

function adminUrl(): string {
  const url = new URL(process.env.DATABASE_URL as string);
  url.pathname = "/postgres";
  return url.toString();
}

function urlFor(database: string): string {
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
 * A fresh, empty database with a name this suite owns. `case` is a short
 * identifier; the `_test` suffix is what keeps the guard's promise true.
 */
async function createDatabase(name: string): Promise<string> {
  const database = `splashtrack_boot_${name}_test`;
  await withAdmin(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${database}"`);
    await client.query(`CREATE DATABASE "${database}"`);
  });
  created.push(database);
  return database;
}

/** Runs raw SQL against one of this suite's throwaway databases. */
async function sql(database: string, statements: string[]): Promise<void> {
  const client = new Client({ connectionString: urlFor(database) });
  await client.connect();
  try {
    for (const statement of statements) await client.query(statement);
  } finally {
    await client.end();
  }
}

/** A reader bound to one throwaway database. Disconnected by the caller. */
function readerFor(database: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: urlFor(database) }),
  });
}

async function detectAgainst(
  database: string,
  imageMigrations: string[] = IMAGE_MIGRATIONS,
) {
  const client = readerFor(database);
  try {
    return await detectBootState(
      imageMigrations,
      client as unknown as BootStateReader,
    );
  } finally {
    await client.$disconnect();
  }
}

/**
 * The `_prisma_migrations` table, exactly as Prisma creates it. Written by hand
 * rather than by running `migrate deploy` per case: these tests are about how
 * the detector READS this table, and constructing the rows directly is what
 * makes a `FAILED` or `AHEAD` row expressible at all — neither is a state a
 * successful `migrate deploy` can produce.
 */
const CREATE_MIGRATIONS_TABLE = `
  CREATE TABLE "_prisma_migrations" (
    id                      VARCHAR(36) PRIMARY KEY,
    checksum                VARCHAR(64) NOT NULL,
    finished_at             TIMESTAMPTZ,
    migration_name          VARCHAR(255) NOT NULL,
    logs                    TEXT,
    rolled_back_at          TIMESTAMPTZ,
    started_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_steps_count     INTEGER NOT NULL DEFAULT 0
  )`;

function insertMigration(
  name: string,
  options: { finished?: boolean; rolledBack?: boolean } = {},
): string {
  const finished = options.finished === false ? "NULL" : "now()";
  const rolledBack = options.rolledBack ? "now()" : "NULL";
  // `id` is VARCHAR(36) — Prisma writes a UUID there, not the migration name.
  const id = randomUUID();
  return `
    INSERT INTO "_prisma_migrations"
      (id, checksum, migration_name, finished_at, rolled_back_at, started_at)
    VALUES
      ('${id}', 'checksum', '${name}', ${finished}, ${rolledBack}, clock_timestamp())`;
}

/** The two tables predicate 4 needs, minimal but real. */
const CREATE_BOOTSTRAP_TABLE = `
  CREATE TABLE "InstallationBootstrap" (
    id TEXT PRIMARY KEY DEFAULT 'installation',
    "completedAt" TIMESTAMP(3),
    "completedVia" TEXT,
    "appVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now()
  )`;

const CREATE_PERSON_TABLE = `CREATE TABLE "Person" (id TEXT PRIMARY KEY)`;

afterAll(async () => {
  for (const database of created) {
    await withAdmin((client) =>
      client.query(`DROP DATABASE IF EXISTS "${database}"`),
    ).catch(() => undefined);
  }
});

describe("boot state matrix (D-055, D-098, D-099)", () => {
  it("EMPTY — no tables at all, and nothing is migrated", async () => {
    const database = await createDatabase("empty");
    const decision = await detectAgainst(database);

    expect(decision.state).toBe("EMPTY");
    expect(decision.action).toBe("SETUP_MODE");
  });

  it("AHEAD — the schema carries a migration this image does not ship", async () => {
    const database = await createDatabase("ahead");
    await sql(database, [
      CREATE_MIGRATIONS_TABLE,
      ...IMAGE_MIGRATIONS.map((name) => insertMigration(name)),
      insertMigration("29990101000000_from_a_newer_release"),
    ]);

    const decision = await detectAgainst(database);

    expect(decision.state).toBe("AHEAD");
    expect(decision.action).toBe("REFUSE");
    // The message must NAME the migration, so the operator learns which image
    // to run rather than that "something is wrong" (D-043).
    expect(decision.unknownMigrations).toEqual([
      "29990101000000_from_a_newer_release",
    ]);
    expect(decision.detail).toContain("29990101000000_from_a_newer_release");
  });

  it("AHEAD wins over EXISTING when both would match", async () => {
    // A database that is simultaneously missing one of this image's migrations
    // AND carrying an unknown one. Predicate order decides: refusing to start
    // is recoverable, migrating an unknown-newer schema is not.
    const database = await createDatabase("ahead_and_behind");
    await sql(database, [
      CREATE_MIGRATIONS_TABLE,
      insertMigration(IMAGE_MIGRATIONS[0]),
      insertMigration("29990101000000_from_a_newer_release"),
    ]);

    expect((await detectAgainst(database)).state).toBe("AHEAD");
  });

  it("FAILED — a migration is recorded unfinished", async () => {
    const database = await createDatabase("failed_unfinished");
    await sql(database, [
      CREATE_MIGRATIONS_TABLE,
      ...IMAGE_MIGRATIONS.slice(0, -1).map((name) => insertMigration(name)),
      insertMigration(IMAGE_MIGRATIONS[IMAGE_MIGRATIONS.length - 1], {
        finished: false,
      }),
    ]);

    const decision = await detectAgainst(database);

    expect(decision.state).toBe("FAILED");
    expect(decision.action).toBe("REFUSE");
    // Restarting would fail identically — the operator has to be told that.
    expect(decision.detail).toContain("P3009");
  });

  it("FAILED — a migration is recorded rolled back", async () => {
    const database = await createDatabase("failed_rolledback");
    await sql(database, [
      CREATE_MIGRATIONS_TABLE,
      ...IMAGE_MIGRATIONS.map((name) => insertMigration(name)),
      insertMigration(IMAGE_MIGRATIONS[0], { rolledBack: true }),
    ]);

    expect((await detectAgainst(database)).state).toBe("FAILED");
  });

  it("PARTIAL — schema present, no bootstrap record, no data", async () => {
    const database = await createDatabase("partial");
    await sql(database, [
      CREATE_MIGRATIONS_TABLE,
      ...IMAGE_MIGRATIONS.map((name) => insertMigration(name)),
      CREATE_BOOTSTRAP_TABLE,
      CREATE_PERSON_TABLE,
    ]);

    const decision = await detectAgainst(database);

    expect(decision.state).toBe("PARTIAL");
    expect(decision.action).toBe("SETUP_MODE");
  });

  it("TAMPERED — no bootstrap record, but the installation holds data (D-099)", async () => {
    // THE FINDING THIS TEST IS FOR (F-98): keying setup mode on one deletable
    // row means any primitive that deletes a row can reopen an unauthenticated
    // administrative surface on a populated database.
    const database = await createDatabase("tampered");
    await sql(database, [
      CREATE_MIGRATIONS_TABLE,
      ...IMAGE_MIGRATIONS.map((name) => insertMigration(name)),
      CREATE_BOOTSTRAP_TABLE,
      CREATE_PERSON_TABLE,
      `INSERT INTO "Person" (id) VALUES ('a-child-whose-record-is-here')`,
    ]);

    const decision = await detectAgainst(database);

    expect(decision.state).toBe("TAMPERED");
    expect(decision.action).toBe("REFUSE");
    expect(decision.detail).toContain("bootstrap:clear-tampered");
  });

  it("TAMPERED — tables with no _prisma_migrations at all", async () => {
    // Not one of D-098's six, and deliberately handled: a schema this image did
    // not create is not a schema to migrate.
    const database = await createDatabase("foreign_schema");
    await sql(database, [CREATE_PERSON_TABLE]);

    expect((await detectAgainst(database)).state).toBe("TAMPERED");
  });

  it("EXISTING — bootstrap complete, migrations pending", async () => {
    const database = await createDatabase("existing");
    await sql(database, [
      CREATE_MIGRATIONS_TABLE,
      ...IMAGE_MIGRATIONS.slice(0, -1).map((name) => insertMigration(name)),
      CREATE_BOOTSTRAP_TABLE,
      `INSERT INTO "InstallationBootstrap" (id, "completedAt") VALUES ('installation', now())`,
    ]);

    const decision = await detectAgainst(database);

    expect(decision.state).toBe("EXISTING");
    expect(decision.action).toBe("MIGRATE_THEN_SERVE");
    expect(decision.pendingMigrations).toEqual([
      IMAGE_MIGRATIONS[IMAGE_MIGRATIONS.length - 1],
    ]);
  });

  it("EXISTING — a schema older than InstallationBootstrap still migrates forward", async () => {
    // The reading D-098 does not state: predicate 4 presumes the table exists.
    // Answering it "false" on a schema that predates the table would classify a
    // populated pre-upgrade installation as TAMPERED and refuse the upgrade
    // predicate 5 exists for. See `state.ts`.
    const database = await createDatabase("existing_pre_bootstrap");
    await sql(database, [
      CREATE_MIGRATIONS_TABLE,
      ...IMAGE_MIGRATIONS.slice(0, -1).map((name) => insertMigration(name)),
      CREATE_PERSON_TABLE,
      `INSERT INTO "Person" (id) VALUES ('an-existing-person')`,
    ]);

    const decision = await detectAgainst(database);

    expect(decision.state).toBe("EXISTING");
    expect(decision.action).toBe("MIGRATE_THEN_SERVE");
  });

  it("CURRENT — schema matches the image and setup completed", async () => {
    const database = await createDatabase("current");
    await sql(database, [
      CREATE_MIGRATIONS_TABLE,
      ...IMAGE_MIGRATIONS.map((name) => insertMigration(name)),
      CREATE_BOOTSTRAP_TABLE,
      `INSERT INTO "InstallationBootstrap" (id, "completedAt") VALUES ('installation', now())`,
    ]);

    const decision = await detectAgainst(database);

    expect(decision.state).toBe("CURRENT");
    expect(decision.action).toBe("SERVE");
  });

  it("no state other than EXISTING ever implies a migration", () => {
    // The rule D-055 exists for, asserted against the real mapping rather than
    // inferred from whichever cases happen to be written above: a database
    // whose purpose is not yet known is never migrated.
    expect(
      Object.entries(ACTION_BY_STATE).filter(
        ([, action]) => action === "MIGRATE_THEN_SERVE",
      ),
    ).toEqual([["EXISTING", "MIGRATE_THEN_SERVE"]]);
  });
});

beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set; the test env did not load.");
  }
});
