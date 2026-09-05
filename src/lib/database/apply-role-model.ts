/**
 * Puts the ADR-0002 role model in force on ONE database, and verifies it.
 *
 * Separate from `role-model.ts` — which is pure, and is imported by
 * `prisma.config.ts` — because this half opens a connection.
 *
 * THREE CALLERS, ONE IMPLEMENTATION, and that is the point:
 *
 *   `splashtrack db:apply-grants`   after every migration, from the entrypoint
 *   `scripts/setup-test-db.ts`      the `_test` database, on every `npm test`
 *   `scripts/recreate-database.ts`  the throwaway fresh-install check
 *
 * A second copy for the test databases is how the suite ends up running against
 * a database shaped unlike the real one, which would make every proof in
 * `tests/integration/database-role-model.test.ts` prove nothing about
 * production. ADR-0002 §4 is the same argument one level down: a dev database
 * shaped like the production one is where grant bugs surface cheaply.
 */

import { Client } from "pg";

import {
  auditGrantStatements,
  databaseProvisionStatements,
  migrationUrlFrom,
  ownershipReassignStatement,
  redactUrl,
  type RoleModelNames,
} from "./role-model";

export interface RoleModelOutcome {
  /** The role the session actually assumed. `owner` when all is well. */
  acting: string;
  /** The role that authenticated — the retention role. */
  session: string;
  /** Empty when the model is in force. Each entry is a stated defect. */
  failures: string[];
}

/**
 * Connects with the maintenance credential ACTING AS the owner, applies the
 * model, and re-reads it.
 *
 * `maintenanceUrl` may point at any database — that is how the `_test` and
 * scratch databases get the same treatment as the real one.
 */
export async function applyRoleModel(
  maintenanceUrl: string,
  names: RoleModelNames,
): Promise<RoleModelOutcome> {
  await claimSchemaForOwner(maintenanceUrl, names.owner);

  const client = new Client({
    connectionString: migrationUrlFrom(maintenanceUrl, names.owner),
  });

  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Could not connect as ${names.retention} acting as ${names.owner}: ` +
        `${(error as Error).message}\n` +
        `  Connection: ${redactUrl(maintenanceUrl)}\n` +
        `  If the message names the role, ${names.retention} is probably not ` +
        `a member of ${names.owner}. Re-run infra/provision-roles.sql.`,
    );
  }

  try {
    const [identity] = (
      await client.query<{ acting: string; session: string }>(
        "SELECT current_user AS acting, session_user AS session",
      )
    ).rows;

    if (identity.acting !== names.owner) {
      // Nothing has been changed yet, deliberately: applying grants from the
      // wrong grantor produces a state the right grantor cannot revoke.
      return {
        ...identity,
        failures: [
          `connected as ${identity.session} but acting as ${identity.acting}, ` +
            `not ${names.owner} — the \`options=-c role=…\` on the ` +
            "maintenance connection did not take effect, so nothing was changed",
        ],
      };
    }

    // Ownership first. Every grant below is made BY the owner, and a grant from
    // the wrong grantor cannot be revoked by the right one.
    await client.query(ownershipReassignStatement(names.owner));

    for (const statement of [
      ...databaseProvisionStatements(names),
      ...auditGrantStatements(names),
    ]) {
      await client.query(statement);
    }

    return { ...identity, failures: await verify(client, names) };
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Hands schema `public` to the owner, connecting AS THE RETENTION ROLE ITSELF
 * rather than as the owner.
 *
 * WHY IT CANNOT BE THE FIRST STATEMENT OF THE OWNER SESSION. A database created
 * by the retention role has its `public` schema owned by `pg_database_owner`,
 * whose implicit member is the database's owner — the retention role. The owner
 * role has no rights there at all yet, so a session acting AS the owner cannot
 * hand the schema to itself; only the role that currently owns it can give it
 * away. Hence a separate, briefly-held connection.
 *
 * WHY THE THROWAWAY DATABASES ARE OWNED BY RETENTION IN THE FIRST PLACE. They
 * have to be DROPPED again — by `boot-state-matrix`, by `db:recreate`, by the
 * `audit:grants` proof — and dropping a database requires owning it. The
 * membership in the owner role is deliberately NON-INHERITING (see
 * `infra/provision-roles.sql` §3), so retention does not own an
 * owner-owned database and could not drop one. Owning them outright and then
 * handing over the schema is what keeps both properties.
 *
 * The REAL database is different: `provision-roles.sql` gives it to the owner,
 * and nothing ever drops it.
 *
 * THE TEST IS THE PRIVILEGE, NOT THE `nspowner` COLUMN, and getting that wrong
 * cost a debugging round. On the real database `public` is owned by
 * `pg_database_owner` — a system role whose implicit member is whoever owns the
 * database — so `nspowner` reads `pg_database_owner` while the owner role
 * nevertheless has every right it needs. Comparing names there sends this
 * function on to an `ALTER SCHEMA` that the retention role is not entitled to
 * issue, and the whole command fails with `must be owner of schema public` on a
 * database that was already correct. `has_schema_privilege` answers the
 * question actually being asked: can the owner create things here?
 */
export async function claimSchemaForOwner(
  maintenanceUrl: string,
  owner: string,
): Promise<void> {
  const client = new Client({ connectionString: maintenanceUrl });
  await client.connect();
  try {
    const already = await client.query<{ usable: boolean }>(
      "SELECT has_schema_privilege($1, current_schema(), 'CREATE') AS usable",
      [owner],
    );
    if (already.rows[0]?.usable) return;

    // `format(%I)` rather than interpolation: the owner name reaches here from
    // a `--owner` flag or an environment variable.
    await client.query(
      `DO $$ BEGIN EXECUTE format('ALTER SCHEMA public OWNER TO %I', ` +
        `'${owner.replace(/'/g, "''")}'); END $$`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Re-reads the properties the ADR actually claims, rather than trusting that
 * the statements returned without error.
 *
 * This is not belt-and-braces. A `REVOKE` of a privilege held by OWNERSHIP
 * succeeds, reports success, and changes nothing at all — which is the exact
 * failure ADR-0002 §3 found, and it is invisible to any check that only asks
 * whether the statements ran.
 */
async function verify(
  client: Client,
  names: RoleModelNames,
): Promise<string[]> {
  const failures: string[] = [];

  const owners = await client.query<{ tablename: string; tableowner: string }>(
    `SELECT tablename, tableowner FROM pg_tables
      WHERE schemaname = current_schema()
        AND tablename IN ('AuditEvent', 'AuditCheckpoint')`,
  );
  for (const row of owners.rows) {
    if (row.tableowner !== names.owner) {
      failures.push(
        `${row.tablename} is owned by ${row.tableowner}, not ${names.owner}. ` +
          "An owner re-grants itself in one statement, so the revokes below " +
          "it are decorative.",
      );
    }
  }

  const writes = await client.query<{ privilege_type: string }>(
    `SELECT privilege_type FROM information_schema.table_privileges
      WHERE table_name = 'AuditEvent' AND grantee = $1
        AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')`,
    [names.app],
  );
  for (const row of writes.rows) {
    failures.push(
      `${names.app} still holds ${row.privilege_type} on AuditEvent.`,
    );
  }

  const superuser = await client.query<{ rolsuper: boolean }>(
    "SELECT rolsuper FROM pg_roles WHERE rolname = $1",
    [names.app],
  );
  if (superuser.rows[0]?.rolsuper) {
    failures.push(
      `${names.app} is a SUPERUSER, which bypasses every grant above — the ` +
        "revokes are not weak here, they are inert. ALTER ROLE it NOSUPERUSER " +
        "(D-116).",
    );
  }

  const canDelete = await client.query(
    `SELECT 1 FROM information_schema.table_privileges
      WHERE table_name = 'AuditEvent' AND grantee = $1
        AND privilege_type = 'DELETE'`,
    [names.retention],
  );
  if (canDelete.rowCount === 0) {
    failures.push(
      `${names.retention} does not hold DELETE on AuditEvent, so D-168's ` +
        "checkpointed retention has no role to run as — and retention is the " +
        "only thing that keeps audit rows from outliving their purpose.",
    );
  }

  return failures;
}
