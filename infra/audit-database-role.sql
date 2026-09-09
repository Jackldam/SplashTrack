-- D-149 part 2 — the audit exception, as SQL.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- YOU ALMOST CERTAINLY DO NOT NEED TO RUN THIS.
--
-- `splashtrack db:apply-grants` applies exactly these statements, after every
-- migration, from `docker-entrypoint.sh`. They are written out here for the one
-- reader who needs to SEE the control rather than trust a command — an operator
-- on a managed database, an auditor, or whoever next has to answer "is the
-- audit trail actually append-only on this instance?".
--
-- `tests/unit/audit-grant-sql-sync.test.ts` fails if this file and
-- `src/lib/database/role-model.ts` ever disagree, so reading this is the same
-- as reading what runs. That test is the only reason a second copy is safe.
--
-- Substitute your own role names if they are not the reference ones; the
-- command reads them from the two connection strings and never assumes them.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHAT THIS DEFENDS AGAINST, AND WHAT IT DOES NOT
--
-- The actor is an EXTERNAL SQL PRIMITIVE — an injection, a stolen
-- `DATABASE_URL`, a careless script an operator pastes at 23:00. It is NOT the
-- compromised administrator FM-7 names: they hold host access and therefore
-- `SECRET_KEY`, and can forge a checkpoint. D-168 says so, and D-182 repeats it,
-- because a control whose limits go unstated gets over-trusted.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE PRECONDITION, WHICH IS THE WHOLE POINT (ADR-0002 §3)
--
-- These REVOKEs are INERT unless the runtime role does not OWN the tables. A
-- table's owner holds its privileges by ownership rather than by grant, and may
-- re-grant them to itself at any time. Measured on postgres:16-alpine, as the
-- owning role:
--
--     REVOKE DELETE ON "AuditEvent" FROM app;
--     SET ROLE app; DELETE FROM "AuditEvent";            -- permission denied  ✓
--     SET ROLE app; GRANT DELETE ON "AuditEvent" TO app;
--                   DELETE FROM "AuditEvent";            -- DELETE 1           ✗
--
-- An injection that can issue DELETE can generally issue GRANT on the same
-- primitive, so against the actor named above a revoke against the owner buys
-- one statement of delay while reading as though it buys the property. And if
-- the role is a SUPERUSER — which is what the Postgres image makes
-- `POSTGRES_USER` — the revoke is not weak but entirely inert, because a
-- superuser bypasses privilege checks outright.
--
-- With ownership held by `splashtrack_owner`, which cannot log in, the same
-- attempt fails on every door:
--
--     GRANT DELETE …                → WARNING: no privileges were granted
--     ALTER TABLE … OWNER TO app    → ERROR: must be owner of table
--     DROP / TRUNCATE               → ERROR: must be owner / permission denied
--
-- That is why `db:apply-grants` settles ownership BEFORE it grants anything and
-- verifies it AFTER. It is also why `splashtrack audit:grants` prints the table
-- owner beside the grant list: the grant list alone cannot tell you whether the
-- separation is real, and a report that is wrong in the reassuring direction is
-- worse than no report at all.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY `REVOKE ALL` RATHER THAN `REVOKE UPDATE, DELETE`
--
-- `ALL` also takes TRUNCATE and REFERENCES. TRUNCATE empties the table without
-- issuing a single DELETE, so a revoke naming only UPDATE and DELETE closes the
-- front door, leaves the side one open, and reads as complete.
--
-- WHY THE RETENTION ROLE GETS `INSERT` ON `AuditEvent`, WHICH ADR-0002 §7.4
-- DOES NOT LIST
--
-- A retention run is itself an audited action: `pruneAuditTrail` appends an
-- `audit.retention_pruned` event once its transaction commits. §7.4 lists
-- `SELECT, DELETE` and omits the INSERT its own retention path needs, so the
-- role it describes could delete audit rows and could not record having done
-- so. Granting INSERT is the reading that makes D-168 coherent.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Run as the OWNER (a member of it may `SET ROLE splashtrack_owner` first).
-- Running these as a superuser also works, and is what a managed database's
-- admin role will do.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── The runtime role: append-only on the trail, read-only on checkpoints ────
--
-- `ALTER DEFAULT PRIVILEGES` gives this role ordinary DML on everything the
-- owner creates, which is what keeps a table added by a future migration from
-- being invisible to it. These five statements take the two audit tables back
-- out of that blanket — which is why they are re-applied after EVERY migration
-- rather than once at provisioning.

REVOKE ALL ON TABLE "AuditEvent" FROM "splashtrack_app";
GRANT SELECT, INSERT ON TABLE "AuditEvent" TO "splashtrack_app";
GRANT USAGE, SELECT ON SEQUENCE "AuditEvent_sequence_seq" TO "splashtrack_app";
REVOKE ALL ON TABLE "AuditCheckpoint" FROM "splashtrack_app";
GRANT SELECT ON TABLE "AuditCheckpoint" TO "splashtrack_app";

-- ── The retention role: the only DELETE on AuditEvent ───────────────────────
--
-- D-168 makes the checkpointed prefix prune the only legitimate deleter, and
-- `AuditCheckpoint` is append-only for everybody: no role here holds UPDATE or
-- DELETE on it, because a checkpoint that can be edited is a gap that can be
-- explained away after the fact (D-168 rule 3).

REVOKE ALL ON TABLE "AuditEvent" FROM "splashtrack_retention";
GRANT SELECT, INSERT, DELETE ON TABLE "AuditEvent" TO "splashtrack_retention";
GRANT USAGE, SELECT ON SEQUENCE "AuditEvent_sequence_seq" TO "splashtrack_retention";
REVOKE ALL ON TABLE "AuditCheckpoint" FROM "splashtrack_retention";
GRANT SELECT, INSERT ON TABLE "AuditCheckpoint" TO "splashtrack_retention";

-- ── Verification ────────────────────────────────────────────────────────────
-- `splashtrack audit:grants` is these two queries plus the sentence that
-- interprets them. By hand:
--
--   SELECT grantee, table_name, privilege_type
--     FROM information_schema.table_privileges
--    WHERE table_name IN ('AuditEvent', 'AuditCheckpoint')
--    ORDER BY table_name, grantee, privilege_type;
--
--   SELECT tablename, tableowner FROM pg_tables
--    WHERE tablename IN ('AuditEvent', 'AuditCheckpoint');
--
-- The second query is not optional. See the precondition above.
