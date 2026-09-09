-- ---------------------------------------------------------------------------
-- `Criterion.standard` — "normering" (`docs/glossary.md`): what is expected
-- of the pupil and how the execution must be judged, as opposed to `name`,
-- the one line read aloud at the poolside. Jack asked for it directly: an
-- instructor — including a substitute who does not know the set by heart —
-- needs somewhere to look up what a criterion actually means.
--
-- ENCRYPTED-COLUMN-IMPACT: none. Describes the criterion catalogue, not a
-- person; not in `ENCRYPTED_COLUMNS`, on the same reasoning as
-- `Course.description` (`20260907070000_courses_module`).
--
-- NULLABLE, NO BACKFILL — the schema's usual shape for a column added after
-- rows already exist. Every existing criterion keeps `standard NULL`; nothing
-- requires one to be filled in before it can be used.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "Criterion" ADD COLUMN     "standard" TEXT;
