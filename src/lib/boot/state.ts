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
 *   3. any row stuck mid-flight — `finished_at IS NULL` AND
 *      `rolled_back_at IS NULL` (see the note in the code)      → FAILED
 *   4. no `InstallationBootstrap` row with `completedAt`        → PARTIAL
 *      …with data, and setup demonstrably still running         → PENDING_ENROLMENT
 *      …with data otherwise                                     → TAMPERED
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

/**
 * The six states of D-098, plus D-099's `TAMPERED` and D-186's
 * `PENDING_ENROLMENT`.
 *
 * `PENDING_ENROLMENT` is `PARTIAL` with the administrator already created — the
 * window D-185 opened on purpose, between `admin:create` and the browser
 * enrolment that completes setup. It is its own state rather than a shade of
 * `PARTIAL` because the two have different remedies and the entrypoint prints
 * one of them: telling an operator to run `admin:create` when they have already
 * run it is how tonight's hour was spent.
 */
export type BootState =
  | "EMPTY"
  | "AHEAD"
  | "FAILED"
  | "PARTIAL"
  | "PENDING_ENROLMENT"
  | "TAMPERED"
  | "EXISTING"
  | "CURRENT";

/** What the entrypoint is allowed to do in a state. */
export type BootAction =
  "SETUP_MODE" | "MIGRATE_THEN_SERVE" | "SERVE" | "REFUSE";

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
  PENDING_ENROLMENT: "SETUP_MODE",
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

/**
 * One row per recorded migration, with the two flags every predicate below
 * turns on.
 *
 * `finished` and `rolledBack` are read SEPARATELY rather than collapsed into
 * "did it work", because they mean different things and D-098's predicate 3
 * conflates them — see {@link detectBootState}.
 */
interface MigrationRecord {
  name: string;
  finished: boolean;
  rolledBack: boolean;
}

async function migrationRecords(
  db: BootStateReader,
): Promise<MigrationRecord[]> {
  const rows = await db.$queryRaw<
    { migration_name: string; finished: boolean; rolled_back: boolean }[]
  >`
    SELECT migration_name,
           finished_at IS NOT NULL   AS finished,
           rolled_back_at IS NOT NULL AS rolled_back
      FROM "_prisma_migrations"
     ORDER BY started_at ASC
  `;
  return rows.map((row) => ({
    name: row.migration_name,
    finished: row.finished,
    rolledBack: row.rolled_back,
  }));
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
 * What predicate 4 needs to know about a database that has NOT completed setup.
 *
 * D-099 asked three of these questions — is there an account, a person, a role
 * assignment — and treated any "yes" as tampering. D-186 keeps that rule and
 * adds the three that tell the two situations apart; see {@link detectBootState}
 * for the argument.
 */
interface InstallationShape {
  userAccounts: number;
  people: number;
  roleAssignments: number;
  /**
   * MFA factors that are not definitively unverified. `TwoFactor.verified` is
   * nullable in the schema with a default of `true`, so a NULL is counted as
   * enrolled: the direction that errs is the direction that refuses to serve.
   */
  enrolledFactors: number;
  /** `Person` rows that are not the person of a `UserAccount`. */
  peopleWithoutAccount: number;
  /** `RoleAssignment` rows whose subject holds no `UserAccount`. */
  roleAssignmentsWithoutAccount: number;
}

/**
 * Reads {@link InstallationShape} with raw SQL, every query guarded by a
 * table-existence check — predicate 4 is reachable on a database that has
 * `_prisma_migrations` and a partial schema.
 *
 * WHERE A TABLE IS MISSING THE ANSWER IS THE PESSIMISTIC ONE. `Person` present
 * without `UserAccount` means every person is unaccounted for, not that none is:
 * a half-built schema is not evidence of a tidy installation.
 */
async function inspectInstallation(
  db: BootStateReader,
): Promise<InstallationShape> {
  const tables = new Map<string, boolean>();
  for (const table of [
    "UserAccount",
    "Person",
    "RoleAssignment",
    "TwoFactor",
  ]) {
    tables.set(table, await tableExists(db, table));
  }

  async function scalar(query: string): Promise<number> {
    // Every query below is a literal in this file; nothing here is input.
    const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(query);
    return Number(rows[0]?.count ?? 0);
  }

  async function countOf(table: string): Promise<number> {
    if (!tables.get(table)) return 0;
    return scalar(`SELECT COUNT(*) AS count FROM "${table}"`);
  }

  const [userAccounts, people, roleAssignments] = await Promise.all([
    countOf("UserAccount"),
    countOf("Person"),
    countOf("RoleAssignment"),
  ]);

  const enrolledFactors = tables.get("TwoFactor")
    ? await scalar(
        `SELECT COUNT(*) AS count FROM "TwoFactor"
          WHERE verified IS DISTINCT FROM false`,
      )
    : 0;

  const peopleWithoutAccount = !tables.get("Person")
    ? 0
    : tables.get("UserAccount")
      ? await scalar(
          `SELECT COUNT(*) AS count FROM "Person" p
            WHERE NOT EXISTS (
              SELECT 1 FROM "UserAccount" u WHERE u."personId" = p.id
            )`,
        )
      : people;

  const roleAssignmentsWithoutAccount = !tables.get("RoleAssignment")
    ? 0
    : tables.get("UserAccount")
      ? await scalar(
          `SELECT COUNT(*) AS count FROM "RoleAssignment" ra
            WHERE NOT EXISTS (
              SELECT 1 FROM "UserAccount" u WHERE u."personId" = ra."personId"
            )`,
        )
      : roleAssignments;

  return {
    userAccounts,
    people,
    roleAssignments,
    enrolledFactors,
    peopleWithoutAccount,
    roleAssignmentsWithoutAccount,
  };
}

/**
 * Why a populated, un-completed installation is NOT the D-185 window — empty
 * when it is.
 *
 * Each entry is a fact an operator can check against their own installation,
 * because "this looks wrong" is not something anybody can act on at 23:00.
 */
function tamperingEvidence(shape: InstallationShape): string[] {
  const evidence: string[] = [];
  if (shape.enrolledFactors > 0) {
    evidence.push(
      `${shape.enrolledFactors} account(s) hold an MFA factor, so somebody ` +
        "has already finished enrolling — setup cannot still be running",
    );
  }
  if (shape.peopleWithoutAccount > 0) {
    evidence.push(
      `${shape.peopleWithoutAccount} person row(s) belong to nobody with an ` +
        "account, and first-run setup creates none of those",
    );
  }
  if (shape.roleAssignmentsWithoutAccount > 0) {
    evidence.push(
      `${shape.roleAssignmentsWithoutAccount} role assignment(s) name a ` +
        "person who has no account, and first-run setup creates none of those",
    );
  }
  return evidence;
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

  const records = await migrationRecords(db);
  const imageSet = new Set(imageMigrations);

  // ── 2. AHEAD ──────────────────────────────────────────────────────────────
  //
  // Every RECORDED name, rolled back or not. A rolled-back unknown migration
  // still means a newer image reached this database, and refusing to start is
  // recoverable in seconds where guessing is not.
  const unknown = records
    .map((record) => record.name)
    .filter((name) => !imageSet.has(name));
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
  //
  // D-098 WRITES THIS PREDICATE AS `finished_at IS NULL OR rolled_back_at IS
  // NOT NULL`, AND THAT READING MAKES ITS OWN RECOVERY UNREACHABLE. Measured,
  // not reasoned about: `prisma migrate resolve --rolled-back <name>` — the
  // command this state's message tells the operator to run — leaves the row
  // with `finished_at` still NULL and `rolled_back_at` SET. Under the literal
  // predicate the container then reports FAILED forever, having done exactly
  // what it was told.
  //
  // The two flags mean different things, so they are read separately:
  //
  //   unfinished, NOT rolled back → the migration is stuck MID-FLIGHT. Prisma
  //     keeps it recorded and it blocks every later migration (P3009), so a
  //     restart fails identically. Refuse, and name the recovery.
  //   rolled back                 → the operator has ALREADY acted. Prisma
  //     treats the row as not applied and `migrate deploy` re-applies it, so
  //     this is an ordinary pending migration and falls through to predicate 5.
  //
  // This keeps everything D-098 wanted — a stuck migration never turns into a
  // silent crash loop — and removes a dead end the decision did not intend.
  const broken = records.filter(
    (record) => !record.finished && !record.rolledBack,
  );
  if (broken.length > 0) {
    const names = broken.map((record) => record.name).join(", ");
    return decide(
      "FAILED",
      `A migration is recorded as started and never finished (${names}). ` +
        "Prisma leaves it recorded and it blocks every later migration, so " +
        "restarting will fail identically (P3009). Restore the pre-migration " +
        "backup taken before that start, or resolve it deliberately with " +
        "`prisma migrate resolve` from the host.",
    );
  }

  // SUCCESSFULLY applied, which is not the same as recorded: a rolled-back row
  // is recorded and is not applied, and counting it would let the container
  // report CURRENT on a schema missing that migration's tables.
  const appliedSet = new Set(
    records
      .filter((record) => record.finished && !record.rolledBack)
      .map((record) => record.name),
  );
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

  const bootstrapRows = bootstrapExists
    ? await db.$queryRaw<{ started: bigint; completed: bigint }[]>`
        SELECT COUNT(*) AS started,
               COUNT(*) FILTER (WHERE "completedAt" IS NOT NULL) AS completed
          FROM "InstallationBootstrap"
      `
    : [{ started: BigInt(0), completed: BigInt(0) }];
  const started = Number(bootstrapRows[0]?.started ?? 0);
  const completed = Number(bootstrapRows[0]?.completed ?? 0);

  if (completed === 0) {
    // ── D-186 — THE CORRECTION D-099'S PREDICATE NEEDED ──────────────────────
    //
    // D-099 is right and is not weakened here: setup mode is an
    // UNAUTHENTICATED administrative surface and must never open on a populated
    // database (F-98). Its PREDICATE was wrong, because since D-185 there is a
    // legitimate state in which data exists and setup has not completed —
    // `admin:create` has run, the administrator has not yet enrolled a second
    // factor, and the browser enrolment that writes the record is the very page
    // the operator needs. D-099 refused to serve it, which locked the owner out
    // of the one screen that could finish the install.
    //
    // The two situations are told apart by TWO independent facts, and setup
    // mode opens only when BOTH hold. Either one failing is TAMPERED.
    //
    //   1. THE INSTALLATION SAYS SETUP STARTED. `setup:init` and
    //      `admin:create` write the `InstallationBootstrap` row with
    //      `completedAt` NULL before they create anything (see
    //      `recordSetupStarted` in ./setup-mode.ts), so the row's EXISTENCE is
    //      the record that first-run setup is under way. "Data present with no
    //      row at all" therefore stays exactly as suspicious as D-099 made it:
    //      deleting the row — the primitive F-98 is about — still fires
    //      TAMPERED, on a pending installation as much as on a finished one.
    //
    //   2. THE DATA IS ONLY WHAT SETUP ITSELF CREATES. Every person has an
    //      account, every role assignment names one of those people, and NO
    //      account holds an MFA factor. That is exactly what `admin:create`
    //      leaves behind and it is nothing like a running installation, where
    //      D-141 requires a verified factor at all times and where the person
    //      rows are mostly children who will never have an account.
    //
    // Condition 2 is what keeps this from being weaker than a single deletable
    // row. An attacker who can UPDATE — a strictly stronger primitive than the
    // DELETE F-98 describes — cannot reopen setup mode by clearing
    // `completedAt` on a real installation: the factors and the unaccounted
    // people are still there, and they are not one statement to remove.
    const shape = await inspectInstallation(db);
    const populated =
      shape.userAccounts > 0 || shape.people > 0 || shape.roleAssignments > 0;

    if (!populated) {
      return decide(
        "PARTIAL",
        "The schema exists but first-run setup has not completed, and the " +
          "installation holds no person, account or role data. Setup mode; " +
          "nothing is migrated silently.",
      );
    }

    const evidence = tamperingEvidence(shape);

    if (started > 0 && evidence.length === 0) {
      return decide(
        "PENDING_ENROLMENT",
        `First-run setup is still running: ${shape.userAccounts} ` +
          "administrator account(s) exist, none has enrolled a second factor, " +
          "and the installation holds nothing else. Setup completes in the " +
          "browser the moment one of them verifies an authenticator (D-185), " +
          "so this serves. Nothing is migrated.",
      );
    }

    return decide(
      "TAMPERED",
      "There is no completed InstallationBootstrap record, but the " +
        `installation holds data (${shape.people} person row(s), ` +
        `${shape.userAccounts} account(s), ${shape.roleAssignments} role ` +
        "assignment(s)), and this is NOT an unfinished first-run setup: " +
        (started === 0
          ? "there is no InstallationBootstrap row at all, so nothing " +
            "recorded that setup ever started here"
          : evidence.join("; ")) +
        ". Setup mode is an UNAUTHENTICATED administrative surface and must " +
        "never open on a populated database (D-099), so this refuses to " +
        "serve. Clear it deliberately from the host with `splashtrack " +
        "bootstrap:clear-tampered` once you know why the record is missing.",
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
    `The schema matches this image (${appliedSet.size} migration(s) applied). ` +
      "Serving.",
  );
}
