/**
 * ADR-0002 / D-182 — the four database roles, and the one place their names,
 * their connections and their grants are decided.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FOUR ROLES, and which of them is a credential
 *
 *   splashtrack_owner       NOLOGIN. Owns the schema, every table and every
 *                           sequence. Has NO PASSWORD, so it is not a
 *                           credential and cannot be stolen — D-182's
 *                           "non-connecting owner/migrator". A migration
 *                           reaches it by SET ROLE from a member.
 *
 *   splashtrack_app         DATABASE_URL. The web process. Owns nothing.
 *                           INSERT+SELECT on AuditEvent, SELECT on
 *                           AuditCheckpoint, ordinary DML elsewhere. This role
 *                           IS D-149's append-only writer (D-182, ADR-0002
 *                           §7.5) — there is no separate writer connection.
 *
 *   splashtrack_retention   DATABASE_MAINTENANCE_URL. The only role holding
 *                           DELETE on AuditEvent (D-168: the checkpointed
 *                           prune is the only legitimate deleter). A MEMBER of
 *                           splashtrack_owner, which is how `prisma migrate
 *                           deploy` runs as the owner while the owner has no
 *                           password.
 *
 *   the provisioning superuser
 *                           Creates the three above, once. NEVER in `.env`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE MIGRATION CONNECTION IS DERIVED AND NOT A THIRD VARIABLE
 *
 * D-037 permits an application-owned environment variable only with an ADR, and
 * D-182 fixes the count at two. Migration and retention are the same trust zone
 * — "the part only the operator can start" (ADR-0002 §5) — and the same
 * credential; they differ only in which identity the session assumes. So the
 * migration connection is `DATABASE_MAINTENANCE_URL` plus
 * `options=-c role=splashtrack_owner`, computed HERE and nowhere else.
 *
 * `DATABASE_MAINTENANCE_URL` itself cannot be derived from `DATABASE_URL`: it
 * carries a different username AND a different password, and a scheme where it
 * did not would put the runtime role one string manipulation away from the
 * maintenance role. That is the D-037 justification, and ADR-0002 §8 is the ADR.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ROLE NAMES ARE READ, NOT ASSUMED
 *
 * `infra/audit-database-role.sql` has always argued that role names belong to
 * the operator, because on a managed database they are the provider's. Nothing
 * here hardcodes one: the application role is the username in `DATABASE_URL`,
 * the retention role is the username in `DATABASE_MAINTENANCE_URL`, and the
 * owner is whoever owns the schema. `splashtrack_*` are the names the reference
 * compose happens to create.
 */

/** The role names the reference provisioning creates. Defaults, never assumptions. */
export const REFERENCE_OWNER_ROLE = "splashtrack_owner";
export const REFERENCE_APP_ROLE = "splashtrack_app";
export const REFERENCE_RETENTION_ROLE = "splashtrack_retention";

/** The three role names one `db:apply-grants` run acts on. */
export interface RoleModelNames {
  /** Owns the schema and every table. Non-connecting. */
  owner: string;
  /** The runtime role — the username in `DATABASE_URL`. */
  app: string;
  /** The retention role — the username in `DATABASE_MAINTENANCE_URL`. */
  retention: string;
}

/**
 * The connection `prisma migrate deploy` uses: the maintenance credential,
 * asking PostgreSQL to assume the owner for the whole session.
 *
 * `options=-c role=<owner>` is a libpq connection option and is honoured by both
 * node-postgres and Prisma's schema engine. It makes every object a migration
 * creates owned by `<owner>` at birth rather than reassigned afterwards —
 * `applyRoleModel` still reassigns as a self-heal, because a table
 * that spends even one migration owned by the wrong role is the exact defect
 * ADR-0002 §3 is about.
 *
 * Throws rather than falling back: a migration that silently ran as the wrong
 * identity is how ownership drifts back to where D-149 part 2 is inert.
 */
export function migrationUrlFrom(
  maintenanceUrl: string,
  owner: string,
): string {
  const url = parseConnectionUrl(maintenanceUrl, "DATABASE_MAINTENANCE_URL");
  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    throw new Error(
      `DATABASE_MAINTENANCE_URL is not a PostgreSQL URL (got "${url.protocol}").`,
    );
  }
  // `-c role=…` rather than `-c session_authorization=…`: SET ROLE is
  // reversible within the session and leaves `session_user` intact, so the
  // audit trail of who connected is still the retention role.
  url.searchParams.set("options", `-c role=${owner}`);
  return url.toString();
}

/**
 * Parses a connection string, and says something useful when it will not parse.
 *
 * THE FAILURE THIS EXISTS FOR. `openssl rand -base64 24` — which is what the
 * documentation used to suggest, and what any operator reaches for — produces
 * passwords containing `/` and `+`. A `/` ends the authority section of a URL,
 * so `postgresql://user:a/b@host:5432/db` does not parse at all, and the error
 * a bare `new URL()` gives is the four words "Invalid URL" with no indication
 * that a password is the reason or which of the two variables is at fault.
 *
 * An operator hits this while setting up a database at the point where nothing
 * else works yet, so the message has to carry the fix.
 */
function parseConnectionUrl(rawUrl: string, variableName: string): URL {
  try {
    return new URL(rawUrl);
  } catch {
    throw new Error(
      `${variableName} is not a valid URL.\n\n` +
        "  The usual cause is a PASSWORD containing a character that has a " +
        "meaning in a URL — `/`, `@`, `:`, `#` or `?`. `openssl rand -base64` " +
        "produces `/` and `+` routinely.\n\n" +
        "  Either generate one without them (`openssl rand -hex 24`) or " +
        "percent-encode it: `/` becomes %2F, `@` becomes %40, `+` becomes %2B.\n\n" +
        "  The password itself is not shown here, deliberately.",
    );
  }
}

/** The username a PostgreSQL URL authenticates as. */
export function roleNameFrom(rawUrl: string): string {
  const username = parseConnectionUrl(rawUrl, "a PostgreSQL URL").username;
  if (!username) {
    throw new Error(
      "A PostgreSQL connection string here must name its role explicitly; " +
        `"${redactUrl(rawUrl)}" has no username. The role model (ADR-0002) ` +
        "decides privileges BY ROLE, so an implicit one is a silent choice.",
    );
  }
  return decodeURIComponent(username);
}

/** A connection string with its password removed, safe to put in a message. */
export function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return "<unparseable connection string>";
  }
}

/**
 * Everything that must be true of ONE database before the runtime role can use
 * it — ownership, schema access, and the default privileges that keep a table
 * added by a future migration from being invisible.
 *
 * WHY THIS IS CODE AND NOT A SECOND SQL FILE. It has to run against three
 * different databases with the same result: the real one (after every
 * migration, from the entrypoint), the `_test` one the harness creates on every
 * `npm test`, and the throwaway `splashtrack_freshcheck` the fresh-install check
 * drops and recreates. A `.sql` file an operator pastes once cannot cover the
 * last two, and two copies of these statements is how the test database ends up
 * shaped unlike the real one — which is the fidelity argument in ADR-0002 §4.
 * `infra/provision-roles.sql` keeps only what genuinely needs a superuser:
 * creating the three roles.
 *
 * ORDER IS LOAD-BEARING. Ownership is settled before any grant, because every
 * grant below is made BY the owner and a grant from the wrong grantor cannot be
 * revoked by the right one.
 */
export function databaseProvisionStatements(names: RoleModelNames): string[] {
  const { owner, app, retention } = names;
  return [
    // The schema itself. A fresh database's `public` is owned by
    // `pg_database_owner`; naming the owner explicitly is what makes
    // `pg_namespace.nspowner` answer "who owns this installation" honestly.
    `ALTER SCHEMA public OWNER TO ${quote(owner)}`,

    // PostgreSQL 15 already removed PUBLIC's CREATE here; the REVOKE is kept
    // because this file also runs against databases restored from older dumps.
    `REVOKE ALL ON SCHEMA public FROM PUBLIC`,
    `GRANT USAGE ON SCHEMA public TO ${quote(app)}`,
    `GRANT USAGE ON SCHEMA public TO ${quote(retention)}`,

    // THE SHARP EDGE ADR-0002 §8 NAMES. Without these, a table created by a
    // migration next month is invisible to the runtime role, and the failure
    // arrives as `permission denied` after an upgrade rather than at the moment
    // of the mistake. The audit exception below then takes the two tables back
    // out of this blanket.
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${quote(owner)} IN SCHEMA public ` +
      `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quote(app)}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${quote(owner)} IN SCHEMA public ` +
      `GRANT USAGE, SELECT ON SEQUENCES TO ${quote(app)}`,

    // The same, for tables that already exist — the upgrade path, and the only
    // reason an instance provisioned after its first migration works at all.
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quote(app)}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quote(app)}`,

    // The retention role gets NO blanket. It is granted exactly the two audit
    // tables, below, and nothing else — so `audit:grants` listing it beside
    // `AuditEvent` means what it says.
  ];
}

/**
 * THE AUDIT EXCEPTION — D-149 part 2, as statements.
 *
 * Provisioning gives the runtime role ordinary DML on everything the owner
 * creates, through `ALTER DEFAULT PRIVILEGES`. That is what keeps a table added
 * by a future migration from being invisible (ADR-0002 §8), and it is also why
 * these statements exist: the same default hands the runtime role `DELETE` on
 * the two audit tables, which is precisely what must not happen.
 *
 * So this runs AFTER every migration, as the owner, and it is idempotent.
 *
 * WHY RETENTION GETS `INSERT` ON `AuditEvent`, WHICH ADR-0002 §7.4 DOES NOT
 * LIST. A retention run is itself an audited action: `pruneAuditTrail` appends
 * an `audit.retention_pruned` event after its transaction commits, which D-168
 * requires — a prune that left no trace would be the deletion this whole
 * control exists to make impossible. §7.4 lists `SELECT, DELETE` and omits the
 * `INSERT` its own retention path needs. Granting it is the reading that makes
 * D-168 coherent; the alternative is a retention run that cannot record itself.
 *
 * WHY `REVOKE ALL` AND NOT `REVOKE UPDATE, DELETE`. `ALL` also takes `TRUNCATE`
 * and `REFERENCES`. `TRUNCATE` empties the table without a single `DELETE`, so
 * a revoke naming only UPDATE and DELETE reads as though it closed the door and
 * leaves it open — the same reassuring-direction wrongness ADR-0002 §3 is about.
 */
export function auditGrantStatements(names: RoleModelNames): string[] {
  const { app, retention } = names;
  return [
    // ── The runtime role: append-only on the trail, read-only on checkpoints ──
    `REVOKE ALL ON TABLE "AuditEvent" FROM ${quote(app)}`,
    `GRANT SELECT, INSERT ON TABLE "AuditEvent" TO ${quote(app)}`,
    `GRANT USAGE, SELECT ON SEQUENCE "AuditEvent_sequence_seq" TO ${quote(app)}`,
    `REVOKE ALL ON TABLE "AuditCheckpoint" FROM ${quote(app)}`,
    `GRANT SELECT ON TABLE "AuditCheckpoint" TO ${quote(app)}`,

    // ── The retention role: the only DELETE on AuditEvent ────────────────────
    `REVOKE ALL ON TABLE "AuditEvent" FROM ${quote(retention)}`,
    `GRANT SELECT, INSERT, DELETE ON TABLE "AuditEvent" TO ${quote(retention)}`,
    `GRANT USAGE, SELECT ON SEQUENCE "AuditEvent_sequence_seq" TO ${quote(retention)}`,
    `REVOKE ALL ON TABLE "AuditCheckpoint" FROM ${quote(retention)}`,
    `GRANT SELECT, INSERT ON TABLE "AuditCheckpoint" TO ${quote(retention)}`,
  ];
}

/**
 * Puts ownership of everything in `public` back on the owner role.
 *
 * A self-heal, not the main path — `migrationUrlFrom` means objects are created
 * owned correctly. It exists because ADR-0002 §3's whole finding is that
 * ownership in the wrong place makes the revoke inert while it still reads as
 * enforced, and "the migration was run once with the wrong URL" is a thing that
 * happens to operators. Running as a member of the owner, `ALTER … OWNER TO` is
 * permitted; running as anything else it is a no-op because the loop finds
 * nothing it may alter, and the caller's verification then fails loudly.
 */
export function ownershipReassignStatement(owner: string): string {
  return `
    DO $$
    DECLARE target record;
    BEGIN
      FOR target IN
        SELECT tablename AS name FROM pg_tables
         WHERE schemaname = current_schema() AND tableowner <> ${literal(owner)}
      LOOP
        EXECUTE format('ALTER TABLE %I OWNER TO %I', target.name, ${literal(owner)});
      END LOOP;
      FOR target IN
        SELECT sequencename AS name FROM pg_sequences
         WHERE schemaname = current_schema() AND sequenceowner <> ${literal(owner)}
      LOOP
        EXECUTE format('ALTER SEQUENCE %I OWNER TO %I', target.name, ${literal(owner)});
      END LOOP;
    END $$
  `;
}

/**
 * Double-quotes an identifier. Role names reach here from a connection string
 * an operator wrote, so they are not trusted input even though they are not
 * attacker input.
 */
function quote(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/** Single-quotes a string literal, for the identifiers passed INTO `format()`. */
function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
