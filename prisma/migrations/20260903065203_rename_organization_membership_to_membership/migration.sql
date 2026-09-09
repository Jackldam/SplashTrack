-- Rename `OrganizationMembership` to `Membership` (D-056: there is only one
-- organisation to be a member of, so the name no longer says which).
--
-- HAND-WRITTEN. `prisma migrate diff` renders a model rename as DROP TABLE +
-- CREATE TABLE, which destroys every row. A rename is a rename: the table, its
-- primary key, its unique index, its plain index and both foreign keys are
-- renamed in place, so this migration is safe on a populated database and the
-- resulting names are exactly the ones Prisma would generate for the new model.
ALTER TABLE "OrganizationMembership" RENAME TO "Membership";

ALTER INDEX "OrganizationMembership_pkey" RENAME TO "Membership_pkey";
ALTER INDEX "OrganizationMembership_personId_key" RENAME TO "Membership_personId_key";
ALTER INDEX "OrganizationMembership_unitId_idx" RENAME TO "Membership_unitId_idx";

ALTER TABLE "Membership" RENAME CONSTRAINT "OrganizationMembership_personId_fkey" TO "Membership_personId_fkey";
ALTER TABLE "Membership" RENAME CONSTRAINT "OrganizationMembership_unitId_fkey" TO "Membership_unitId_fkey";
