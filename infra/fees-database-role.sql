-- D-005/D-088/D-091/D-092 — the fees exception, as SQL (phase 3.3).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- YOU ALMOST CERTAINLY DO NOT NEED TO RUN THIS.
--
-- `splashtrack db:apply-grants` applies exactly these statements, after every
-- migration, beside the audit, attendance, skill-progress, assessment and
-- exams exceptions. The whole model — ownership first, why REVOKE ALL, what
-- this defends against and what it does not — is explained once, in
-- `infra/audit-database-role.sql`; read that first.
--
-- `tests/unit/fees-grant-sql-sync.test.ts` fails if this file and
-- `src/lib/database/role-model.ts` (`feesGrantStatements`) ever disagree, so
-- reading this is the same as reading what runs.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY `Charge` IS THE `Award` SHAPE, NOT `ExamResult`'S
--
-- `01-domain-model.md` §6.1 gives `Charge` a mutable `status` column and this
-- phase deliberately keeps it a mutable, on-the-same-row field for exactly
-- two values — `WAIVED` and `CANCELLED` — rather than expressing either as a
-- new superseding row (see `model Charge`'s own comment for why `PAID`/
-- `PARTIAL` are NOT among them: those are computed at read time and never
-- written at all). That is the `ScheduledSession.cancelledAt`/
-- `cancellationReason` pattern `Award.revokedAt`/`revokeReason` already used
-- this database's grants for, so the resolution is the same: a Postgres
-- COLUMN-LEVEL `GRANT` lets the runtime role move `status` and its two
-- waive/cancel pairs, and nothing else about the charge — not `amount`, not
-- `feeTypeId`, not `payerPersonId`, not `dueDate` — is reachable by an
-- `UPDATE` from that role, enforced by the database rather than by review.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY `Payment` IS THE PLAIN `ExamResult` SHAPE
--
-- No service in this module ever updates a `Payment` row. A mis-recorded
-- payment is reversed by a second `Payment` (described in `reference`) or by
-- waiving/cancelling the charge it belongs to — see the model's own comment.
-- So the runtime role holds `SELECT, INSERT` and nothing else, exactly
-- `ExamResult`'s grant.
--
-- WHY THE RETENTION ROLE GETS `UPDATE`/`DELETE` ON BOTH TABLES, ON THE
-- ASSESSMENT/EXAMS PRECEDENT. `Charge.payerPersonId`/`createdByPersonId`/
-- `waivedByPersonId`/`cancelledByPersonId` and `Payment.recordedByPersonId`
-- are all severed (`SET NULL`) when the person they name is erased; the FK's
-- own referential action covers a `Person` DELETE, and the retention role's
-- `UPDATE` covers the rest (a future R-25 `erasePersonData`, and D-092's
-- pseudonymisation once the 7-year fiscal ground lapses — see
-- `src/lib/retention/erasure-registry.ts`'s `Charge`/`Payment` entries).
-- `DELETE` is provisioned for a future retention prune (`CHARGES`/`PAYMENTS`
-- at 7 years, `REVIEW` — v1 ships no automated job, D-120 — the capability is
-- granted ahead of it, on the same ordering `CLAUDE.md` rule 1 states for the
-- encryption envelope).
--
-- WHY ERASURE OF A PAYER OR STUDENT STILL WORKS WITHOUT DELETING THE RECORD:
-- `Charge.payerPersonId` and `Charge.studentProfileId` are BOTH `ON DELETE
-- SET NULL`, never `CASCADE` — the one place this module's foreign keys
-- deliberately differ from `ExamCandidate.studentProfileId`'s cascade. A
-- financial fact's 7-year fiscal retention routinely outlives the 24-month
-- person/student retention it was about, so erasing the payer or the pupil
-- must not take the charge with it: it keeps its amount, date, fee type and
-- period and loses the link, D-092's pseudonymisation exactly.
--
-- `FeeType` is NOT in this file. It is an ORDINARY mutable catalogue table —
-- the `AwardType`/`Course` shape — and keeps the database-wide default
-- `databaseProvisionStatements` already grants every table.
--
-- Run as the OWNER (a member of it may `SET ROLE splashtrack_owner` first).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── The runtime role: append-only on the charge, PLUS the waive/cancel pair ─

REVOKE ALL ON TABLE "Charge" FROM "splashtrack_app";
GRANT SELECT, INSERT ON TABLE "Charge" TO "splashtrack_app";
GRANT UPDATE ("status", "waivedAt", "waivedReason", "waivedByPersonId", "cancelledAt", "cancelledReason", "cancelledByPersonId") ON TABLE "Charge" TO "splashtrack_app";

-- ── The retention role: full UPDATE (sever) and DELETE (retention) ──────────

REVOKE ALL ON TABLE "Charge" FROM "splashtrack_retention";
GRANT SELECT, UPDATE, DELETE ON TABLE "Charge" TO "splashtrack_retention";

-- ── The runtime role: append-only on the payment ─────────────────────────────

REVOKE ALL ON TABLE "Payment" FROM "splashtrack_app";
GRANT SELECT, INSERT ON TABLE "Payment" TO "splashtrack_app";

-- ── The retention role: the only UPDATE (sever) and DELETE (retention) ──────

REVOKE ALL ON TABLE "Payment" FROM "splashtrack_retention";
GRANT SELECT, UPDATE, DELETE ON TABLE "Payment" TO "splashtrack_retention";
