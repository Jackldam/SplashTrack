/**
 * The boot state machine (D-055, predicates by D-098, `TAMPERED` by D-099).
 *
 * `13-configuration-and-setup.md` §6 is the authoritative boot sequence and this
 * file is its implementation. The rule it exists for is one sentence: **the
 * container never migrates a database whose purpose is not yet known.** An empty
 * database is ambiguous — a fresh installation, or the first minute of a restore
 * — and `migrate deploy && start` resolves that ambiguity in the wrong direction,
 * leaving the operator with a migrated empty schema and a backup that no longer
 * restores cleanly into it.
 *
 * So state is DETECTED first and migration is a consequence of the state.
 *
 * THE PREDICATES ARE ORDERED AND THE FIRST MATCH WINS (D-098). They are
 * evaluated against ONE connection, in this order:
 *
 *   1. `_prisma_migrations` absent AND no other tables          → EMPTY
 *   2. `_prisma_migrations` names a migration the image lacks   → AHEAD
 *   3. any row with `finished_at IS NULL`
 *      or `rolled_back_at IS NOT NULL`                          → FAILED
 *   4. no `InstallationBootstrap` row with `completedAt`        → PARTIAL
 *      …with any `UserAccount` / `Person` / `RoleAssignment`    → TAMPERED
 *   5. an image migration missing from `_prisma_migrations`     → EXISTING
 *   6. otherwise                                                → CURRENT
 *
 * WHY RAW SQL AND NOT THE PRISMA CLIENT. Every predicate above has to be
 * answerable on a database whose tables may not exist. A Prisma model call
 * against a missing table throws a driver error that would have to be
 * string-matched back into a state, which is the shape of bug this machine
 * exists to prevent. `information_schema` and `_prisma_migrations` are both
 * documented schemas, so they are read directly.
 *
 * `prisma migrate status` EXIT CODES ARE NOT USED, deliberately: D-098 states
 * they are not a stable API. The predicates read `_prisma_migrations` instead —
 * which is already the mechanism D-046's restore path depends on, so the
 * coupling is not new, only stated.
 *
 * SERVER-ONLY. Called by the entrypoint through `splashtrack boot:state`, and by
 * the boot-state test matrix D-055's trade-off paragraph requires (one case per
 * state).
 */

import { readdirSync } from "node:fs";
import path from "node:path";

import { prisma } from "@/lib/database";

/**
 * The subset of the Prisma client this file uses. Narrowed to raw SQL on
 * purpose (see the header), and taken as a parameter so the state-matrix test
 * can point every predicate at a throwaway database in a known state instead of
 * mocking the answers — a state machine the design calls security- and
 * data-critical is not worth testing against a stub.
 */
export interface BootStateReader {
  $queryRaw: typeof prisma.$queryRaw;
  $queryRawUnsafe: typeof prisma.$queryRawUnsafe;
}

/** The six states of D-098, plus D-099's `TAMPERED`. */
export type BootState =
  | "EMPTY"
  | "AHEAD"
  | "FAILED"
  | "PARTIAL"
  | "TAMPERED"
  | "EXISTING"
  | "CURRENT";

/** What the entrypoint is allowed to do in a state. */
export type BootAction =
  | "SETUP_MODE"
  | "MIGRATE_THEN_SERVE"
  | "SERVE"
  | "REFUSE";

export interface BootDecision {
  state: BootState;
  action: BootAction;
  /** One line an operator can act on. Never a secret, never a connection string. */
  detail: string;
  /** Migrations present in the image but not applied — `EXISTING` only. */
  pendingMigrations: string[];
  /** Migrations applied but absent from the image — `AHEAD` only. */
  unknownMigrations: string[];
}

/**
 * The one place a state is turned into permission to act. Exported so the state
 * matrix can assert the property D-055 is actually about — that
 * `MIGRATE_THEN_SERVE` is reachable from exactly one state — rather than
 * inferring it from the cases that happen to be written.
 */
export const ACTION_BY_STATE: Readonly<Record<BootState, BootAction>> = {
  EMPTY: "SETUP_MODE",
  PARTIAL: "SETUP_MODE",
  AHEAD: "REFUSE",
  FAILED: "REFUSE",
  TAMPERED: "REFUSE",
  EXISTING: "MIGRATE_THEN_SERVE",
  CURRENT: "SERVE",
};

/**
 * The migration directory names this image ships, sorted. Prisma names a
 * migration by its directory, and that name is exactly what it records in
 * `_prisma_migrations.migration_name`, so the two sets are directly comparable.
 */
export function imageMigrationNames(
  migrationsDir: string = path.resolve(process.cwd(), "prisma/migrations"),
): string[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Applied migration names, in the order Prisma recorded them. */
async function appliedMigrationNames(db: BootStateReader): Promise<string[]> {
  const rows = await db.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM "_prisma_migrations" ORDER BY started_at ASC
  `;
  return rows.map((row) => row.migration_name);
}

/** True when a table of this name exists in the connection's search path. */
async function tableExists(
  db: BootStateReader,
  name: string,
): Promise<boolean> {
  const rows = await db.$queryRaw<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_name = ${name}
    ) AS present
  `;
  return rows[0]?.present === true;
}

/** How many tables the current schema holds, `_prisma_migrations` included. */
async function tableCount(db: BootStateReader): Promise<number> {
  const rows = await db.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count
      FROM information_schema.tables
     WHERE table_schema = current_schema()
       AND table_type = 'BASE TABLE'
  `;
  return Number(rows[0]?.count ?? 0);
}

/**
 * D-099's four conditions for setup mode, as counts. A single missing row is
 * NOT enough: any primitive that deletes one row — an injection, a compromised
 * low-privilege credential, a botched restore, a bug in an erasure — would
 * otherwise put a populated production database holding children's records into
 * unauthenticated setup mode (F-98).
 *
 * Each count is guarded by a table-existence check, because predicate 4 is
 * reachable on a database that has `_prisma_migrations` and a partial schema.
 */
async function countInstallationData(db: BootStateReader): Promise<{
  userAccounts: number;
  people: number;
  roleAssignments: number;
}> {
  async function countOf(table: string): Promise<number> {
    if (!(await tableExists(db, table))) return 0;
    const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(
      // The table name is one of three literals in this file, never input.
      `SELECT COUNT(*) AS count FROM "${table}"`,
    );
    return Number(rows[0]?.count ?? 0);
  }

  const [userAccounts, people, roleAssignments] = await Promise.all([
    countOf("UserAccount"),
    countOf("Person"),
    countOf("RoleAssignment"),
  ]);
  return { userAccounts, people, roleAssignments };
}

/**
 * Detects the boot state. Read-only: it writes nothing, migrates nothing and
 * creates nothing, so it is safe to run against any database in any state —
 * which is the property that lets the entrypoint call it BEFORE deciding
 * anything.
 */
export async function detectBootState(
  imageMigrations: string[] = imageMigrationNames(),
  db: BootStateReader = prisma,
): Promise<BootDecision> {
  const decide = (
    state: BootState,
    detail: string,
    extra: Partial<BootDecision> = {},
  ): BootDecision => ({
    state,
    action: ACTION_BY_STATE[state],
    detail,
    pendingMigrations: [],
    unknownMigrations: [],
    ...extra,
  });

  const hasMigrationsTable = await tableExists(db, "_prisma_migrations");

  // ── 1. EMPTY ──────────────────────────────────────────────────────────────
  if (!hasMigrationsTable) {
    const tables = await tableCount(db);
    if (tables === 0) {
      return decide(
        "EMPTY",
        "The database holds no tables. This is either a fresh installation or " +
          "the first minute of a restore, and only the operator knows which — " +
          "so nothing is migrated. Setup mode.",
      );
    }
    // Tables without `_prisma_migrations` is not one of D-098's six: it is a
    // schema this image did not create and cannot reason about. It has the
    // same handling as TAMPERED for the same reason — refuse, do not guess.
    return decide(
      "TAMPERED",
      `The database holds ${tables} table(s) but no "_prisma_migrations" ` +
        "table, so this schema was not created by SplashTrack. Refusing to " +
        "serve or migrate. Point DATABASE_URL at the right database, or " +
        "clear this one deliberately from the host.",
    );
  }

  const applied = await appliedMigrationNames(db);
  const imageSet = new Set(imageMigrations);

  // ── 2. AHEAD ──────────────────────────────────────────────────────────────
  const unknown = applied.filter((name) => !imageSet.has(name));
  if (unknown.length > 0) {
    return decide(
      "AHEAD",
      "The database schema is NEWER than this image: it has migration(s) " +
        `this image does not ship (${unknown.join(", ")}). Forward-only ` +
        "migrations make an older application on a newer schema undefined " +
        "behaviour, so this refuses to start rather than corrupt data " +
        "(D-043). Run the image version that shipped those migrations.",
      { unknownMigrations: unknown },
    );
  }

  // ── 3. FAILED ─────────────────────────────────────────────────────────────
  const broken = await db.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM "_prisma_migrations"
     WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL
     ORDER BY started_at ASC
  `;
  if (broken.length > 0) {
    const names = broken.map((row) => row.migration_name).join(", ");
    return decide(
      "FAILED",
      `A migration is recorded as unfinished or rolled back (${names}). ` +
        "Prisma leaves it recorded and it blocks every later migration, so " +
        "restarting will fail identically (P3009). Restore the pre-migration " +
        "backup taken before that start, or resolve it deliberately with " +
        "`prisma migrate resolve` from the host.",
    );
  }

  const appliedSet = new Set(applied);
  const pending = imageMigrations.filter((name) => !appliedSet.has(name));

  // ── 4. PARTIAL / TAMPERED ─────────────────────────────────────────────────
  //
  // ONE READING D-098 DOES NOT STATE, and it has to be made somewhere.
  // Predicate 4 asks about a ROW in `InstallationBootstrap`; it presumes the
  // TABLE exists. On a schema older than the migration that creates that table
  // the predicate is not merely false, it is unanswerable — and answering it
  // "false" would classify every pre-`InstallationBootstrap` installation as
  // PARTIAL or TAMPERED and refuse to migrate it forward, which is precisely
  // the upgrade path predicate 5 exists for. So when the table is absent AND
  // this image ships migrations the database has not applied, the state is
  // EXISTING: the missing table is one of the things the pending migrations
  // create. The record cannot exist yet, so nothing is being skipped.
  //
  // The absent table with NOTHING pending is a different matter: a schema that
  // claims to be current while missing a table this image's own migrations
  // create is not a state to migrate, and falls through to the counts below.
  const bootstrapExists = await tableExists(db, "InstallationBootstrap");
  if (!bootstrapExists && pending.length > 0) {
    return decide(
      "EXISTING",
      `The schema predates this image's InstallationBootstrap table and ` +
        `${pending.length} migration(s) are unapplied ` +
        `(${pending.join(", ")}). A pre-migration backup is taken first ` +
        "(D-044), then migrations run forward.",
      { pendingMigrations: pending },
    );
  }

  const completed = bootstrapExists
    ? await db.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) AS count FROM "InstallationBootstrap"
         WHERE "completedAt" IS NOT NULL
      `
    : [{ count: BigInt(0) }];

  if (Number(completed[0]?.count ?? 0) === 0) {
    const data = await countInstallationData(db);
    const populated =
      data.userAccounts > 0 || data.people > 0 || data.roleAssignments > 0;

    if (populated) {
      return decide(
        "TAMPERED",
        "There is no completed InstallationBootstrap record, but the " +
          `installation holds data (${data.people} person row(s), ` +
          `${data.userAccounts} account(s), ${data.roleAssignments} role ` +
          "assignment(s)). Setup mode is an UNAUTHENTICATED administrative " +
          "surface and must never open on a populated database (D-099), so " +
          "this refuses to serve. Clear it deliberately from the host with " +
          "`splashtrack bootstrap:clear-tampered` once you know why the " +
          "record is missing.",
      );
    }

    return decide(
      "PARTIAL",
      "The schema exists but first-run setup has not completed, and the " +
        "installation holds no person, account or role data. Setup mode; " +
        "nothing is migrated silently.",
    );
  }

  // ── 5. EXISTING ───────────────────────────────────────────────────────────
  if (pending.length > 0) {
    return decide(
      "EXISTING",
      `${pending.length} migration(s) in this image have not been applied ` +
        `(${pending.join(", ")}). A pre-migration backup is taken first ` +
        "(D-044), then migrations run forward.",
      { pendingMigrations: pending },
    );
  }

  // ── 6. CURRENT ────────────────────────────────────────────────────────────
  return decide(
    "CURRENT",
    `The schema matches this image (${applied.length} migration(s) applied). ` +
      "Serving.",
  );
}
