-- The grant tuple becomes (permission-via-role, SCOPE, WINDOW, GRANTER).
-- D-144 as completed by D-170; the scope enum is D-147/§2.1. F-113.
--
-- ENCRYPTED-COLUMN-IMPACT: name-only
--   No registered encrypted column lives on either table (the registry is still
--   empty of production columns — `src/lib/crypto/encrypted-columns.ts`), and no
--   row's primary key moves here: `RoleAssignment.id` and
--   `CredentialRoleAssignment.id` are untouched. Declared anyway because the
--   check in `tests/unit/migration-safety.test.ts` is cheap and the habit is the
--   control.
--
-- WHY THE BACKFILL EXISTS despite there being no released version. `unitId`
-- carried two of the six scope types: NULL meant "the whole organisation" and a
-- value meant "that unit". Dropping the column and adding a NOT NULL `scopeType`
-- in one statement is what Prisma generated and it fails on any populated
-- database — which is exactly what the `migrate-populated` CI gate exists to
-- catch (`06-delivery.md` §2.1). The three-step add/backfill/constrain below is
-- the shape every later migration touching a live column must take.

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('ORGANIZATION', 'UNIT', 'GROUP', 'COURSE', 'SESSION', 'SELF');

-- ---------------------------------------------------------------------------
-- RoleAssignment
-- ---------------------------------------------------------------------------

-- Step 1: add the new columns, `scopeType` NULLABLE for the moment.
ALTER TABLE "RoleAssignment"
  ADD COLUMN "scopeType"         "ScopeType",
  ADD COLUMN "scopeId"           TEXT,
  ADD COLUMN "validFrom"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "validUntil"        TIMESTAMP(3),
  ADD COLUMN "grantedByPersonId" TEXT;

-- Step 2: backfill from the column being replaced. NULL unitId was
-- organisation-wide; a value was that unit, flat (D-121).
UPDATE "RoleAssignment"
   SET "scopeType" = CASE WHEN "unitId" IS NULL THEN 'ORGANIZATION'::"ScopeType"
                          ELSE 'UNIT'::"ScopeType" END,
       "scopeId"   = "unitId";

-- Step 3: constrain, and only now drop the old column and its constraints.
ALTER TABLE "RoleAssignment" ALTER COLUMN "scopeType" SET NOT NULL;

ALTER TABLE "RoleAssignment" DROP CONSTRAINT "RoleAssignment_unitId_fkey";
DROP INDEX "RoleAssignment_personId_roleId_unitId_key";
DROP INDEX "RoleAssignment_unitId_idx";
ALTER TABLE "RoleAssignment" DROP COLUMN "unitId";

-- `scopeId` is NULL exactly for the two scope types the row itself implies:
-- ORGANIZATION (the installation) and SELF (`personId`). A grant naming a scope
-- type with no referent would otherwise read as "everything of that kind".
ALTER TABLE "RoleAssignment"
  ADD CONSTRAINT "RoleAssignment_scope_shape_check"
  CHECK (("scopeType" IN ('ORGANIZATION', 'SELF')) = ("scopeId" IS NULL));

-- `validUntil` is MANDATORY for the two bounded-window scopes. D-144 makes it
-- schema-mandatory for SESSION; D-170's ceiling table adds COURSE ("mandatory
-- and bounded"), which is what §2.4's "Internal examiner, time-bounded" always
-- meant. The VALUE ceilings — session date + 7 days, course end + 7 days — are
-- enforced in the grant service, because the tables they are computed from do
-- not exist yet.
ALTER TABLE "RoleAssignment"
  ADD CONSTRAINT "RoleAssignment_bounded_window_check"
  CHECK ("scopeType" NOT IN ('SESSION', 'COURSE') OR "validUntil" IS NOT NULL);

ALTER TABLE "RoleAssignment"
  ADD CONSTRAINT "RoleAssignment_window_order_check"
  CHECK ("validUntil" IS NULL OR "validUntil" > "validFrom");

-- Duplicate STANDING grants are noise and are refused; overlapping BOUNDED
-- grants are legitimate history (an examiner graded Diploma B in March and
-- grades it again in June) and are allowed. NULLS NOT DISTINCT is what makes
-- this bite for ORGANIZATION and SELF, whose scopeId is NULL.
CREATE UNIQUE INDEX "RoleAssignment_standing_grant_key"
  ON "RoleAssignment" ("personId", "roleId", "scopeType", "scopeId")
  NULLS NOT DISTINCT
  WHERE "validUntil" IS NULL;

CREATE INDEX "RoleAssignment_grantedByPersonId_idx" ON "RoleAssignment"("grantedByPersonId");
CREATE INDEX "RoleAssignment_personId_validFrom_validUntil_idx" ON "RoleAssignment"("personId", "validFrom", "validUntil");
CREATE INDEX "RoleAssignment_scopeType_scopeId_idx" ON "RoleAssignment"("scopeType", "scopeId");

-- SetNull, not Restrict: the erasure severs this pointer explicitly, and this is
-- the defence in depth that stops a future delete path which forgets the sever
-- from rolling back an entire Article 17 erasure.
ALTER TABLE "RoleAssignment"
  ADD CONSTRAINT "RoleAssignment_grantedByPersonId_fkey"
  FOREIGN KEY ("grantedByPersonId") REFERENCES "Person"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- CredentialRoleAssignment — the same tuple, for the same reason (see the model
-- comment). Nothing reads this table in v1; it gets one grant shape anyway so
-- the credential principal is not the one the scope model fails to bind.
-- ---------------------------------------------------------------------------

ALTER TABLE "CredentialRoleAssignment"
  ADD COLUMN "scopeType"         "ScopeType",
  ADD COLUMN "scopeId"           TEXT,
  ADD COLUMN "validFrom"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "validUntil"        TIMESTAMP(3),
  ADD COLUMN "grantedByPersonId" TEXT;

UPDATE "CredentialRoleAssignment"
   SET "scopeType" = CASE WHEN "unitId" IS NULL THEN 'ORGANIZATION'::"ScopeType"
                          ELSE 'UNIT'::"ScopeType" END,
       "scopeId"   = "unitId";

ALTER TABLE "CredentialRoleAssignment" ALTER COLUMN "scopeType" SET NOT NULL;

ALTER TABLE "CredentialRoleAssignment" DROP CONSTRAINT "CredentialRoleAssignment_unitId_fkey";
DROP INDEX "CredentialRoleAssignment_credentialId_roleId_unitId_key";
DROP INDEX "CredentialRoleAssignment_unitId_idx";
ALTER TABLE "CredentialRoleAssignment" DROP COLUMN "unitId";

ALTER TABLE "CredentialRoleAssignment"
  ADD CONSTRAINT "CredentialRoleAssignment_scope_shape_check"
  CHECK (("scopeType" IN ('ORGANIZATION', 'SELF')) = ("scopeId" IS NULL));

ALTER TABLE "CredentialRoleAssignment"
  ADD CONSTRAINT "CredentialRoleAssignment_bounded_window_check"
  CHECK ("scopeType" NOT IN ('SESSION', 'COURSE') OR "validUntil" IS NOT NULL);

ALTER TABLE "CredentialRoleAssignment"
  ADD CONSTRAINT "CredentialRoleAssignment_window_order_check"
  CHECK ("validUntil" IS NULL OR "validUntil" > "validFrom");

CREATE UNIQUE INDEX "CredentialRoleAssignment_standing_grant_key"
  ON "CredentialRoleAssignment" ("credentialId", "roleId", "scopeType", "scopeId")
  NULLS NOT DISTINCT
  WHERE "validUntil" IS NULL;

CREATE INDEX "CredentialRoleAssignment_scopeType_scopeId_idx" ON "CredentialRoleAssignment"("scopeType", "scopeId");
