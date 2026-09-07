-- ---------------------------------------------------------------------------
-- Phase 2.1 — the `skills` module (D-080, D-081, D-084, D-160, D-164, D-188).
--
-- The criterion catalogue — `AwardType`, `GradeScale`/`GradeValue`,
-- `CriterionSet`, `Criterion` — and `SkillProgress`, the append-only, informal
-- per-lesson teaching log kept against it. `01-domain-model.md` §3.3,
-- `15-assessment-and-fees.md` §2.
--
-- ENCRYPTED-COLUMN-IMPACT: none
--   Nothing here is in `ENCRYPTED_COLUMNS`. `SkillProgress.note` is free text
--   about a child and is flagged as an OPEN QUESTION against D-148's protected
--   class in the phase 2.1 report rather than encrypted here without a
--   decision — see that report before assuming this column is out of scope for
--   review.
--
-- WHAT THIS MIGRATION DOES NOT SHIP: any row in `AwardType`, `CriterionSet` or
-- `Criterion`. D-164: the catalogue is authored in the application, never
-- seeded — "the NRZ requirements are reference material, not content to ship".
-- `GradeScale`/`GradeValue` are the one exception and are seeded by
-- `seedInstallation()` (`src/lib/boot/seed.ts`), not by this migration — the
-- same split the permission catalogue and the two system roles already use,
-- so a fresh install and an upgraded one seed through the same idempotent
-- path rather than a migration-time INSERT nothing else in this schema uses.
--
-- THE COLUMN PHASE 2.0 LEFT AS AN OPEN STUB. `CourseLevel.awardTypeId` (§3.2)
-- was declined in `20260907070000_courses_module` because `AwardType` did not
-- exist yet. It exists now. Nullable, unbackfilled — "we have not linked this
-- level to a diploma" is a real state, not an error.
-- ---------------------------------------------------------------------------

-- CreateEnum
--
-- D-082's rename lives in the diploma/certificate distinction here, not in a
-- second table — `AwardType.kind`, never a branch in code (D-080).
CREATE TYPE "AwardTypeKind" AS ENUM ('DIPLOMA', 'CERTIFICATE');

-- CreateEnum
CREATE TYPE "AwardIssuingBody" AS ENUM ('NRZ', 'ORG');

-- CreateEnum
--
-- D-081: DRAFT while composed, ACTIVE once published, RETIRED when a later
-- version replaces it. Exactly one ACTIVE version per AwardType — see the
-- hand-written partial unique index below; the Prisma DSL cannot express it.
CREATE TYPE "CriterionSetStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
--
-- The PROVENANCE label (D-164/§2.5) — not who issues the award
-- (AwardType.issuingBody, above). NRZ = "our transcription of the national
-- requirements"; ORG = "ours", including a fork of an NRZ set.
CREATE TYPE "CriterionSetSource" AS ENUM ('NRZ', 'ORG');

-- CreateEnum
--
-- The four states `01-domain-model.md` §3.3 names, and exactly those. REVOKED
-- is a state written the same way any other is (append-only, D-005's
-- pattern) — never a delete, never an UPDATE of an earlier row.
CREATE TYPE "SkillProgressState" AS ENUM ('INTRODUCED', 'PRACTISING', 'ACHIEVED', 'REVOKED');

-- AlterTable
--
-- NULLABLE, no default, no backfill — the same safe shape
-- `Group.courseLevelId` used when it arrived a phase early: null means
-- "nobody has recorded what this level trains towards", not "trains for
-- nothing".
ALTER TABLE "CourseLevel" ADD COLUMN     "awardTypeId" TEXT;

-- CreateTable
CREATE TABLE "AwardType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AwardTypeKind" NOT NULL,
    "issuingBody" "AwardIssuingBody" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AwardType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeScale" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradeScale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeValue" (
    "id" TEXT NOT NULL,
    "scaleId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradeValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CriterionSet" (
    "id" TEXT NOT NULL,
    "awardTypeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" "CriterionSetSource" NOT NULL,
    "status" "CriterionSetStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "passFloorGradeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CriterionSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Criterion" (
    "id" TEXT NOT NULL,
    "criterionSetId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "minimumGradeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Criterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillProgress" (
    "id" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "state" "SkillProgressState" NOT NULL,
    "assessedByPersonId" TEXT,
    "assessedAt" TIMESTAMP(3) NOT NULL,
    "sessionId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AwardType_code_key" ON "AwardType"("code");

-- CreateIndex
CREATE INDEX "AwardType_kind_idx" ON "AwardType"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "GradeScale_code_key" ON "GradeScale"("code");

-- CreateIndex
CREATE INDEX "GradeValue_scaleId_idx" ON "GradeValue"("scaleId");

-- CreateIndex
CREATE UNIQUE INDEX "GradeValue_scaleId_code_key" ON "GradeValue"("scaleId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "GradeValue_scaleId_rank_key" ON "GradeValue"("scaleId", "rank");

-- CreateIndex
CREATE INDEX "CriterionSet_awardTypeId_idx" ON "CriterionSet"("awardTypeId");

-- CreateIndex
CREATE INDEX "CriterionSet_passFloorGradeId_idx" ON "CriterionSet"("passFloorGradeId");

-- CreateIndex
CREATE UNIQUE INDEX "CriterionSet_awardTypeId_version_key" ON "CriterionSet"("awardTypeId", "version");

-- CreateIndex
CREATE INDEX "Criterion_criterionSetId_idx" ON "Criterion"("criterionSetId");

-- CreateIndex
CREATE INDEX "Criterion_minimumGradeId_idx" ON "Criterion"("minimumGradeId");

-- CreateIndex
CREATE UNIQUE INDEX "Criterion_criterionSetId_code_key" ON "Criterion"("criterionSetId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Criterion_criterionSetId_sequence_key" ON "Criterion"("criterionSetId", "sequence");

-- CreateIndex
CREATE INDEX "SkillProgress_studentProfileId_assessedAt_idx" ON "SkillProgress"("studentProfileId", "assessedAt");

-- CreateIndex
CREATE INDEX "SkillProgress_criterionId_idx" ON "SkillProgress"("criterionId");

-- CreateIndex
CREATE INDEX "SkillProgress_sessionId_idx" ON "SkillProgress"("sessionId");

-- CreateIndex
CREATE INDEX "SkillProgress_assessedByPersonId_idx" ON "SkillProgress"("assessedByPersonId");

-- CreateIndex
CREATE INDEX "CourseLevel_awardTypeId_idx" ON "CourseLevel"("awardTypeId");

-- AddForeignKey
ALTER TABLE "CourseLevel" ADD CONSTRAINT "CourseLevel_awardTypeId_fkey" FOREIGN KEY ("awardTypeId") REFERENCES "AwardType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeValue" ADD CONSTRAINT "GradeValue_scaleId_fkey" FOREIGN KEY ("scaleId") REFERENCES "GradeScale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriterionSet" ADD CONSTRAINT "CriterionSet_awardTypeId_fkey" FOREIGN KEY ("awardTypeId") REFERENCES "AwardType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriterionSet" ADD CONSTRAINT "CriterionSet_passFloorGradeId_fkey" FOREIGN KEY ("passFloorGradeId") REFERENCES "GradeValue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Criterion" ADD CONSTRAINT "Criterion_criterionSetId_fkey" FOREIGN KEY ("criterionSetId") REFERENCES "CriterionSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Criterion" ADD CONSTRAINT "Criterion_minimumGradeId_fkey" FOREIGN KEY ("minimumGradeId") REFERENCES "GradeValue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillProgress" ADD CONSTRAINT "SkillProgress_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillProgress" ADD CONSTRAINT "SkillProgress_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "Criterion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillProgress" ADD CONSTRAINT "SkillProgress_assessedByPersonId_fkey" FOREIGN KEY ("assessedByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillProgress" ADD CONSTRAINT "SkillProgress_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ScheduledSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- The constraints the Prisma DSL cannot express. Invisible in schema.prisma and
-- easy to lose in a future "regenerate the migrations" tidy-up, which is why
-- `tests/integration/skills-constraints.test.ts` names each one — the
-- `courses-constraints.test.ts` pattern, one migration later.
-- ---------------------------------------------------------------------------

-- D-081: exactly one ACTIVE CriterionSet per AwardType. A partial unique index
-- rather than a CHECK, because the rule is about SIBLING rows, not about one
-- row's own columns — the same shape
-- `Enrolment_single_open_enrolment_key` uses for "at most one open enrolment".
-- `publishCriterionSet` checks this in the service first, so an administrator
-- gets a sentence; the index is what holds against a path nobody has written
-- yet, including a second publish racing the first.
CREATE UNIQUE INDEX "CriterionSet_one_active_per_award_type_key"
  ON "CriterionSet" ("awardTypeId")
  WHERE "status" = 'ACTIVE';

-- A criterion's `sequence` is a POSITION, allocated 1-based by the service, on
-- exactly `CourseLevel_sequence_positive_check`'s reasoning: zero or negative
-- is only ever a typo, and it would sort the criterion to the front of a list
-- that decides nothing but is read as an order regardless.
ALTER TABLE "Criterion"
  ADD CONSTRAINT "Criterion_sequence_positive_check"
  CHECK ("sequence" > 0);

-- A grade's `rank` is the ONLY thing D-080's pass function compares
-- (`rank(result) >= rank(minimum)`); zero or negative breaks that comparison
-- against a floor of "no minimum recorded" in the same way a non-positive
-- sequence breaks ordering. Seeded data only writes 1..5, and this is the
-- floor against any future authoring path for a second scale (D-160's OD-17
-- note: the model permits one, even though v1 seeds and uses only the first).
ALTER TABLE "GradeValue"
  ADD CONSTRAINT "GradeValue_rank_positive_check"
  CHECK ("rank" > 0);

-- D-081: a published (ACTIVE or RETIRED) set carries the effectiveFrom that
-- publishing stamped; a DRAFT has none yet. Mirrors
-- `ScheduledSession`'s cancelledAt/cancellationReason pairing: the STATUS and
-- the DATE that explains it are written together or not at all, never one
-- without the other.
ALTER TABLE "CriterionSet"
  ADD CONSTRAINT "CriterionSet_effective_from_with_status_check"
  CHECK (("status" = 'DRAFT') = ("effectiveFrom" IS NULL));
