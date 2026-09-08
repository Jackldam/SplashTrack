-- ---------------------------------------------------------------------------
-- Phase 2.1 follow-up — `SkillProgress.groupId`, the read-side narrowing the
-- phase 2.1 report (§1.5) left as an open question. Jack's decision: a
-- `GROUP`-scoped instructor's `skills.read` must return only the rows tied to
-- a group they hold (D-145 rule 2), not a pupil's entire history.
--
-- ENCRYPTED-COLUMN-IMPACT: none — `groupId` is an id, like every other
-- foreign key on this table, and is not in `ENCRYPTED_COLUMNS`.
--
-- WHY A COLUMN AND NOT `sessionId` ROUTING: the report's §1.5 rejected
-- narrowing through `sessionId` because `sessions`' `sessionFilterForReach`
-- denies every `COURSE`-scoped reach outright, which would make a
-- `COURSE`-scoped aftest assessor — whose entire reason to read this log is
-- deciding whether a child sits an exam — see NOTHING. `groupId` is a plain
-- write-time snapshot instead: it narrows the one case Jack asked for
-- (`GROUP`) and touches no other reach's visibility.
--
-- NULLABLE, NO BACKFILL — the schema's usual shape for a column added after
-- rows already exist. A row written before this migration, or written from a
-- path with no group context (a correction, a bulk import), keeps `groupId
-- NULL`. Such a row is NOT narrowed INTO a `GROUP`-scoped reach — narrower is
-- the safe direction when a row cannot be attributed, the same call the
-- report already made for the column that does not exist. See
-- `skill-progress-reach-filter.ts`.
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "SkillProgress" ADD COLUMN     "groupId" TEXT;

-- CreateIndex
CREATE INDEX "SkillProgress_groupId_idx" ON "SkillProgress"("groupId");

-- AddForeignKey
ALTER TABLE "SkillProgress" ADD CONSTRAINT "SkillProgress_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
