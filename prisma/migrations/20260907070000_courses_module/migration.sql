-- ---------------------------------------------------------------------------
-- Phase 2.0 — the `courses` module (D-059, D-093, D-109, D-134, D-145, D-163,
-- D-170, D-180).
--
-- What is taught, its levels, and who is signed up for it — the module
-- `01-domain-model.md` §2.3 keeps deliberately separate from `Group`: a course
-- is *what* is taught, a group is *who* is taught together, when, by whom.
-- Conflating them is "the single most common modelling error in this domain".
--
-- ENCRYPTED-COLUMN-IMPACT: none
--   Nothing here is in `ENCRYPTED_COLUMNS`. The one free-text column this
--   migration adds — `Course.description` — describes a COURSE and never a
--   child, so it is not in D-148's protected class (medical remarks, pastoral
--   notes, assessment remarks, inquiry text). That is the same judgement
--   `StudentLifecycleEvent.reason` and `GroupMove.reason` record, applied to
--   text one step further from a person than either of those.
--
-- THE COLUMN PHASE 1.6 REFUSED TO ADD, ADDED. `Group.courseLevelId` is §3.2's
-- own field, and `docs/build/phase-1.6-groups-and-sessions-report.md` §2.1
-- declined it because `CourseLevel` did not exist: "a dangling id column with
-- no table behind it is the stub column D-163 refuses ... A group's level lives
-- in its name until `courses` lands." It has landed. The column is NULLABLE and
-- there is NO BACKFILL — parsing a level out of *"Diploma B donderdag"* would
-- write a fact nobody stated, and D-180's placement decision reads this column.
--
-- WHAT IS STILL NOT HERE, AND WHY THAT IS NOT AN OVERSIGHT:
--   - `CourseLevel.awardTypeId` (§3.2). `AwardType` belongs to the assessment
--     module, which is not built; the column would be the same stub this
--     migration is finally allowed to stop being. It arrives with `AwardType`
--     and its `CriterionSet` (`15-assessment-and-fees.md` §2.6).
--   - Any end date on `Course`. D-170 bounds a `COURSE` grant at "the course's
--     own end date + 7 days" and §3.2's field list gives a course no dates.
--     `courseEndDate` therefore resolves NULL and `assertGrantable` refuses
--     every `COURSE` proposal — the safe direction. Open question in
--     `docs/build/phase-2.0-courses-report.md`.
--   - `WaitlistEntry.courseLevelId` (§3.1). The waiting list is R-33's own
--     slice and is explicitly out of this one.
-- ---------------------------------------------------------------------------

-- CreateEnum
--
-- TWO MEMBERS, AND NEITHER OF THEM IS A PAYMENT STATE (D-093, P-03). Whether an
-- enrolment is RUNNING is `endedAt IS NULL` — one home for one fact (D-134), on
-- the interval rule `MembershipPeriod` and `GroupMembership` already follow
-- (D-059) — so there is deliberately no `ACTIVE`/`ENDED` member to disagree
-- with the column. `TRIAL` is D-109's *proefzwemmer*: a model, never a
-- workflow.
CREATE TYPE "EnrolmentStatus" AS ENUM ('ENROLLED', 'TRIAL');

-- AlterTable
--
-- NULLABLE and with no DEFAULT, which is the safe shape on a populated
-- database (`tests/unit/migration-safety.test.ts`) and also the honest one:
-- null means "nobody has recorded a level for this group", and every screen
-- renders it as that rather than as a level.
ALTER TABLE "Group" ADD COLUMN     "courseLevelId" TEXT;

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseLevel" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrolment" (
    "id" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "status" "EnrolmentStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Enrolment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Course_active_idx" ON "Course"("active");

-- CreateIndex
CREATE INDEX "CourseLevel_courseId_idx" ON "CourseLevel"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseLevel_courseId_sequence_key" ON "CourseLevel"("courseId", "sequence");

-- CreateIndex
CREATE INDEX "Enrolment_studentProfileId_idx" ON "Enrolment"("studentProfileId");

-- CreateIndex
CREATE INDEX "Enrolment_courseId_idx" ON "Enrolment"("courseId");

-- CreateIndex
CREATE INDEX "Enrolment_courseId_studentProfileId_endedAt_idx" ON "Enrolment"("courseId", "studentProfileId", "endedAt");

-- CreateIndex
CREATE INDEX "Enrolment_studentProfileId_endedAt_idx" ON "Enrolment"("studentProfileId", "endedAt");

-- CreateIndex
CREATE INDEX "Group_courseLevelId_idx" ON "Group"("courseLevelId");

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_courseLevelId_fkey" FOREIGN KEY ("courseLevelId") REFERENCES "CourseLevel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseLevel" ADD CONSTRAINT "CourseLevel_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrolment" ADD CONSTRAINT "Enrolment_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrolment" ADD CONSTRAINT "Enrolment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- The constraints the Prisma DSL cannot express. Invisible in schema.prisma and
-- easy to lose in a future "regenerate the migrations" tidy-up, which is why
-- `tests/integration/courses-constraints.test.ts` names each one.
-- ---------------------------------------------------------------------------

-- D-059's interval rule, applied to enrolment. An enrolment that ends before it
-- starts is active for no instant at all — and this table's interval is an
-- ACCESS decision as well as a record: `isEnrolledInCourse` reads `endedAt`
-- live to decide what a `COURSE`-scoped principal may see (§2.2, D-145), so a
-- silently dead row is a pupil an examiner cannot see and nobody can explain.
--
-- HALF-OPEN, END EXCLUSIVE, the same rule `GroupMembership_window_order_check`
-- carries: `>` and not `>=`, so a zero-length enrolment cannot be written and
-- then puzzled over.
ALTER TABLE "Enrolment"
  ADD CONSTRAINT "Enrolment_window_order_check"
  CHECK ("endedAt" IS NULL OR "endedAt" > "startedAt");

-- AT MOST ONE OPEN ENROLMENT PER PUPIL PER COURSE, on the shape
-- `GroupMembership_single_open_placement_key` established. "Is this child
-- enrolled in this course right now" is derived from whether an open row
-- exists, so two open rows make that one question with two answers — the exact
-- failure a status flag has, which is why there is no status flag.
--
-- It is scoped to the COURSE and not to the pupil: a child taking Zwem-ABC and
-- Snorkelen at once has two open enrolments and that is ordinary. Overlapping
-- CLOSED rows stay legal, because a club back-filling its paper history
-- produces them.
--
-- IT IS ALSO WHAT MAKES A TRIAL CONVERT HONESTLY. A *proefzwemmer* whose TRIAL
-- row is still open cannot be given an ENROLLED row for the same course until
-- the trial is closed — so the conversion is two dated facts rather than a
-- status column edited in place, and the record that the trial happened
-- survives (D-109's model, without D-109's forbidden workflow).
CREATE UNIQUE INDEX "Enrolment_single_open_enrolment_key"
  ON "Enrolment" ("courseId", "studentProfileId")
  WHERE "endedAt" IS NULL;

-- A level's `sequence` is a POSITION, allocated 1-based by the service. Zero or
-- negative is only ever a typo, and it sorts the level to the front of a list
-- that decides what "the next level" is. Same reasoning and same shape as
-- `Group_capacity_positive_check`: the service refuses it with a sentence, and
-- the database holds the floor against a path nobody has written yet.
ALTER TABLE "CourseLevel"
  ADD CONSTRAINT "CourseLevel_sequence_positive_check"
  CHECK ("sequence" > 0);
