-- CreateEnum
CREATE TYPE "DataClass" AS ENUM ('PERSON_IDENTITY', 'LOGIN_CREDENTIALS', 'MEMBERSHIP_PERIODS', 'ROLE_ASSIGNMENTS', 'STUDENT_PROFILE', 'MEDICAL_NOTES', 'ASSESSMENT_REMARKS', 'ATTENDANCE_EVENTS', 'SKILL_PROGRESS', 'ASSESSMENT_RESULTS', 'EXAM_RESULTS_AND_AWARDS', 'CHARGES', 'PAYMENTS', 'CONSENT_RECORDS', 'AUDIT_EVENTS', 'INQUIRIES', 'WAITLIST_ENTRIES', 'OPERATIONAL_LOGS', 'PRE_MIGRATION_BACKUPS', 'PUBLIC_PAGE_CONTENT', 'ORGANIZATION_SETTINGS', 'RATE_LIMIT_COUNTERS', 'API_CREDENTIALS');

-- CreateEnum
CREATE TYPE "LawfulBasis" AS ENUM ('CONSENT', 'EXPLICIT_CONSENT', 'CONTRACT', 'LEGAL_OBLIGATION', 'LEGITIMATE_INTEREST', 'VITAL_INTERESTS', 'UNRESOLVED');

-- CreateEnum
CREATE TYPE "RetentionTrigger" AS ENUM ('LAST_RELATIONSHIP_END', 'LAST_ENROLMENT_END', 'LAST_MEMBERSHIP_PERIOD_END', 'ACCOUNT_CLOSED', 'SESSION_DATE', 'ASSESSMENT_DATE', 'ACHIEVEMENT_DATE', 'AWARD_ISSUE', 'CHARGE_DUE_DATE', 'PAYMENT_RECEIVED_DATE', 'CONSENT_WITHDRAWN_OR_PURPOSE_EXPIRED', 'EVENT_DATE', 'SUBMISSION', 'PLACEMENT_OR_WITHDRAWAL', 'MIGRATION_RUN', 'RECORD_CREATION', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "OnExpiry" AS ENUM ('DELETE', 'ANONYMISE', 'REVIEW');

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "dataClass" "DataClass" NOT NULL,
    "purpose" TEXT NOT NULL,
    "proposedLawfulBasis" "LawfulBasis" NOT NULL,
    "confirmedLawfulBasis" "LawfulBasis",
    "confirmedAt" TIMESTAMP(3),
    "confirmedByPersonId" TEXT,
    "trigger" "RetentionTrigger" NOT NULL,
    "retainForDays" INTEGER,
    "onExpiry" "OnExpiry" NOT NULL,
    "anonymisedAggregate" TEXT,
    "evidencedByAudit" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("dataClass")
);

-- CreateIndex
CREATE INDEX "RetentionPolicy_confirmedByPersonId_idx" ON "RetentionPolicy"("confirmedByPersonId");

-- AddForeignKey
ALTER TABLE "RetentionPolicy" ADD CONSTRAINT "RetentionPolicy_confirmedByPersonId_fkey" FOREIGN KEY ("confirmedByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- The three CHECK constraints the Prisma DSL cannot express.
-- ENCRYPTED-COLUMN-IMPACT: name-only  (a new table; no encrypted column moves)
-- ---------------------------------------------------------------------------

-- D-155's mechanical definition, enforced rather than argued. ANONYMISE means
-- destroying the row-level record and keeping a PRE-COMPUTED aggregate with no
-- identifier, no foreign key and no timestamp finer than the window. A class
-- that cannot name such an aggregate may only be DELETE or REVIEW.
--
-- This is the constraint that would have caught the design's own mistake
-- (F-123): attendance was prescribed ANONYMISE by stripping `studentProfileId`
-- while keeping `sessionId` and the timestamps — and a group holds around twelve
-- children with retained, time-bounded memberships and known session dates, so
-- re-identification of a large share of those rows is a join and a counting
-- argument. It moved to DELETE (D-111) on exactly this reasoning.
ALTER TABLE "RetentionPolicy"
  ADD CONSTRAINT "RetentionPolicy_anonymise_requires_aggregate_check"
  CHECK ("onExpiry" <> 'ANONYMISE' OR "anonymisedAggregate" IS NOT NULL);

-- Half a confirmation is not a confirmation: the basis and the moment are
-- both null or both set. And a confirmation may not be UNRESOLVED — "we
-- confirm that we have not decided" is the false comfort D-063 and D-065
-- exist to prevent, and it is exactly what a nullable enum invites.
--
-- confirmedByPersonId is DELIBERATELY NOT part of this symmetry. It is
-- accountability metadata (who confirmed), severed independently by
-- ON DELETE SET NULL when its confirmer is erased — "a confirmation stands
-- after its confirmer leaves" (F-27, RetentionPolicy.confirmedByPersonId's own
-- doc comment). Tying it into this CHECK made that erasure impossible: sever
-- reduces to an UPDATE that nulls only confirmedByPersonId, which the wider
-- form of this constraint then rejected — the erasure transaction rolls back
-- entirely, which is the exact Article 17 failure D-135's own template
-- comment (OrganizationBranding.updatedByPersonId) warns about, reproduced
-- here through a CHECK constraint instead of a Restrict FK. Proven by
-- `tests/integration/retention-policy-constraints.test.ts`'s sever test.
ALTER TABLE "RetentionPolicy"
  ADD CONSTRAINT "RetentionPolicy_confirmation_shape_check"
  CHECK (
    ("confirmedLawfulBasis" IS NULL) = ("confirmedAt" IS NULL)
    AND ("confirmedLawfulBasis" IS NULL OR "confirmedLawfulBasis" <> 'UNRESOLVED')
  );

-- A stated duration is a positive one. Zero would mean "delete on write", which
-- is a class that should not have been collected.
ALTER TABLE "RetentionPolicy"
  ADD CONSTRAINT "RetentionPolicy_retain_for_check"
  CHECK ("retainForDays" IS NULL OR "retainForDays" > 0);
