-- Student identityKey migration/backfill plan for shared environments
-- Phase 1 artifact only: this file documents the intended rollout and review queries.
-- Do not run blindly in production without validating column/index names against the generated Prisma migration.

-- 1. Preview the normalized identity key that current app code expects.
WITH normalized_students AS (
  SELECT
    id,
    organization_id,
    lower(regexp_replace(trim(first_name), '\s+', ' ', 'g')) AS normalized_first_name,
    lower(regexp_replace(trim(last_name), '\s+', ' ', 'g')) AS normalized_last_name,
    CASE
      WHEN date_of_birth IS NULL THEN 'unknown-dob'
      ELSE to_char(date_of_birth AT TIME ZONE 'UTC', 'YYYY-MM-DD')
    END AS normalized_dob_key
  FROM "Student"
)
SELECT
  id,
  organization_id,
  normalized_first_name || '::' || normalized_last_name || '::' || normalized_dob_key AS preview_identity_key
FROM normalized_students;

-- 2. Detect collisions that would block a safe unique constraint rollout.
WITH normalized_students AS (
  SELECT
    id,
    organization_id,
    lower(regexp_replace(trim(first_name), '\s+', ' ', 'g')) || '::' ||
    lower(regexp_replace(trim(last_name), '\s+', ' ', 'g')) || '::' ||
    CASE
      WHEN date_of_birth IS NULL THEN 'unknown-dob'
      ELSE to_char(date_of_birth AT TIME ZONE 'UTC', 'YYYY-MM-DD')
    END AS preview_identity_key
  FROM "Student"
)
SELECT
  organization_id,
  preview_identity_key,
  count(*) AS duplicate_count,
  array_agg(id ORDER BY id) AS conflicting_student_ids
FROM normalized_students
GROUP BY organization_id, preview_identity_key
HAVING count(*) > 1;

-- 3. After collision cleanup, backfill identityKey.
-- UPDATE "Student"
-- SET "identityKey" = lower(regexp_replace(trim("firstName"), '\s+', ' ', 'g')) || '::' ||
--                     lower(regexp_replace(trim("lastName"), '\s+', ' ', 'g')) || '::' ||
--                     CASE
--                       WHEN "dateOfBirth" IS NULL THEN 'unknown-dob'
--                       ELSE to_char("dateOfBirth" AT TIME ZONE 'UTC', 'YYYY-MM-DD')
--                     END
-- WHERE "identityKey" IS NULL OR "identityKey" = '';

-- 4. Validate no collisions remain, then apply the Prisma-managed unique constraint/index rollout.
