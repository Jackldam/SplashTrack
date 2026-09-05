-- ---------------------------------------------------------------------------
-- Phase 1.1 — the `people` module (D-053, D-058, D-059, D-063, D-151).
--
-- The first DOMAIN tables in this schema. Everything before this migration was
-- foundation: identity, authorization, settings, audit, retention.
--
-- ENCRYPTED-COLUMN-IMPACT: name-only
--   `PersonRelationship.evidence` is the first production column in
--   `ENCRYPTED_COLUMNS` and this migration CREATES it. No existing ciphertext
--   moves, no primary key changes, and no value is copied between rows — so
--   there is nothing to decrypt and re-encrypt (D-167,
--   `13-configuration-and-setup.md` §5.1.1). The declaration is required
--   regardless, because `tests/unit/migration-safety.test.ts` now sees a
--   registered protected model in this file.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "StudentLifecycleEventType" AS ENUM ('JOINED', 'PAUSED', 'LEFT', 'RETURNED', 'TRIAL_ATTENDED');

-- CreateEnum
CREATE TYPE "PersonRelationshipType" AS ENUM ('GUARDIAN_OF', 'EMERGENCY_CONTACT');

-- AlterEnum
-- `PERSON_RELATIONSHIPS` — a new retention data class (D-065, D-110). Adding a
-- member is adding a POLICY, and the row that carries it is seeded by
-- `RETENTION_CATALOGUE`, never by this migration: a shipped default is a
-- PROPOSAL the organisation confirms (F-27), not a fact a migration asserts.
ALTER TYPE "DataClass" ADD VALUE 'PERSON_RELATIONSHIPS';

-- AlterTable — Person acquires the §3.1 identity fields.
--
-- `dateOfBirth` is a DATE and is NULLABLE (D-172): a birthday is a calendar day,
-- and a placeholder date is forbidden outright because it is indistinguishable
-- from a real one the moment it is written. Unknown date ⇒ guardian authority
-- derives to LAPSED, which is the visible direction.
ALTER TABLE "Person" ADD COLUMN     "dateOfBirth" DATE,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "phone" TEXT;

-- AlterTable — Membership acquires its member number.
--
-- THREE STATEMENTS, NOT ONE, and that is the rule `tests/unit/migration-safety.test.ts`
-- enforces. `ADD COLUMN ... TEXT NOT NULL` with no DEFAULT succeeds against the
-- empty tables Prisma replays migrations on and fails with P3009 against a
-- POPULATED database — stranding an unattended container start (R-20) and
-- blocking every later migration until an operator resolves it by hand. Add
-- nullable, backfill, then SET NOT NULL.
--
-- The backfill issues `M-00001`, `M-00002`, … in `createdAt` order. Every
-- instance in existence has zero `Membership` rows (nothing wrote this table
-- before this module), so in practice it is a no-op — written correctly anyway,
-- because "there is no data yet" is a claim about today.
ALTER TABLE "Membership" ADD COLUMN "memberNumber" TEXT;

UPDATE "Membership" AS m
   SET "memberNumber" = 'M-' || lpad(numbered.seq::text, 5, '0')
  FROM (
        SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS seq
          FROM "Membership"
       ) AS numbered
 WHERE m."id" = numbered."id";

ALTER TABLE "Membership" ALTER COLUMN "memberNumber" SET NOT NULL;

-- CreateTable
CREATE TABLE "MembershipPeriod" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentProfile" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "studentNumber" TEXT NOT NULL,
    "unitId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentLifecycleEvent" (
    "id" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "type" "StudentLifecycleEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentLifecycleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonRelationship" (
    "id" TEXT NOT NULL,
    "fromPersonId" TEXT NOT NULL,
    "toPersonId" TEXT NOT NULL,
    "type" "PersonRelationshipType" NOT NULL,
    "authority" BOOLEAN NOT NULL DEFAULT false,
    "evidence" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MembershipPeriod_membershipId_idx" ON "MembershipPeriod"("membershipId");

-- CreateIndex
CREATE INDEX "MembershipPeriod_membershipId_endedAt_idx" ON "MembershipPeriod"("membershipId", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StudentProfile_personId_key" ON "StudentProfile"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentProfile_studentNumber_key" ON "StudentProfile"("studentNumber");

-- CreateIndex
CREATE INDEX "StudentProfile_unitId_idx" ON "StudentProfile"("unitId");

-- CreateIndex
CREATE INDEX "StudentLifecycleEvent_studentProfileId_idx" ON "StudentLifecycleEvent"("studentProfileId");

-- CreateIndex
CREATE INDEX "StudentLifecycleEvent_studentProfileId_occurredAt_idx" ON "StudentLifecycleEvent"("studentProfileId", "occurredAt");

-- CreateIndex
CREATE INDEX "PersonRelationship_fromPersonId_idx" ON "PersonRelationship"("fromPersonId");

-- CreateIndex
CREATE INDEX "PersonRelationship_toPersonId_idx" ON "PersonRelationship"("toPersonId");

-- CreateIndex
CREATE INDEX "PersonRelationship_toPersonId_type_validTo_idx" ON "PersonRelationship"("toPersonId", "type", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_memberNumber_key" ON "Membership"("memberNumber");

-- AddForeignKey
ALTER TABLE "MembershipPeriod" ADD CONSTRAINT "MembershipPeriod_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OrganizationUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentLifecycleEvent" ADD CONSTRAINT "StudentLifecycleEvent_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonRelationship" ADD CONSTRAINT "PersonRelationship_fromPersonId_fkey" FOREIGN KEY ("fromPersonId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonRelationship" ADD CONSTRAINT "PersonRelationship_toPersonId_fkey" FOREIGN KEY ("toPersonId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- The constraints the Prisma DSL cannot express. Invisible in schema.prisma and
-- easy to lose in a future "regenerate the migrations" tidy-up, which is why
-- `tests/integration/membership-periods.test.ts` and
-- `tests/integration/person-relationship-constraints.test.ts` name each one.
-- ---------------------------------------------------------------------------

-- D-059's intervals, kept honest. A period that ends before it starts is a
-- data-entry accident that would read as a silently dead membership.
ALTER TABLE "MembershipPeriod"
  ADD CONSTRAINT "MembershipPeriod_window_order_check"
  CHECK ("endedAt" IS NULL OR "endedAt" > "startedAt");

-- AT MOST ONE OPEN PERIOD PER MEMBER. Belonging is a set of intervals and
-- "is this person a member?" is derived from whether an open one exists — so two
-- open periods make that question one with two answers, which is precisely the
-- failure the deleted `status` flag had. Overlapping CLOSED periods stay legal:
-- a club back-filling its paper history produces them, and refusing legitimate
-- history to enforce tidiness is how a status flag gets reinvented.
CREATE UNIQUE INDEX "MembershipPeriod_single_open_period_key"
  ON "MembershipPeriod" ("membershipId")
  WHERE "endedAt" IS NULL;

-- D-063: guardian authority is EVIDENCE OF A CLAIM, never a legal fact the
-- application can verify. An authority claim with no recorded basis is the false
-- comfort that decides a custody dispute the wrong way, so the basis is
-- mandatory at the database and not in a form validator.
ALTER TABLE "PersonRelationship"
  ADD CONSTRAINT "PersonRelationship_evidence_required_check"
  CHECK ("authority" = false OR ("evidence" IS NOT NULL AND length("evidence") > 0));

-- Only a guardian may carry authority. An emergency contact is someone to
-- telephone, not someone who may consent on a child's behalf, and the two get
-- conflated at exactly the moment nobody is checking.
ALTER TABLE "PersonRelationship"
  ADD CONSTRAINT "PersonRelationship_authority_kind_check"
  CHECK ("authority" = false OR "type" = 'GUARDIAN_OF');

-- Nobody is their own guardian or their own emergency contact.
ALTER TABLE "PersonRelationship"
  ADD CONSTRAINT "PersonRelationship_no_self_reference_check"
  CHECK ("fromPersonId" <> "toPersonId");

-- A zero-or-negative validity window reads as a silently dead relationship —
-- the same shape `RoleAssignment_window_order_check` refuses for a grant.
ALTER TABLE "PersonRelationship"
  ADD CONSTRAINT "PersonRelationship_window_order_check"
  CHECK ("validTo" IS NULL OR "validTo" > "validFrom");

-- Duplicate STANDING relationships between the same pair are pure noise and are
-- refused; closed historical ones are legitimate and are allowed. The same
-- partial-unique shape as `RoleAssignment_standing_grant_key`.
CREATE UNIQUE INDEX "PersonRelationship_standing_relationship_key"
  ON "PersonRelationship" ("fromPersonId", "toPersonId", "type")
  WHERE "validTo" IS NULL;
