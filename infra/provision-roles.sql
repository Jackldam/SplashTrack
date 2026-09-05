-- ADR-0002 / D-182 — the three SplashTrack database roles.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT RUNS THIS, AND WHEN
--
-- The reference compose stack runs it FOR the operator, once, when the Postgres
-- volume is first initialised: `infra/postgres-init/10-provision-roles.sh` is
-- mounted into the postgres image's `/docker-entrypoint-initdb.d`, which the
-- image executes as the superuser before it accepts its first connection.
--
-- OD-15 is why. The supported operator is "comfortable with `docker compose` on
-- a host they control", and explicitly NOT thereby comfortable with PostgreSQL
-- role grants. A README asking them to paste four `CREATE ROLE` statements as a
-- superuser is a step most installs will skip, and an install that skips it
-- runs the web application as a superuser — which via `COPY … FROM PROGRAM` is
-- command execution, not merely data access. The reference compose file is
-- documentation that EXECUTES, and this is the part of it that had been left as
-- prose.
--
-- Run it by hand only in the two cases the compose stack cannot cover:
--
--   1. An EXISTING volume. `docker-entrypoint-initdb.d` runs on a FRESH volume
--      only, so an instance that predates this change keeps its superuser until
--      an operator runs this once:
--
--        docker compose exec -T postgres psql -v ON_ERROR_STOP=1 \
--          --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
--          -v app_password="…" -v retention_password="…" -v createdb=off \
--          < infra/provision-roles.sql
--
--   2. A MANAGED database (RDS, Cloud SQL, a provider's Postgres). There is no
--      initdb hook there; run the same command as the provider's admin role.
--      D-116 already anticipated this: "operators pointing DATABASE_URL at a
--      managed database create the role themselves". Note that a provider's
--      "superuser" is not one, so this model is CLOSER to what those operators
--      already have, not further from it.
--
-- Everything that is NOT role creation lives in `splashtrack db:apply-grants`
-- instead — ownership, schema access, default privileges and the audit
-- exception. Those must be reasserted after EVERY migration rather than once,
-- and they must apply identically to the `_test` database the suite builds, so
-- they are code. See `src/lib/database/role-model.ts`.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- REQUIRED psql VARIABLES
--
--   :app_password        the password for the runtime role (DATABASE_URL)
--   :retention_password  the password for the retention role
--                        (DATABASE_MAINTENANCE_URL)
--   :createdb            `on` for a development or CI machine, `off` everywhere
--                        else. See §4.
--
-- This file NEVER contains a password and never has a default for one, for the
-- same reason `docker-compose.yml` has no default `POSTGRES_PASSWORD`: the
-- 2026-09-03 incident was a default credential that a compose file described as
-- safe. `docs/build/incident-2026-09-03-exposed-postgres.md`.
-- ─────────────────────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on

-- ── 1. splashtrack_owner — owns everything, and cannot log in ───────────────
--
-- NOLOGIN is not a detail; it is the correction D-182 makes to this ADR's own
-- §7.2. A role with no password is a role that cannot be stolen, phished,
-- committed to a repository or read out of `docker inspect`. Migrations reach
-- it by SET ROLE from a member (§3), so nothing is lost by it having no
-- credential — and what is gained is that the identity owning every table is
-- one that no connection string anywhere can name.
--
-- NOCREATEROLE matters too: an owner that could create roles could create
-- itself a login one.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'splashtrack_owner') THEN
    CREATE ROLE splashtrack_owner;
  END IF;
END
$$;

ALTER ROLE splashtrack_owner
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;

-- ── 2. splashtrack_app — the runtime role, and D-149's append-only writer ───
--
-- This is the role in DATABASE_URL: what the web process connects as, and
-- therefore what an SQL injection or a leaked `.env` yields. It owns nothing.
--
-- D-149 part 2 asked for a SEPARATE append-only writer connection alongside
-- this one. D-182 drops it, and ADR-0002 §7.5 is the argument: both pools would
-- live in the same Node process, in the same address space, reachable from the
-- same injection, so an attacker picks whichever suits them. Once this role
-- owns nothing and holds INSERT+SELECT on AuditEvent and nothing more, it IS
-- the append-only writer. D-149's intent is met exactly; its role count was the
-- incidental part.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'splashtrack_app') THEN
    CREATE ROLE splashtrack_app;
  END IF;
END
$$;

ALTER ROLE splashtrack_app
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
ALTER ROLE splashtrack_app PASSWORD :'app_password';

-- ── 3. splashtrack_retention — the only DELETE, and the migrator ────────────
--
-- The role in DATABASE_MAINTENANCE_URL. Two jobs, one credential, deliberately:
--
--   RETENTION. D-168 makes the checkpointed prefix prune the only legitimate
--   way an audit row is deleted. Something has to hold that DELETE; if it were
--   the runtime role, the append-only property would be void by construction.
--
--   MIGRATION. `prisma migrate deploy` must create objects owned by
--   splashtrack_owner, which has no password. Membership is how: this role
--   connects as itself and the migration asks PostgreSQL for
--   `options=-c role=splashtrack_owner`.
--
-- They share a credential because they share a trust zone — "the part only the
-- operator can start" (ADR-0002 §5) — and because D-182 fixes configuration at
-- two credentials. Splitting them would buy a third environment variable and no
-- boundary: whoever can start the retention job can start the migration.
--
-- WHAT MEMBERSHIP COSTS, STATED PLAINLY. A member of the owner can SET ROLE to
-- it and grant itself anything. So this credential is ultimately as powerful as
-- the owner, and the separation ADR-0002 buys is between the RUNTIME role and
-- everything else — not between the migrator and the owner. That is the right
-- boundary: the runtime role is the one an injection lands on.
--
-- BUT THE MEMBERSHIP DOES NOT INHERIT, AND THAT MATTERS MORE THAN IT LOOKS.
--
-- PostgreSQL role membership is INHERITING by default, which means a plain
-- `GRANT splashtrack_owner TO splashtrack_retention` silently hands the
-- retention role every privilege the owner holds — including UPDATE and
-- TRUNCATE on `AuditEvent` — with no SET ROLE required. Measured on
-- postgres:16-alpine while writing this:
--
--     UPDATE "AuditEvent" SET reason = 1;   -- UPDATE 0   ← permitted, silently
--
-- That would make "the retention role holds SELECT, INSERT and DELETE and
-- nothing more" false at the moment it was written, and the grant list in
-- `audit:grants` would still have shown exactly the three intended privileges.
-- A privilege you hold through an inherited membership does not appear beside
-- your name in `information_schema.table_privileges`.
--
-- With the membership non-inheriting, the same statement is refused, and the
-- migration connection still works because SET ROLE is unaffected:
--
--     UPDATE "AuditEvent" …                 -- ERROR: permission denied  ✓
--     SET ROLE splashtrack_owner; …         -- permitted                 ✓
--
-- THE ORDER OF THE THREE STATEMENTS BELOW IS THE PORTABLE WAY TO GET THIS.
-- PostgreSQL 16 records the inherit option ON THE MEMBERSHIP, taken from the
-- member role's own INHERIT attribute AT GRANT TIME — so `ALTER ROLE …
-- NOINHERIT` after the fact changes nothing, which is a quiet way to think you
-- have fixed it. `GRANT … WITH INHERIT FALSE` says it explicitly but is PG16+
-- syntax and fails on 15. Setting NOINHERIT first and then re-granting produces
-- `inherit_option = f` on 16 and the same behaviour on 15, with no version
-- test. The REVOKE is what makes it work on a re-run rather than only on a
-- fresh volume.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'splashtrack_retention') THEN
    CREATE ROLE splashtrack_retention;
  END IF;
END
$$;

ALTER ROLE splashtrack_retention
  LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT;
ALTER ROLE splashtrack_retention PASSWORD :'retention_password';

-- The REVOKE is guarded because on a FRESH volume there is no membership to
-- revoke, and PostgreSQL answers a pointless REVOKE with a WARNING naming both
-- roles. That warning appears in the init log of every new install, where the
-- one thing an operator should be able to do is read past it — a routine
-- warning is how a real one gets ignored.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
      JOIN pg_roles member ON member.oid = m.member
      JOIN pg_roles grantor ON grantor.oid = m.roleid
     WHERE member.rolname = 'splashtrack_retention'
       AND grantor.rolname = 'splashtrack_owner'
  ) THEN
    REVOKE splashtrack_owner FROM splashtrack_retention;
  END IF;
END
$$;

GRANT splashtrack_owner TO splashtrack_retention;

-- ── 4. CREATEDB — a developer-machine privilege, and nothing more ───────────
--
-- The phase 1.0 report gave "it would break the test harness's ability to
-- create its `_test` databases" as the blocker for D-116. That claim conflates
-- CREATEDB with SUPERUSER. They are different role attributes and only the
-- first is needed: the full suite passes against a NOSUPERUSER NOCREATEROLE
-- NOBYPASSRLS CREATEDB role, and fails with exactly
-- `permission denied to create database` without it. Measured both directions
-- in ADR-0002 §6.
--
-- The harness needs it for more than `scripts/setup-test-db.ts`:
-- `tests/integration/boot-state-matrix.test.ts` drops and creates a throwaway
-- database per case, because that is the only way to produce the EMPTY and
-- PARTIAL states D-055 branches on. That is correct test design.
--
-- Production never creates a database — `docker-entrypoint.sh` runs
-- `migrate deploy`, never `CREATE DATABASE` — so the two needs never conflicted.
-- They were only ever coupled by one role serving both.
--
-- It sits on the RETENTION role rather than the runtime role on purpose: the
-- dev runtime role is then shaped EXACTLY like the production one, which is the
-- fidelity argument in ADR-0002 §4. A grant bug should surface on a laptop, not
-- for the first time in production.

\if :createdb
  ALTER ROLE splashtrack_retention CREATEDB;
  \echo '  splashtrack_retention: CREATEDB granted (development/CI only).'
\else
  ALTER ROLE splashtrack_retention NOCREATEDB;
\endif

-- ── 5. The database this instance uses ──────────────────────────────────────
--
-- Ownership of the DATABASE (as opposed to the schema and its tables, which
-- `db:apply-grants` handles) so that `CREATE DATABASE … OWNER splashtrack_owner`
-- and `ALTER SCHEMA public OWNER` are permitted to a member of the owner
-- afterwards, without a superuser being present.
--
-- Executed against the database psql is connected to, which is `POSTGRES_DB`
-- under the initdb hook and `--dbname` when run by hand.

DO $$
DECLARE db name := current_database();
BEGIN
  EXECUTE format('ALTER DATABASE %I OWNER TO splashtrack_owner', db);
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', db);
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO splashtrack_app', db);
  EXECUTE format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO splashtrack_retention', db);
END
$$;

-- The SCHEMA, named explicitly rather than left to `pg_database_owner`.
--
-- A fresh database's `public` is owned by the system role `pg_database_owner`,
-- whose implicit member is whoever owns the database — so the owner already has
-- the rights it needs, and this line changes no privilege. It exists so that
-- `pg_namespace.nspowner` and `pg_tables.tableowner` answer the question "who
-- owns this installation" with the SAME name, instead of one of them answering
-- with a system role. `audit:grants` prints an owner to a human, and
-- `pg_database_owner` is not an answer anybody can act on.
ALTER SCHEMA public OWNER TO splashtrack_owner;

-- ── 6. The provisioning superuser is NOT an application credential ──────────
--
-- Nothing above grants it to anything, and nothing should: the role that ran
-- this file must never appear in DATABASE_URL or DATABASE_MAINTENANCE_URL. That
-- was the defect — `POSTGRES_USER` is created by the Postgres image as a
-- superuser, and `DATABASE_URL` pointed at it, so every SQL-injection class in
-- the product had `COPY … FROM PROGRAM` behind it.
--
-- `splashtrack db:apply-grants` verifies this and exits non-zero if the runtime
-- role is a superuser, because every grant in this model is decoration against
-- one.

\echo 'SplashTrack roles provisioned. Next: splashtrack db:apply-grants (after migrations).'
