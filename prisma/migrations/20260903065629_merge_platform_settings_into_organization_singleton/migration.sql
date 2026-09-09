-- Merge `PlatformSettings` into `Organization`, drop the tenant-only columns,
-- and make the organisation a singleton the DATABASE enforces (D-056, D-027).
--
-- HAND-WRITTEN, for two reasons `prisma migrate diff` cannot cover:
--   1. Its generated script DROPs `PlatformSettings` without carrying the
--      configuration across. A merge that discards the thing being merged is a
--      data-loss migration wearing a refactor's name.
--   2. The Prisma DSL cannot express a CHECK constraint, so the singleton
--      enforcement has to be written here or it does not exist at all.

-- 1. The new columns. Both NULLABLE, so this is safe on a populated database
--    (tests/unit/migration-safety.test.ts).
ALTER TABLE "Organization" ADD COLUMN "config" JSONB;
ALTER TABLE "Organization" ADD COLUMN "updatedByPersonId" TEXT;
ALTER TABLE "Organization" ALTER COLUMN "id" SET DEFAULT 'organization';
ALTER TABLE "Organization" ALTER COLUMN "name" SET DEFAULT 'SplashTrack';

-- 2. Collapse whatever is there to exactly one row, keyed by the constant, so
--    the CHECK in step 4 cannot fail on inherited data. Nothing references
--    "Organization" any more: every organizationId foreign key was dropped in
--    the previous migration, so renumbering and deleting are safe here and
--    would not have been one commit earlier.
DELETE FROM "Organization"
WHERE "id" <> (SELECT "id" FROM "Organization" ORDER BY "createdAt", "id" LIMIT 1);

UPDATE "Organization" SET "id" = 'organization';

-- 3. Carry the settings singleton across: its config document, its last editor,
--    and its display name, which becomes the organisation's name (one
--    organisation, one name). COALESCE keeps an already-set organisation name
--    rather than overwriting it with the settings default.
INSERT INTO "Organization" ("id", "name", "config", "updatedByPersonId", "createdAt", "updatedAt")
SELECT 'organization', ps."displayName", ps."platformConfig", ps."updatedByPersonId", ps."createdAt", ps."updatedAt"
FROM "PlatformSettings" ps
ORDER BY ps."createdAt", ps."id"
LIMIT 1
ON CONFLICT ("id") DO UPDATE SET
  "name" = COALESCE(NULLIF("Organization"."name", ''), EXCLUDED."name"),
  "config" = EXCLUDED."config",
  "updatedByPersonId" = EXCLUDED."updatedByPersonId",
  "updatedAt" = EXCLUDED."updatedAt";

-- 4. THE SINGLETON, ENFORCED. With the primary key on "id", pinning "id" to one
--    value means the table can hold at most one row — a second INSERT fails on
--    the CHECK if it uses another id and on the primary key if it reuses this
--    one. Proven in both directions by
--    tests/integration/organization-singleton.test.ts.
--
--    DO NOT DROP THIS when regenerating migrations: it is invisible in
--    schema.prisma (the DSL has no CHECK), and it is what removing the tenant
--    boundary rests on.
ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_singleton_check" CHECK ("id" = 'organization');

-- 5. The tenant-only columns. `slug` was subdomain tenant resolution (D-015,
--    withdrawn); `status` suspended or archived a tenant, which needs a control
--    plane and a principal above the organisation, and there is neither.
DROP INDEX "Organization_slug_key";
ALTER TABLE "Organization" DROP COLUMN "slug";
ALTER TABLE "Organization" DROP COLUMN "status";
DROP TYPE "OrganizationStatus";

-- 6. The merged-away table.
ALTER TABLE "PlatformSettings" DROP CONSTRAINT "PlatformSettings_updatedByPersonId_fkey";
DROP TABLE "PlatformSettings";

-- 7. The last-editor pointer, re-homed onto the organisation with the same
--    SetNull defence in depth it had on the settings singleton.
CREATE INDEX "Organization_updatedByPersonId_idx" ON "Organization"("updatedByPersonId");
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_updatedByPersonId_fkey"
  FOREIGN KEY ("updatedByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
