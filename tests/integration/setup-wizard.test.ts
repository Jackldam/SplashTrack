/**
 * D-099 against REAL databases: the setup wizard, at every point of a real
 * first run, and at the two points where it must be shut.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS ADDS TO THE UNIT TEST
 *
 * `tests/unit/setup-wizard-gate.test.ts` proves `decideWizardAccess` is total
 * and gives the right answer for every member of `BootState`. That is a
 * statement about a function. It says nothing about whether those states are
 * REACHABLE, or whether the real detector reports them — and the failure this
 * suite exists to catch is the one that actually happened on 2026-09-04: a
 * predicate that read the wrong thing and classified a live installation as
 * something it was not.
 *
 * So every case here builds a real database with the real commands, asks the
 * real `detectBootState`, and feeds its answer to the real gate.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE NEGATIVE IS THE POINT, AND IT IS THE SAME DATABASE
 *
 * The `TAMPERED` case is not a separate fixture. It is the installation from
 * the case before it with ONE ROW REMOVED — F-98's exact primitive, the thing
 * D-099 exists for. If the wizard's gate had been written as "not CURRENT" it
 * would pass every other case in this file and fail that one.
 *
 * And it is asserted under the STRONGEST caller, not the weakest: a valid
 * wizard cookie AND a signed-in pending session, together. Neither reopens it,
 * because neither is the gate.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import {
  detectBootState,
  imageMigrationNames,
  type BootStateReader,
} from "@/lib/boot/state";
import { claimSchemaForOwner } from "@/lib/database/apply-role-model";
import {
  migrationUrlFrom,
  REFERENCE_OWNER_ROLE,
} from "@/lib/database/role-model";
import { decideWizardAccess, type WizardStage } from "@/lib/setup/gate";

import { runSplashtrackCli } from "../support/cli-runner";

const IMAGE_MIGRATIONS = imageMigrationNames();

/** The password the wizard's stand-in — `admin:create` — is given on stdin. */
const ADMIN_PASSWORD = "correct-horse-battery-staple";

const created: string[] = [];

function adminUrl(): string {
  const url = new URL(process.env.DATABASE_MAINTENANCE_URL as string);
  url.pathname = "/postgres";
  return url.toString();
}

function maintenanceUrlFor(database: string): string {
  const url = new URL(process.env.DATABASE_MAINTENANCE_URL as string);
  url.pathname = `/${database}`;
  return url.toString();
}

function runtimeUrlFor(database: string): string {
  const url = new URL(process.env.DATABASE_URL as string);
  url.pathname = `/${database}`;
  return url.toString();
}

/** The two connection strings the CLI needs, for one throwaway database. */
function cliEnv(database: string) {
  return {
    databaseUrl: runtimeUrlFor(database),
    maintenanceUrl: maintenanceUrlFor(database),
  };
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

async function createEmptyDatabase(suffix: string): Promise<string> {
  const database = `splashtrack_wizard_${suffix}_test`;
  await withAdmin(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${database}"`);
    await client.query(`CREATE DATABASE "${database}"`);
  });
  await claimSchemaForOwner(maintenanceUrlFor(database), REFERENCE_OWNER_ROLE);
  created.push(database);
  return database;
}

/** Raw SQL as the OWNER — the identity that may change a table's rows here. */
async function asOwner(database: string, statements: string[]): Promise<void> {
  const client = new Client({
    connectionString: migrationUrlFrom(
      maintenanceUrlFor(database),
      REFERENCE_OWNER_ROLE,
    ),
  });
  await client.connect();
  try {
    for (const statement of statements) await client.query(statement);
  } finally {
    await client.end();
  }
}

/**
 * What the wizard shows, against one real database, for the three kinds of
 * caller that could reach it. All three in one object so a case asserts the
 * WHOLE answer rather than the one branch it happened to think of.
 */
async function wizardFor(database: string): Promise<{
  state: string;
  anonymous: WizardStage;
  withCookie: WizardStage;
  strongest: WizardStage;
}> {
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: runtimeUrlFor(database) }),
  });
  try {
    const decision = await detectBootState(
      IMAGE_MIGRATIONS,
      client as unknown as BootStateReader,
    );
    const at = (hasWizardCookie: boolean, signedInPending: boolean) =>
      decideWizardAccess({
        state: decision.state,
        hasWizardCookie,
        signedInPending,
      });

    return {
      state: decision.state,
      anonymous: at(false, false),
      withCookie: at(true, false),
      // BOTH credentials at once — the strongest thing any caller could hold.
      strongest: at(true, true),
    };
  } finally {
    await client.$disconnect();
  }
}

afterAll(async () => {
  for (const database of created) {
    await withAdmin((client) =>
      client.query(`DROP DATABASE IF EXISTS "${database}"`),
    );
  }
});

describe("the wizard, along a real first run", () => {
  it(
    "opens on EMPTY and PARTIAL, and asks for the token first",
    { timeout: 180_000 },
    async () => {
      const database = await createEmptyDatabase("open");

      // ── docker compose up, on a genuinely empty database ─────────────────
      expect(await wizardFor(database)).toEqual({
        state: "EMPTY",
        // NOTHING BUT A TOKEN BOX for a stranger who found the address. That
        // is D-039's race closed: the wizard is reachable and it is useless
        // without a credential only host access yields.
        anonymous: "TOKEN",
        withCookie: "ADMINISTRATOR",
        strongest: "ADMINISTRATOR",
      });

      // ── migrations applied, catalogue seeded, no account yet ─────────────
      runSplashtrackCli(cliEnv(database), ["setup:init"]);

      expect(await wizardFor(database)).toEqual({
        state: "PARTIAL",
        anonymous: "TOKEN",
        withCookie: "ADMINISTRATOR",
        strongest: "ADMINISTRATOR",
      });
    },
  );

  it(
    "requires a SESSION once an administrator exists, never the token",
    { timeout: 180_000 },
    async () => {
      const database = await createEmptyDatabase("pending");
      runSplashtrackCli(cliEnv(database), ["setup:init"]);
      runSplashtrackCli(
        cliEnv(database),
        ["admin:create", "--email", "beheerder@example.org"],
        `${ADMIN_PASSWORD}\n${ADMIN_PASSWORD}\n`,
      );

      expect(await wizardFor(database)).toEqual({
        state: "PENDING_ENROLMENT",
        // THE PROPERTY THAT KEEPS D-099 TRUE WHILE THIS STATE SERVES. The
        // database now HOLDS DATA — a person, an account, two grants — and the
        // wizard is no longer an unauthenticated surface on it: a caller with
        // no session is sent to sign in, and a wizard cookie buys nothing at
        // all, because the token it came from is spent.
        anonymous: "SIGN_IN_REQUIRED",
        withCookie: "SIGN_IN_REQUIRED",
        strongest: "ENROLMENT",
      });
    },
  );
});

describe("the wizard, where it must be shut", () => {
  it(
    "is CLOSED on a populated database whose bootstrap record was removed",
    { timeout: 180_000 },
    async () => {
      // F-98, EXACTLY. The same installation as the case above, with one row
      // deleted — the primitive an SQL injection, a compromised low-privilege
      // credential, a botched restore or an erasure bug all yield.
      const database = await createEmptyDatabase("tampered");
      runSplashtrackCli(cliEnv(database), ["setup:init"]);
      runSplashtrackCli(
        cliEnv(database),
        ["admin:create", "--email", "beheerder@example.org"],
        `${ADMIN_PASSWORD}\n${ADMIN_PASSWORD}\n`,
      );

      // Before: it serves. This is what makes the assertion after the DELETE
      // non-vacuous — the wizard was genuinely open on this database a moment
      // ago, so the refusal below is the deletion and not the fixture.
      expect((await wizardFor(database)).strongest).toBe("ENROLMENT");

      await asOwner(database, ['DELETE FROM "InstallationBootstrap"']);

      expect(await wizardFor(database)).toEqual({
        state: "TAMPERED",
        // SHUT TO EVERYTHING, including a caller holding a valid wizard cookie
        // AND a signed-in pending session at the same time. Neither is the
        // gate; the installation's own state is.
        anonymous: "CLOSED",
        withCookie: "CLOSED",
        strongest: "CLOSED",
      });
    },
  );

  it(
    "is CLOSED forever once setup has completed",
    { timeout: 180_000 },
    async () => {
      const database = await createEmptyDatabase("current");
      runSplashtrackCli(cliEnv(database), ["setup:init"]);
      runSplashtrackCli(
        cliEnv(database),
        ["admin:create", "--email", "beheerder@example.org"],
        `${ADMIN_PASSWORD}\n${ADMIN_PASSWORD}\n`,
      );

      expect((await wizardFor(database)).strongest).toBe("ENROLMENT");

      // What `verifyEnrolment` writes at the instant D-141's invariant first
      // holds. Written here rather than driven through Better Auth because
      // what is under test is the GATE's reaction to a completed installation,
      // and the enrolment flow itself is covered by
      // `tests/integration/mfa-enrolment.test.ts`.
      await asOwner(database, [
        `UPDATE "InstallationBootstrap"
            SET "completedAt" = now(), "completedVia" = 'wizard'`,
      ]);

      expect(await wizardFor(database)).toEqual({
        state: "CURRENT",
        // D-039's "self-destructs", as a property of the SURFACE rather than of
        // a credential: somebody who set this instance up, kept their cookie
        // and came back gets nothing.
        anonymous: "CLOSED",
        withCookie: "CLOSED",
        strongest: "CLOSED",
      });
    },
  );
});
