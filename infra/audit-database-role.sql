-- The insert-only database role for `AuditEvent` (D-149 part 2).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS IS A DEPLOYMENT STEP AND NOT A PRISMA MIGRATION
--
-- Three reasons, none of them a preference:
--
--   1. **Role names are the operator's, not ours.** On a managed Postgres the
--      roles already exist and are named by the provider; a migration that
--      hardcoded `splashtrack_app` would fail there and only there.
--   2. **A migration runs AS the application role.** Having it revoke its own
--      UPDATE/DELETE on `AuditEvent` would break the next migration that has to
--      touch the table, and R-20 runs migrations unattended at container start
--      — an install stranded by its own grant is worse than the grant missing.
--   3. **Granting requires privileges the application role must not hold.**
--      D-116 says the application's role is not a superuser. If it could grant,
--      the separation would be decorative: a compromised application could
--      grant itself back.
--
-- So: an operator runs this once, as a privileged role, at provisioning time.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHAT IT DOES AND DOES NOT DEFEND AGAINST, stated plainly because D-149's own
-- text is careful about this. The retention path holds DELETE on `AuditEvent`
-- and runs in the same process, in a code base where §3.1 permits `$executeRaw`
-- behind a reviewer sign-off. This role is therefore a control against an
-- EXTERNAL SQL primitive — an injection, a stolen `DATABASE_URL`, a careless
-- script — and NOT against the compromised administrator FM-7 names. The
-- control that reaches that actor is the checkpoint MAC (D-168), and its own
-- limit is that host access holds `SECRET_KEY`.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHO RUNS THIS, AND WHEN — decided in phase 1.0
--
-- THE OPERATOR RUNS IT, ONCE, AT PROVISIONING TIME, AS A PRIVILEGED ROLE. It is
-- deliberately NOT in the entrypoint, and the three reasons above are why: the
-- entrypoint runs AS the application role, which by D-116 is not a superuser and
-- therefore cannot GRANT — and if it could, the separation would be decorative,
-- because a compromised application could grant itself back.
--
-- What the entrypoint DOES do is report. Every container start runs
-- `splashtrack audit:grants`, which reads `information_schema.table_privileges`
-- through the application's own connection — reading privileges needs no
-- privilege — and prints, in words, whether the application role still holds
-- UPDATE or DELETE on `AuditEvent`. A grant nobody checks is a grant nobody has,
-- and "we ran that script once" is not evidence. The same line belongs on the
-- diagnostics page (`13-…` §8) when it exists.
--
-- The report is informational and never refuses a start: this is a deployment
-- step the operator owns, and an instance that will not boot because a SQL file
-- has not been run yet is a worse failure than the one it prevents.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ─────────────────────────────────────────────────────────────────────────────
-- STILL NOT WIRED INTO THE APPLICATION, AND WHAT IT WOULD TAKE
--
-- D-149 describes three paths with different grants: the ordinary application
-- role, an append-only writer for `AuditEvent`, and a narrowly-scoped retention
-- path holding DELETE. The application half of that is a SECOND and THIRD
-- connection, which means new environment variables — and D-037 permits one
-- only with an ADR stating why it cannot live in the database. A connection
-- string plainly cannot (it is how the database is reached), so the ADR is
-- writable, but adding two variables is a decision about the operator-facing
-- surface and is Jack's to make, not mine. Until it is made, `REVOKE` below is
-- commented out: applying it would break the retention path with no second
-- connection to run it on, which is a worse failure than the one it prevents.
--
-- Substitute the real role names before running. `:app_role` is the role in
-- `DATABASE_URL`.

-- ── 1. The append-only writer ───────────────────────────────────────────────
-- Owns nothing; may only INSERT into the audit trail and read it back.

CREATE ROLE splashtrack_audit_writer LOGIN PASSWORD :'audit_writer_password';

GRANT CONNECT ON DATABASE :"database" TO splashtrack_audit_writer;
GRANT USAGE ON SCHEMA public TO splashtrack_audit_writer;

GRANT INSERT, SELECT ON TABLE "AuditEvent" TO splashtrack_audit_writer;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "AuditEvent"
  FROM splashtrack_audit_writer;

-- `AuditEvent.sequence` is an identity/serial column, so the writer needs its
-- sequence. Without this the INSERT fails with a permission error that names
-- the sequence rather than the table, which is a confusing hour.
GRANT USAGE, SELECT ON SEQUENCE "AuditEvent_sequence_seq"
  TO splashtrack_audit_writer;

-- Checkpoints are written by the RETENTION path, not by the writer, and are
-- never deleted by anyone (D-168 rule 3).
GRANT SELECT ON TABLE "AuditCheckpoint" TO splashtrack_audit_writer;

-- ── 2. The retention path ───────────────────────────────────────────────────
-- The only role that may delete audit events, and only together with the
-- checkpoint that accounts for them.

CREATE ROLE splashtrack_audit_retention LOGIN PASSWORD :'audit_retention_password';

GRANT CONNECT ON DATABASE :"database" TO splashtrack_audit_retention;
GRANT USAGE ON SCHEMA public TO splashtrack_audit_retention;

GRANT SELECT, DELETE ON TABLE "AuditEvent" TO splashtrack_audit_retention;
REVOKE UPDATE ON TABLE "AuditEvent" FROM splashtrack_audit_retention;

GRANT SELECT, INSERT ON TABLE "AuditCheckpoint" TO splashtrack_audit_retention;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "AuditCheckpoint"
  FROM splashtrack_audit_retention;

-- ── 3. The ordinary application role ────────────────────────────────────────
-- COMMENTED OUT until the application has the second and third connections
-- above. Applying it today removes the audit trail from the only process that
-- writes it.
--
-- REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "AuditEvent" FROM :"app_role";
-- REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "AuditCheckpoint" FROM :"app_role";
-- GRANT SELECT ON TABLE "AuditEvent", "AuditCheckpoint" TO :"app_role";

-- ── Verification ────────────────────────────────────────────────────────────
-- What an operator runs afterwards to see the grants rather than assume them.
--
--   SELECT grantee, privilege_type
--     FROM information_schema.table_privileges
--    WHERE table_name IN ('AuditEvent', 'AuditCheckpoint')
--    ORDER BY grantee, privilege_type;
