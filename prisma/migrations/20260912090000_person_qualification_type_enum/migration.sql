-- `PersonQualification.type` was a free string with no closed vocabulary
-- named anywhere in the design set (flagged in the phase 2.4 report). Jack
-- decided this becomes an enum; the two values are the minimum the decision
-- register's own vocabulary already commits to (D-052's external examiner,
-- D-068/D-085's independent aftest assessor) — see the model comment on
-- `PersonQualification` in `prisma/schema.prisma`.
--
-- The `USING` cast below FAILS LOUDLY on any existing row whose `type` is
-- not one of the two new values, rather than the naive `DROP COLUMN` +
-- `ADD COLUMN` a plain `prisma migrate diff` renders here (which would
-- silently discard every row's type on a non-empty table) — the same
-- "refuse rather than corrupt data" reasoning `detectBootState` applies
-- elsewhere in this codebase.

-- CreateEnum
CREATE TYPE "PersonQualificationType" AS ENUM ('INDEPENDENT_ASSESSOR', 'EXTERNAL_EXAMINER');

-- AlterTable
ALTER TABLE "PersonQualification"
  ALTER COLUMN "type" TYPE "PersonQualificationType"
  USING ("type"::"PersonQualificationType");
