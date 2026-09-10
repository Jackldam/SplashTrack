-- D-005/D-062/D-085/D-089 — the exams exception, as SQL (phase 2.4).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- YOU ALMOST CERTAINLY DO NOT NEED TO RUN THIS.
--
-- `splashtrack db:apply-grants` applies exactly these statements, after every
-- migration, beside the audit, attendance, skill-progress and assessment
-- exceptions. The whole model — ownership first, why REVOKE ALL, what this
-- defends against and what it does not — is explained once, in
-- `infra/audit-database-role.sql`; read that first.
--
-- `tests/unit/exams-grant-sql-sync.test.ts` fails if this file and
-- `src/lib/database/role-model.ts` (`examsGrantStatements`) ever disagree, so
-- reading this is the same as reading what runs.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY `ExamResult` IS THE EXACT `assessmentGrantStatements` SHAPE
--
-- `ExamResult` is the diploma decision's own evidential record (D-062: "a
-- candidate has 0..N results, not 0..1" — a correction is a NEW row carrying
-- `supersedesResultId`, never an edit). The runtime role holds `SELECT,
-- INSERT` and nothing else, on the `Assessment`/`AttendanceEvent` precedent.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY `Award` IS DIFFERENT, AND NEW IN THIS CODEBASE
--
-- `01-domain-model.md` §3.5 gives `Award` its own `revokedAt?`/
-- `revokeReason?` columns ON THE ISSUANCE ROW — the
-- `ScheduledSession.cancelledAt`/`cancellationReason` pattern, not the
-- `supersedesXId` one. "Append-only" therefore cannot mean "no UPDATE ever"
-- here without contradicting the domain model's own schema for this one
-- table. Postgres COLUMN-LEVEL `GRANT` is the resolution: the runtime role
-- may `UPDATE` EXACTLY `revokedAt, revokeReason`, so `resultId`,
-- `awardTypeId`, `number` and `issuedAt` are exactly as immutable — enforced
-- by the database, not by review — as every other append-only table in this
-- registry, while the one mutation the domain model itself asks for still
-- works. Flagged in the phase 2.4 report as a considered, named departure
-- from the literal D-061/D-062 shape.
--
-- WHY THE RETENTION ROLE GETS `UPDATE`/`DELETE` ON BOTH TABLES, ON THE
-- ASSESSMENT PRECEDENT. `ExamResult.recordedByPersonId` is severed (`SET
-- NULL`) when the person who recorded a result is erased; the FK's own
-- referential action covers a `Person` DELETE, and the retention role's
-- `UPDATE` covers the rest (the future R-25 `erasePersonData`). `DELETE` is
-- provisioned for a future retention prune (`EXAM_RESULTS_AND_AWARDS` at 10
-- years, only where a retention ground applies, §5.2 — v1 ships no automated
-- job, D-120, but the capability is granted ahead of it).
--
-- WHY ERASURE OF A CANDIDATE STILL WORKS: `ExamResult.candidateId` is
-- `ON DELETE CASCADE` from `ExamCandidate`, which cascades in turn from
-- `StudentProfile` — all running with the OWNER's privileges, the
-- `Assessment`/`AttendanceEvent` reasoning.
--
-- `PersonQualification` and `ExamCandidate` are NOT in this file. They are
-- ORDINARY mutable tables — the `MembershipPeriod`/`WaitlistEntry` shape, not
-- the append-only one — and keep the database-wide default
-- `databaseProvisionStatements` already grants every table.
--
-- Run as the OWNER (a member of it may `SET ROLE splashtrack_owner` first).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── The runtime role: append-only on the exam-day result ────────────────────

REVOKE ALL ON TABLE "ExamResult" FROM "splashtrack_app";
GRANT SELECT, INSERT ON TABLE "ExamResult" TO "splashtrack_app";

-- ── The retention role: the only UPDATE (sever) and DELETE (retention) ──────

REVOKE ALL ON TABLE "ExamResult" FROM "splashtrack_retention";
GRANT SELECT, UPDATE, DELETE ON TABLE "ExamResult" TO "splashtrack_retention";

-- ── The runtime role: append-only on issuance, PLUS the revocation pair ─────

REVOKE ALL ON TABLE "Award" FROM "splashtrack_app";
GRANT SELECT, INSERT ON TABLE "Award" TO "splashtrack_app";
GRANT UPDATE ("revokedAt", "revokeReason") ON TABLE "Award" TO "splashtrack_app";

-- ── The retention role: full UPDATE (sever) and DELETE (retention) ──────────

REVOKE ALL ON TABLE "Award" FROM "splashtrack_retention";
GRANT SELECT, UPDATE, DELETE ON TABLE "Award" TO "splashtrack_retention";
