-- ---------------------------------------------------------------------------
-- Phase 2.4 — the `exams` module: `PersonQualification`, `ExamCandidate`,
-- `ExamResult`, `Award` (`01-domain-model.md` §3.1/§3.5, `15-…` §3; D-085,
-- D-052, D-062, D-089).
--
-- `ExamSession`/`ExamAssessor` and `Assessment.examSessionId`/
-- `AssessmentKind.EXAM` are DELIBERATELY NOT BUILT HERE, on the exact
-- precedent the assessment phase set for the same reason (its report §1.2):
-- a nullable FK to a table that does not exist is the dangling stub
-- CLAUDE.md §4/D-163 forbids, and `ExamSession.locationId` names a `Location`
-- table D-175 already superseded with `Pool`/`Lane`. See the phase 2.4
-- report §1 for the full reasoning.
--
-- THE APPEND-ONLY PROPERTY OF `ExamResult` IS NOT IN THIS FILE. Privileges
-- are applied AFTER every migration by `db:apply-grants`
-- (`examsGrantStatements` in `src/lib/database/role-model.ts`, documented in
-- `infra/exams-database-role.sql`): the runtime role gets `SELECT, INSERT`
-- on `ExamResult` and nothing else, on the `assessmentGrantStatements`
-- precedent. `Award` gets the SAME shape for its issuance fields, plus a
-- column-restricted `UPDATE` on exactly `revokedAt, revokeReason` — see that
-- file's own comment for why. `PersonQualification` and `ExamCandidate` are
-- ORDINARY mutable tables (the `MembershipPeriod`/`WaitlistEntry` shape) and
-- carry no carve-out.
--
-- ENCRYPTED-COLUMN-IMPACT: name-only. Brand-new columns, not a rename; none
-- of `ExamResult.remarks`/`ExamResult.reason`/`Award.revokeReason` is in the
-- protected-free-text class (D-148) — the `Assessment.remark` precedent
-- (phase 2.3, 2026-09-10 decision), not the
-- `AssessmentCriterionResult.remark` one. See the phase 2.4 report §1 for why
-- this is flagged rather than assumed.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "ExamCandidateStatus" AS ENUM ('PENDING', 'CONFIRMED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ExamResultOutcome" AS ENUM ('PASS', 'FAIL');

-- AlterEnum
ALTER TYPE "DataClass" ADD VALUE 'PERSON_QUALIFICATIONS';

-- CreateTable
CREATE TABLE "PersonQualification" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "grantedByPersonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonQualification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamCandidate" (
    "id" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "awardTypeId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "status" "ExamCandidateStatus" NOT NULL DEFAULT 'PENDING',
    "confirmedAt" TIMESTAMP(3),
    "confirmedByPersonId" TEXT,
    "qualifyingAssessmentId" TEXT,
    "overrideUsed" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawnReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamResult" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "outcome" "ExamResultOutcome" NOT NULL,
    "recordedByPersonId" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "supersedesResultId" TEXT,
    "reason" TEXT,
    "remarks" TEXT,
    "assessmentId" TEXT,
    "scheduledSessionId" TEXT,
    "clientEventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Award" (
    "id" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "awardTypeId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Award_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonQualification_personId_idx" ON "PersonQualification"("personId");

-- CreateIndex
CREATE INDEX "PersonQualification_grantedByPersonId_idx" ON "PersonQualification"("grantedByPersonId");

-- CreateIndex
CREATE INDEX "ExamCandidate_studentProfileId_idx" ON "ExamCandidate"("studentProfileId");

-- CreateIndex
CREATE INDEX "ExamCandidate_awardTypeId_idx" ON "ExamCandidate"("awardTypeId");

-- CreateIndex
CREATE INDEX "ExamCandidate_groupId_idx" ON "ExamCandidate"("groupId");

-- CreateIndex
CREATE INDEX "ExamCandidate_confirmedByPersonId_idx" ON "ExamCandidate"("confirmedByPersonId");

-- CreateIndex
CREATE INDEX "ExamCandidate_qualifyingAssessmentId_idx" ON "ExamCandidate"("qualifyingAssessmentId");

-- CreateIndex
CREATE INDEX "ExamCandidate_status_idx" ON "ExamCandidate"("status");

-- CreateIndex — P-02's idempotency key, the Assessment/AttendanceEvent precedent.
CREATE UNIQUE INDEX "ExamResult_clientEventId_key" ON "ExamResult"("clientEventId");

-- CreateIndex
CREATE INDEX "ExamResult_candidateId_idx" ON "ExamResult"("candidateId");

-- CreateIndex
CREATE INDEX "ExamResult_recordedByPersonId_idx" ON "ExamResult"("recordedByPersonId");

-- CreateIndex
CREATE INDEX "ExamResult_supersedesResultId_idx" ON "ExamResult"("supersedesResultId");

-- CreateIndex
CREATE INDEX "ExamResult_assessmentId_idx" ON "ExamResult"("assessmentId");

-- CreateIndex
CREATE INDEX "ExamResult_scheduledSessionId_idx" ON "ExamResult"("scheduledSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Award_resultId_key" ON "Award"("resultId");

-- CreateIndex
CREATE UNIQUE INDEX "Award_number_key" ON "Award"("number");

-- CreateIndex
CREATE INDEX "Award_awardTypeId_idx" ON "Award"("awardTypeId");

-- AddForeignKey
ALTER TABLE "PersonQualification" ADD CONSTRAINT "PersonQualification_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonQualification" ADD CONSTRAINT "PersonQualification_grantedByPersonId_fkey" FOREIGN KEY ("grantedByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamCandidate" ADD CONSTRAINT "ExamCandidate_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamCandidate" ADD CONSTRAINT "ExamCandidate_awardTypeId_fkey" FOREIGN KEY ("awardTypeId") REFERENCES "AwardType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamCandidate" ADD CONSTRAINT "ExamCandidate_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamCandidate" ADD CONSTRAINT "ExamCandidate_confirmedByPersonId_fkey" FOREIGN KEY ("confirmedByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamCandidate" ADD CONSTRAINT "ExamCandidate_qualifyingAssessmentId_fkey" FOREIGN KEY ("qualifyingAssessmentId") REFERENCES "Assessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamResult" ADD CONSTRAINT "ExamResult_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ExamCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamResult" ADD CONSTRAINT "ExamResult_recordedByPersonId_fkey" FOREIGN KEY ("recordedByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamResult" ADD CONSTRAINT "ExamResult_supersedesResultId_fkey" FOREIGN KEY ("supersedesResultId") REFERENCES "ExamResult"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ExamResult" ADD CONSTRAINT "ExamResult_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamResult" ADD CONSTRAINT "ExamResult_scheduledSessionId_fkey" FOREIGN KEY ("scheduledSessionId") REFERENCES "ScheduledSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey — CASCADE, not RESTRICT: see the model's own comment. An
-- append-only ExamResult is erased only by cascading from StudentProfile
-- through ExamCandidate, and a RESTRICT here would break that cascade the
-- moment a passing result had an issued award.
ALTER TABLE "Award" ADD CONSTRAINT "Award_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "ExamResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Award" ADD CONSTRAINT "Award_awardTypeId_fkey" FOREIGN KEY ("awardTypeId") REFERENCES "AwardType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Hand-written constraints ────────────────────────────────────────────────

-- The cross-row half of D-061/D-062's supersession rule that a CHECK on a
-- single row can express: a correction may not point at itself. The
-- `Assessment_no_self_supersede_check` pattern (phase 2.3).
ALTER TABLE "ExamResult"
  ADD CONSTRAINT "ExamResult_no_self_supersede_check"
  CHECK ("supersedesResultId" IS NULL OR "supersedesResultId" <> "id");

-- D-085's override, audited: a reason exists exactly when the override flag is
-- set, never separately (the `Award` revocation-pair CHECK below, applied to
-- the candidacy instead of the award).
ALTER TABLE "ExamCandidate"
  ADD CONSTRAINT "ExamCandidate_override_reason_check"
  CHECK ("overrideUsed" = ("overrideReason" IS NOT NULL));

-- `status = CONFIRMED` always carries a timestamp. `confirmedByPersonId` is
-- DELIBERATELY NOT required here, even though the service always writes it at
-- confirmation time: the column is SEVER_AND_RETAIN (`onDelete: SetNull`,
-- `PERSON_REFERENCE_CLASSIFICATION`) on the exact `Assessment.assessorPersonId`
-- pattern — erasing the confirming person must be able to null this pointer
-- without leaving the confirmed candidacy itself in violation of a CHECK. A
-- constraint requiring both together would make an accountability-evidence
-- column un-severable, which is the same reasoning `Assessment.assessorPersonId`
-- is nullable for.
ALTER TABLE "ExamCandidate"
  ADD CONSTRAINT "ExamCandidate_confirmed_fields_check"
  CHECK ("status" <> 'CONFIRMED' OR "confirmedAt" IS NOT NULL);

-- `status = WITHDRAWN` carries a reason and a timestamp — never a silent
-- withdrawal, the `ScheduledSession.cancelledAt`/`cancellationReason` pattern.
ALTER TABLE "ExamCandidate"
  ADD CONSTRAINT "ExamCandidate_withdrawn_fields_check"
  CHECK (
    "status" <> 'WITHDRAWN'
    OR ("withdrawnAt" IS NOT NULL AND "withdrawnReason" IS NOT NULL)
  );

-- `Award`'s revocation pair — set together, never separately. The
-- `ScheduledSession.cancelledAt`/`cancellationReason` pattern, applied here
-- because `01-domain-model.md` §3.5 gives `Award` these two columns on the
-- SAME row rather than a new superseding row — see the model's own comment
-- for why this is flagged as a departure from pure append-only.
ALTER TABLE "Award"
  ADD CONSTRAINT "Award_revocation_reason_check"
  CHECK (("revokedAt" IS NULL) = ("revokeReason" IS NULL));
