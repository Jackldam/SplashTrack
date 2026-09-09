-- D-005/D-061 — the attendance exception, as SQL (phase 2.2).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- YOU ALMOST CERTAINLY DO NOT NEED TO RUN THIS.
--
-- `splashtrack db:apply-grants` applies exactly these statements, after every
-- migration, from `docker-entrypoint.sh` — beside the audit exception in
-- `infra/audit-database-role.sql`, whose header explains the whole model
-- (ownership first, why REVOKE ALL, what this defends against and what it does
-- not). This file repeats none of that; read that one first.
--
-- `tests/unit/attendance-grant-sql-sync.test.ts` fails if this file and
-- `src/lib/database/role-model.ts` (`attendanceGrantStatements`) ever
-- disagree, so reading this is the same as reading what runs.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY ATTENDANCE, OF ALL DOMAIN TABLES
--
-- `00-overview.md` P-07: *"audit, attendance and progress are append-only and
-- queryable."* D-061 makes attendance EVIDENCE — absence policy, parental
-- disputes, occasionally safeguarding — and an append-only claim enforced only
-- in module code survives exactly until the first code path nobody reviewed.
-- A correction is a NEW `AttendanceEvent` carrying `supersedesEventId`; the
-- superseded row is never modified, and with these grants it cannot be.
--
-- WHY THE RETENTION ROLE GETS `DELETE` AND NO `INSERT`. D-111: expired
-- attendance events are hard-DELETED at 24 months, never anonymised — the
-- prune records itself in the AUDIT trail, not by writing attendance rows.
--
-- WHY ERASURE STILL WORKS. `AttendanceEvent.studentProfileId` is
-- `ON DELETE CASCADE` from `StudentProfile`, and PostgreSQL runs referential
-- actions with the privileges of the table's OWNER — so erasing a pupil takes
-- their attendance rows even though the runtime role holds no DELETE here.
--
-- Run as the OWNER (a member of it may `SET ROLE splashtrack_owner` first).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── The runtime role: append-only on the register ───────────────────────────

REVOKE ALL ON TABLE "AttendanceEvent" FROM "splashtrack_app";
GRANT SELECT, INSERT ON TABLE "AttendanceEvent" TO "splashtrack_app";

-- ── The retention role: the only DELETE (D-111) ─────────────────────────────

REVOKE ALL ON TABLE "AttendanceEvent" FROM "splashtrack_retention";
GRANT SELECT, DELETE ON TABLE "AttendanceEvent" TO "splashtrack_retention";
