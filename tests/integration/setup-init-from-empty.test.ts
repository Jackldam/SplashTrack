/**
 * A new installation on a GENUINELY EMPTY database, end to end, as a
 * self-hoster runs it: `setup:init`, then `admin:create`.
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

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
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
  const result = runCliRaw(database, ...args);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(
      `splashtrack ${args.join(" ")} exited ${result.status}:\n${output}`,
    );
  }
  return output;
}

/**
 * The same CLI invocation, WITHOUT the non-zero-exit throw — for the cases that
 * are about the exit code. `boot:state` returns 1 on a REFUSE state precisely so
 * a caller that forgets to branch still fails, and a test that could only ever
 * see 0 could not tell serving from refusing.
 */
function runCliRaw(
  database: string,
  ...args: string[]
): { status: number | null; stdout: string; stderr: string } {
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
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** `boot:state`'s machine line — `<STATE> <ACTION>` — and its exit code. */
function bootState(database: string): { line: string; status: number | null } {
  const result = runCliRaw(database, "boot:state");
  return { line: result.stdout.trim(), status: result.status };
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

describe("admin:create on a migrated, seeded database", () => {
  it(
    "creates a pending administrator without ever asking for a code",
    { timeout: 120_000 },
    async () => {
      const database = await createEmptyDatabase("admin");
      runCli(database, "setup:init");

      // `--password-file` is the documented non-interactive path (see
      // `src/cli/prompt.ts`); a flag VALUE would be in shell history and `ps`.
      const workDirectory = mkdtempSync(path.join(tmpdir(), "splashtrack-"));
      const passwordFile = path.join(workDirectory, "password");
      writeFileSync(passwordFile, "correct-horse-battery-staple\n", {
        mode: 0o600,
      });

      // THE DEFECT, AS A TEST. `stdio` is not a TTY and carries no input at
      // all, so the old command — which blocked on "Six-digit code from your
      // authenticator:" — could only have failed here. Completing is the
      // proof: `runCli` throws on a non-zero exit and the case times out if
      // the command ever waits for a human again.
      const output = runCli(
        database,
        "admin:create",
        "--email",
        "beheerder@example.org",
        "--name",
        "Eerste Beheerder",
        "--password-file",
        passwordFile,
      );

      expect(output).toContain("Administrator created: beheerder@example.org");
      expect(output).toContain("NOT YET ENROLLED");
      expect(output).toContain("SETUP IS NOT COMPLETE");
      // The URL it sends the operator to, taken from BETTER_AUTH_URL.
      expect(output).toMatch(/https?:\/\/\S+\/sign-in/);
      // And it did NOT ask for anything it could not show.
      expect(output).not.toContain("Six-digit code");
      expect(output).not.toContain("otpauth://");

      // NO ARTEFACT. The 0600 enrolment file is gone from this path: there is
      // no secret for it to hold, and `data/` is where it used to land.
      const workingDirectoryEntries = readdirSync(process.cwd());
      expect(
        workingDirectoryEntries.includes("data") &&
          readdirSync(path.join(process.cwd(), "data")).some((entry) =>
            entry.startsWith("mfa-enrolment-"),
          ),
      ).toBe(false);

      await asRuntime(database, async (client) => {
        // The account exists, with its ORGANIZATION grant …
        const accounts = await client.query<{ id: string; email: string }>(
          'SELECT id, email FROM "UserAccount"',
        );
        expect(accounts.rows).toHaveLength(1);
        expect(accounts.rows[0].email).toBe("beheerder@example.org");

        const grants = await client.query<{ scopeType: string; key: string }>(
          `SELECT ra."scopeType", r.key
             FROM "RoleAssignment" ra JOIN "Role" r ON r.id = ra."roleId"
            ORDER BY r.key`,
        );
        expect(grants.rows).toEqual([
          { scopeType: "ORGANIZATION", key: "instance_administrator" },
          { scopeType: "SELF", key: "self" },
        ]);

        // … and NO MFA factor, which is what makes it `mfa_pending`.
        const factors = await client.query('SELECT 1 FROM "TwoFactor"');
        expect(factors.rowCount).toBe(0);

        // … and no session left behind for a browser nobody was using.
        const sessions = await client.query('SELECT 1 FROM "Session"');
        expect(sessions.rowCount).toBe(0);

        // SETUP IS NOT COMPLETE. The bootstrap record is written by the
        // enrolment flow, at the instant D-141's invariant first holds.
        const bootstrap = await client.query(
          'SELECT 1 FROM "InstallationBootstrap" WHERE "completedAt" IS NOT NULL',
        );
        expect(bootstrap.rowCount).toBe(0);

        // The break-glass event and its banner are unchanged.
        const audit = await client.query<{ eventType: string }>(
          `SELECT "eventType" FROM "AuditEvent"
            WHERE "eventType" = 'security.break_glass.admin_create'`,
        );
        expect(audit.rowCount).toBe(1);
      });
    },
  );
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE WHOLE FIRST-RUN PATH, AS AN OPERATOR WALKS IT (D-186)
 *
 * The three cases above each prove one command. This one proves the SEQUENCE,
 * which is where it broke: every command succeeded, and the installation was
 * unusable anyway, because after the last of them the container refused to
 * start.
 *
 * The property asserted is the one that failed on 2026-09-04: at EVERY point in
 * the path, `boot:state` exits 0 and names an action that serves. No step needs
 * `bootstrap:clear-tampered`, and no step needs a human who already knows the
 * answer.
 */
describe("the first-run path, end to end", () => {
  it(
    "never leaves the installation in a state that refuses to start",
    { timeout: 180_000 },
    async () => {
      const database = await createEmptyDatabase("firstrun");

      // ── docker compose up, on a genuinely empty database ──────────────────
      expect(bootState(database)).toEqual({
        line: "EMPTY SETUP_MODE",
        status: 0,
      });

      // ── setup:init ────────────────────────────────────────────────────────
      const init = runCli(database, "setup:init");
      expect(init).toContain("First-run setup recorded as started.");
      // It tells the operator what the running container now sees, because the
      // start-up log they are looking at describes a database that is gone.
      expect(init).toContain("Boot state is now PARTIAL (SETUP_MODE)");
      expect(init).toContain("does NOT need restarting");

      expect(bootState(database)).toEqual({
        line: "PARTIAL SETUP_MODE",
        status: 0,
      });

      // The started record exists and is NOT a completed one. Both halves
      // matter: the first is what predicate 4 reads, the second is what keeps
      // setup mode from closing over an installation with no administrator.
      await asRuntime(database, async (client) => {
        const rows = await client.query<{ completedAt: Date | null }>(
          'SELECT "completedAt" FROM "InstallationBootstrap"',
        );
        expect(rows.rows).toEqual([{ completedAt: null }]);
      });

      // ── admin:create ──────────────────────────────────────────────────────
      const workDirectory = mkdtempSync(path.join(tmpdir(), "splashtrack-"));
      const passwordFile = path.join(workDirectory, "password");
      writeFileSync(passwordFile, "correct-horse-battery-staple\n", {
        mode: 0o600,
      });

      const create = runCli(
        database,
        "admin:create",
        "--email",
        "beheerder@example.org",
        "--password-file",
        passwordFile,
      );
      expect(create).toContain("Boot state is now PENDING_ENROLMENT");

      // THE REGRESSION, IN ONE ASSERTION. This is the exact point at which the
      // container refused to start: one person, one account, two grants, no
      // completed bootstrap record. It now serves, and `boot:state` exits 0 so
      // the entrypoint proceeds.
      expect(bootState(database)).toEqual({
        line: "PENDING_ENROLMENT SETUP_MODE",
        status: 0,
      });

      // ── and TAMPERED is still real on this very database ──────────────────
      //
      // Not a separate fixture: the same installation, one row removed. If the
      // fix had merely widened the predicate, this would still serve.
      await asRuntime(database, (client) =>
        client.query('DELETE FROM "InstallationBootstrap"'),
      );
      const tampered = runCliRaw(database, "boot:state");
      expect(tampered.stdout.trim()).toBe("TAMPERED REFUSE");
      expect(tampered.status).toBe(1);
      expect(tampered.stderr).toContain(
        "nothing recorded that setup ever started",
      );

      // Put it back, so the last word of this case is the path working.
      await asRuntime(database, (client) =>
        client.query(
          `INSERT INTO "InstallationBootstrap" (id, "createdAt", "updatedAt")
             VALUES ('installation', now(), now())`,
        ),
      );
      expect(bootState(database)).toEqual({
        line: "PENDING_ENROLMENT SETUP_MODE",
        status: 0,
      });
    },
  );
});

describe("admin:reset-mfa", () => {
  it(
    "still enrols from the terminal, for a lost authenticator",
    { timeout: 180_000 },
    async () => {
      // KEPT DELIBERATELY, and therefore tested. D-185 moved `admin:create`'s
      // enrolment to the browser but left this one on the terminal, because
      // D-141 requires a verified factor on a local ORGANIZATION account AT ALL
      // TIMES and this command is what a single-administrator installation runs
      // when its authenticator is gone — see the header of
      // `src/cli/commands/admin.ts`. It is also the only remaining caller of
      // the 0600 artefact writer, so this case is what keeps that path alive
      // rather than merely present.
      //
      // It is driven the way an operator drives it: the command blocks on a
      // prompt, the artefact file is read WHILE it blocks, and the code is
      // typed back. That is exactly the interaction `admin:create` could not
      // support — there the file and the prompt were both new, so there was
      // nothing to read yet when the block began.
      const database = await createEmptyDatabase("resetmfa");
      runCli(database, "setup:init");

      const workDirectory = mkdtempSync(path.join(tmpdir(), "splashtrack-"));
      const passwordFile = path.join(workDirectory, "password");
      writeFileSync(passwordFile, "correct-horse-battery-staple\n", {
        mode: 0o600,
      });

      runCli(
        database,
        "admin:create",
        "--email",
        "beheerder@example.org",
        "--password-file",
        passwordFile,
      );

      const artefactDirectory = path.join(workDirectory, "out");
      const child = spawn(
        process.execPath,
        [
          path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
          path.resolve(process.cwd(), "scripts/cli-dev.ts"),
          "admin:reset-mfa",
          "--email",
          "beheerder@example.org",
          "--password-file",
          passwordFile,
          "--out",
          artefactDirectory,
        ],
        {
          env: {
            ...process.env,
            DATABASE_URL: runtimeUrlFor(database),
            DATABASE_MAINTENANCE_URL: maintenanceUrlFor(database),
          },
        },
      );

      let output = "";
      child.stdout.on("data", (chunk) => (output += String(chunk)));
      child.stderr.on("data", (chunk) => (output += String(chunk)));

      // Wait for the artefact to appear — the command has reached its prompt.
      const artefact = await waitForArtefact(artefactDirectory);
      const totpURI = artefact.match(/otpauth:\/\/\S+/)![0];
      const key = new TextDecoder().decode(
        base32.decode(new URL(totpURI).searchParams.get("secret")!),
      );
      child.stdin.write(`${await createOTP(key).totp()}\n`);
      child.stdin.end();

      const status = await new Promise<number>((resolve) =>
        child.on("close", (code) => resolve(code ?? 1)),
      );
      expect(status, output).toBe(0);
      expect(output).toContain("MFA reset and re-enrolled");
      // The secret went to the file and to nowhere else.
      expect(output).not.toContain(totpURI);
      expect(output).not.toContain(key);

      await asRuntime(database, async (client) => {
        const factors = await client.query<{ verified: boolean }>(
          'SELECT verified FROM "TwoFactor"',
        );
        expect(factors.rows).toEqual([{ verified: true }]);
      });
    },
  );
});

/** Polls for the one file `writeEnrolmentArtefact` creates, then reads it. */
async function waitForArtefact(directory: string): Promise<string> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      const [file] = readdirSync(directory).filter((entry) =>
        entry.startsWith("mfa-enrolment-"),
      );
      if (file) return readFileSync(path.join(directory, file), "utf8");
    } catch {
      // The directory does not exist yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No enrolment artefact appeared in ${directory}`);
}
