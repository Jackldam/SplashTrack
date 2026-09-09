-- ---------------------------------------------------------------------------
-- Phase 2.3 — the `assessment` module: `Assessment`,
-- `AssessmentCriterionResult`, `CriterionWaiver` — the formal, four-eyes-gated
-- *aftest* (`01-domain-model.md` line ~130, `15-assessment-and-fees.md` §2-5;
-- D-080, D-081, D-085, D-087).
--
-- THREE NEW TABLES ONLY. `CriterionSet`/`Criterion`/`GradeValue` stay exactly
-- as `skills` owns them (D-084: one criterion catalogue, not two) and
-- `ScheduledSession` stays exactly as `sessions` owns it (D-057).
--
-- THE APPEND-ONLY PROPERTY IS NOT IN THIS FILE. Privileges are applied AFTER
-- every migration by `db:apply-grants` (`assessmentGrantStatements` in
-- `src/lib/database/role-model.ts`, documented in
-- `infra/assessment-database-role.sql`): the runtime role gets
-- `SELECT, INSERT` on all three tables and nothing else, on the
-- `attendanceGrantStatements`/`skillProgressGrantStatements` precedent —
-- built here from the start rather than retrofitted later, because CLAUDE.md
-- names append-only history as one of the five non-negotiable rules and this
-- phase's own record is the most evidential one yet (a diploma-track result).
-- Proved in `tests/integration/attendance-append-only.test.ts`, extended.
--
-- ENCRYPTED-COLUMN-IMPACT: name-only
-- Brand-new columns, not a rename — "name-only" is the correct declaration
-- because there is no pre-existing ciphertext to migrate either way (the
-- `people` module's own first migration declares the same for the same
-- reason). `Assessment.remark` and `AssessmentCriterionResult.remark` are
-- D-087/D-148's protected free-text class — the first real production
-- columns in `ENCRYPTED_COLUMNS` beyond `person_relationships.authority_evidence`.
-- See `src/lib/crypto/encrypted-columns.ts`.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "AssessmentKind" AS ENUM ('PRE_EXAM');

-- CreateEnum
CREATE TYPE "AssessmentOutcome" AS ENUM ('PASS', 'FAIL');

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "kind" "AssessmentKind" NOT NULL,
    "criterionSetId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "assessorPersonId" TEXT,
    "assessedAt" TIMESTAMP(3) NOT NULL,
    "scheduledSessionId" TEXT,
    "outcome" "AssessmentOutcome" NOT NULL,
    "outcomeComputedAt" TIMESTAMP(3) NOT NULL,
    "supersedesAssessmentId" TEXT,
    "groupId" TEXT NOT NULL,
    "remark" TEXT,
    "clientEventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentCriterionResult" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "gradeValueId" TEXT NOT NULL,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentCriterionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CriterionWaiver" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "grantedByPersonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CriterionWaiver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — P-02's idempotency key, the attendance precedent.
CREATE UNIQUE INDEX "Assessment_clientEventId_key" ON "Assessment"("clientEventId");

-- CreateIndex
CREATE INDEX "Assessment_studentProfileId_assessedAt_idx" ON "Assessment"("studentProfileId", "assessedAt");

-- CreateIndex
CREATE INDEX "Assessment_criterionSetId_idx" ON "Assessment"("criterionSetId");

-- CreateIndex
CREATE INDEX "Assessment_scheduledSessionId_idx" ON "Assessment"("scheduledSessionId");

-- CreateIndex
CREATE INDEX "Assessment_assessorPersonId_idx" ON "Assessment"("assessorPersonId");

-- CreateIndex
CREATE INDEX "Assessment_groupId_idx" ON "Assessment"("groupId");

-- CreateIndex
CREATE INDEX "Assessment_supersedesAssessmentId_idx" ON "Assessment"("supersedesAssessmentId");

-- CreateIndex
CREATE INDEX "AssessmentCriterionResult_criterionId_idx" ON "AssessmentCriterionResult"("criterionId");

-- CreateIndex
CREATE INDEX "AssessmentCriterionResult_gradeValueId_idx" ON "AssessmentCriterionResult"("gradeValueId");

-- CreateIndex — one result per criterion per sitting (§2.6's own model comment).
CREATE UNIQUE INDEX "AssessmentCriterionResult_assessmentId_criterionId_key" ON "AssessmentCriterionResult"("assessmentId", "criterionId");

-- CreateIndex
CREATE INDEX "CriterionWaiver_criterionId_idx" ON "CriterionWaiver"("criterionId");

-- CreateIndex
CREATE INDEX "CriterionWaiver_grantedByPersonId_idx" ON "CriterionWaiver"("grantedByPersonId");

-- CreateIndex — one waiver per criterion per sitting.
CREATE UNIQUE INDEX "CriterionWaiver_assessmentId_criterionId_key" ON "CriterionWaiver"("assessmentId", "criterionId");

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_criterionSetId_fkey" FOREIGN KEY ("criterionSetId") REFERENCES "CriterionSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_assessorPersonId_fkey" FOREIGN KEY ("assessorPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_scheduledSessionId_fkey" FOREIGN KEY ("scheduledSessionId") REFERENCES "ScheduledSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_supersedesAssessmentId_fkey" FOREIGN KEY ("supersedesAssessmentId") REFERENCES "Assessment"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentCriterionResult" ADD CONSTRAINT "AssessmentCriterionResult_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentCriterionResult" ADD CONSTRAINT "AssessmentCriterionResult_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "Criterion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentCriterionResult" ADD CONSTRAINT "AssessmentCriterionResult_gradeValueId_fkey" FOREIGN KEY ("gradeValueId") REFERENCES "GradeValue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriterionWaiver" ADD CONSTRAINT "CriterionWaiver_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriterionWaiver" ADD CONSTRAINT "CriterionWaiver_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "Criterion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriterionWaiver" ADD CONSTRAINT "CriterionWaiver_grantedByPersonId_fkey" FOREIGN KEY ("grantedByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Hand-written constraint ─────────────────────────────────────────────────
-- The cross-row half of D-061/D-062's supersession rule that a CHECK on a
-- single row can express: a correction may not point at itself. The other
-- half — a superseding `Assessment` must share its predecessor's student and
-- criterion set — is a cross-row rule no CHECK can state; `recordAssessment`
-- enforces it inside the writing transaction, the `amendAttendance` pattern.
ALTER TABLE "Assessment"
  ADD CONSTRAINT "Assessment_no_self_supersede_check"
  CHECK ("supersedesAssessmentId" IS NULL OR "supersedesAssessmentId" <> "id");
