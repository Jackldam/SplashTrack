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
 *
 * IT RUNS ON THE MAINTENANCE CREDENTIAL, NOT THE RUNTIME ONE (ADR-0002 §6).
 * Creating and dropping a database needs CREATEDB, and since D-182 that
 * attribute sits on the retention role and never on the runtime role — so a
 * checkout's runtime role is shaped exactly like a production one. This file is
 * one of the two reasons CREATEDB is needed at all, and the phase 1.0 report
 * named it correctly while wrongly concluding that SUPERUSER was required:
 * CREATEDB and SUPERUSER are different role attributes, and only the first is.
 *
 * The DETECTOR still reads through an ordinary client, because what it must
 * work against is a runtime connection.
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
import { claimSchemaForOwner } from "@/lib/database/apply-role-model";
import {
  migrationUrlFrom,
  REFERENCE_OWNER_ROLE,
} from "@/lib/database/role-model";

const IMAGE_MIGRATIONS = imageMigrationNames();

/** Databases created by this file, torn down in `afterAll` whatever happens. */
const created: string[] = [];

/** The maintenance connection to the always-present `postgres` database. */
function adminUrl(): string {
  const url = new URL(process.env.DATABASE_MAINTENANCE_URL as string);
  url.pathname = "/postgres";
  return url.toString();
}

/**
 * A connection to one throwaway database, as the OWNER.
 *
 * These cases write `_prisma_migrations` rows and create tables by hand to put
 * a database into a given state, which is owner work — the runtime role owns
 * nothing and cannot create a table, which is D-116 holding rather than a
 * limitation to work around.
 */
function urlFor(database: string): string {
  return migrationUrlFrom(urlForSession(database), REFERENCE_OWNER_ROLE);
}

/** The same database, as the retention role itself rather than as the owner. */
function urlForSession(database: string): string {
  const url = new URL(process.env.DATABASE_MAINTENANCE_URL as string);
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
    // Owned by the retention role that creates it, so `afterAll` can drop it
    // again: the owner membership is non-inheriting (infra/provision-roles.sql
    // §3), so an owner-owned database could not be dropped from here.
    await client.query(`CREATE DATABASE "${database}"`);
  });
  // Hand schema `public` to the owner before anything is created in it, so the
  // tables these cases build by hand are owned where every other table in this
  // product is (ADR-0002 §3).
  await claimSchemaForOwner(urlForSession(database), REFERENCE_OWNER_ROLE);
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

/** The tables predicate 4 needs, minimal but real. */
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

/**
 * The rest of what predicate 4 reads since D-186. Minimal but real: the column
 * names are the ones the predicate joins on, so a query naming the wrong one
 * fails here rather than in production.
 */
const CREATE_ACCOUNT_TABLES = [
  `CREATE TABLE "UserAccount" (id TEXT PRIMARY KEY, "personId" TEXT NOT NULL)`,
  `CREATE TABLE "RoleAssignment" (id TEXT PRIMARY KEY, "personId" TEXT NOT NULL)`,
  `CREATE TABLE "TwoFactor" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL, verified BOOLEAN)`,
];

/**
 * Exactly what a first run leaves behind between `admin:create` and browser
 * enrolment: the started record, one person, that person's account, that
 * person's two grants, and NO factor.
 *
 * `withStartedRecord` is the ONLY thing the two halves of D-186's proof differ
 * by, so the TAMPERED case cannot be passing for some other reason.
 */
function firstRunInProgress(withStartedRecord: boolean): string[] {
  return [
    CREATE_MIGRATIONS_TABLE,
    ...IMAGE_MIGRATIONS.map((name) => insertMigration(name)),
    CREATE_BOOTSTRAP_TABLE,
    CREATE_PERSON_TABLE,
    ...CREATE_ACCOUNT_TABLES,
    ...(withStartedRecord
      ? [`INSERT INTO "InstallationBootstrap" (id) VALUES ('installation')`]
      : []),
    `INSERT INTO "Person" (id) VALUES ('the-first-administrator')`,
    `INSERT INTO "UserAccount" (id, "personId")
       VALUES ('account-1', 'the-first-administrator')`,
    `INSERT INTO "RoleAssignment" (id, "personId")
       VALUES ('grant-org', 'the-first-administrator')`,
    `INSERT INTO "RoleAssignment" (id, "personId")
       VALUES ('grant-self', 'the-first-administrator')`,
  ];
}

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

  it("a ROLLED-BACK migration is EXISTING, not FAILED — the recovery must be reachable", async () => {
    // D-098 writes predicate 3 as `finished_at IS NULL OR rolled_back_at IS NOT
    // NULL`. Measured against Prisma 7: `migrate resolve --rolled-back` — the
    // command the FAILED message tells the operator to run — leaves the row
    // with `finished_at` NULL and `rolled_back_at` SET, so the literal reading
    // reports FAILED forever to an operator who did exactly what they were
    // told. Prisma itself treats a rolled-back row as NOT APPLIED and
    // `migrate deploy` re-applies it, so this is a pending migration.
    const database = await createDatabase("resolved_rolledback");
    await sql(database, [
      CREATE_MIGRATIONS_TABLE,
      ...IMAGE_MIGRATIONS.slice(0, -1).map((name) => insertMigration(name)),
      insertMigration(IMAGE_MIGRATIONS[IMAGE_MIGRATIONS.length - 1], {
        finished: false,
        rolledBack: true,
      }),
      CREATE_BOOTSTRAP_TABLE,
      `INSERT INTO "InstallationBootstrap" (id, "completedAt") VALUES ('installation', now())`,
    ]);

    const decision = await detectAgainst(database);

    expect(decision.state).toBe("EXISTING");
    expect(decision.pendingMigrations).toEqual([
      IMAGE_MIGRATIONS[IMAGE_MIGRATIONS.length - 1],
    ]);
  });

  it("a rolled-back migration is never counted as applied", async () => {
    // The other half of the same correction: a rolled-back row IS recorded, so
    // counting recorded rows as applied would report CURRENT on a schema that
    // is missing that migration's tables.
    const database = await createDatabase("rolledback_not_current");
    await sql(database, [
      CREATE_MIGRATIONS_TABLE,
      ...IMAGE_MIGRATIONS.map((name, index) =>
        index === 0
          ? insertMigration(name, { finished: false, rolledBack: true })
          : insertMigration(name),
      ),
      CREATE_BOOTSTRAP_TABLE,
      `INSERT INTO "InstallationBootstrap" (id, "completedAt") VALUES ('installation', now())`,
    ]);

    const decision = await detectAgainst(database);

    expect(decision.state).toBe("EXISTING");
    expect(decision.pendingMigrations).toEqual([IMAGE_MIGRATIONS[0]]);
  });

  it("AHEAD still fires on an unknown migration that was rolled back", async () => {
    // A newer image reached this database even if its migration was undone.
    // Refusing to start is recoverable in seconds; guessing is not.
    const database = await createDatabase("ahead_rolledback");
    await sql(database, [
      CREATE_MIGRATIONS_TABLE,
      ...IMAGE_MIGRATIONS.map((name) => insertMigration(name)),
      insertMigration("29990101000000_from_a_newer_release", {
        finished: false,
        rolledBack: true,
      }),
    ]);

    expect((await detectAgainst(database)).state).toBe("AHEAD");
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

  // ── D-186: the pending administrator, and the tampering it used to look like
  //
  // These four cases are one argument. The first is the state that locked the
  // owner out of his own instance; the three after it are what stops the fix
  // from being a hole, and they are written as the SAME database with one thing
  // changed, so none of them can pass for an unrelated reason.

  it("PENDING_ENROLMENT — the administrator exists and has not enrolled", async () => {
    // THE DEFECT THIS PINS. `admin:create` leaves exactly this: one person, one
    // account, two grants, no factor, and a bootstrap record with `completedAt`
    // still NULL. D-099's predicate called it TAMPERED and refused to serve —
    // so the installation would not show the one page (`/sign-in` →
    // `/mfa-enrolment`) that could finish the setup. The account is created and
    // the product is unreachable.
    const database = await createDatabase("pending_enrolment");
    await sql(database, firstRunInProgress(true));

    const decision = await detectAgainst(database);

    expect(decision.state).toBe("PENDING_ENROLMENT");
    expect(decision.action).toBe("SETUP_MODE");
    // Said explicitly rather than implied by the state name: this is what
    // regressed, and a future predicate change must fail on this line.
    expect(decision.state).not.toBe("TAMPERED");
    expect(decision.action).not.toBe("REFUSE");
    // And it points at the browser, not back at the host command.
    expect(decision.detail).toContain("browser");
  });

  it("TAMPERED — the same installation with the started record DELETED", async () => {
    // THE NON-VACUOUS HALF. Identical to the case above in every row except
    // one: the `InstallationBootstrap` row is gone. That is precisely F-98's
    // primitive — one deleted row, reopening an unauthenticated administrative
    // surface — and it must still go red, on a pending installation exactly as
    // on a finished one. If this ever passes as PENDING_ENROLMENT, D-186 has
    // become the hole D-099 exists to close.
    const database = await createDatabase("pending_record_deleted");
    await sql(database, firstRunInProgress(false));

    const decision = await detectAgainst(database);

    expect(decision.state).toBe("TAMPERED");
    expect(decision.action).toBe("REFUSE");
    expect(decision.detail).toContain(
      "nothing recorded that setup ever started",
    );
    expect(decision.detail).toContain("bootstrap:clear-tampered");
  });

  it("TAMPERED — a verified factor exists, so setup is not still running", async () => {
    // The UPDATE case: an attacker who can clear `completedAt` — a strictly
    // stronger primitive than the DELETE F-98 describes — must not thereby
    // reopen setup mode on a real installation. Somebody has enrolled here, so
    // setup demonstrably finished once, whatever the record now says.
    const database = await createDatabase("pending_but_enrolled");
    await sql(database, [
      ...firstRunInProgress(true),
      `INSERT INTO "TwoFactor" (id, "userId", verified)
         VALUES ('factor-1', 'account-1', true)`,
    ]);

    const decision = await detectAgainst(database);

    expect(decision.state).toBe("TAMPERED");
    expect(decision.action).toBe("REFUSE");
    expect(decision.detail).toContain("already finished enrolling");
  });

  it("TAMPERED — a person nobody's account belongs to (a real register)", async () => {
    // The shape of a LIVE installation: children have `Person` rows and will
    // never have an account. First-run setup creates none of those, so their
    // presence with no completed record is not an unfinished setup — it is a
    // populated database with its bootstrap record missing, which is the exact
    // thing D-099 refuses to open setup mode on.
    const database = await createDatabase("pending_but_populated");
    await sql(database, [
      ...firstRunInProgress(true),
      `INSERT INTO "Person" (id) VALUES ('a-child-whose-record-is-here')`,
    ]);

    const decision = await detectAgainst(database);

    expect(decision.state).toBe("TAMPERED");
    expect(decision.action).toBe("REFUSE");
    expect(decision.detail).toContain("belong to nobody with an account");
  });

  it("TAMPERED — a grant held by somebody with no account", async () => {
    // The third independent condition, on its own: grants outlive nothing that
    // first-run setup creates, so one naming a person without an account means
    // the authorization model has been used, not merely seeded.
    const database = await createDatabase("pending_but_granted");
    await sql(database, [
      ...firstRunInProgress(true),
      `INSERT INTO "Person" (id) VALUES ('an-instructor')`,
      `INSERT INTO "UserAccount" (id, "personId")
         VALUES ('account-2', 'an-instructor')`,
      // The instructor has an account, so the person check passes; the grant
      // below names somebody who has none, so this case isolates the third
      // condition rather than re-testing the second.
      `DELETE FROM "UserAccount" WHERE id = 'account-2'`,
      `DELETE FROM "Person" WHERE id = 'an-instructor'`,
      `INSERT INTO "RoleAssignment" (id, "personId")
         VALUES ('grant-orphan', 'a-person-who-is-gone')`,
    ]);

    const decision = await detectAgainst(database);

    expect(decision.state).toBe("TAMPERED");
    expect(decision.action).toBe("REFUSE");
    expect(decision.detail).toContain("name a person who has no account");
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
  if (!process.env.DATABASE_MAINTENANCE_URL) {
    throw new Error(
      "DATABASE_MAINTENANCE_URL is not set; the test env did not load. This " +
        "file creates and drops databases, which needs CREATEDB — an " +
        "attribute the runtime role deliberately does not have (ADR-0002 §6).",
    );
  }
});
