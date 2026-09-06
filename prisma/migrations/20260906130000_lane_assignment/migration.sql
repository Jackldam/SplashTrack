-- ---------------------------------------------------------------------------
-- Phase 1.8 — lane assignment: inherit from the season, override one lesson
-- (D-190).
--
-- `SessionLane` has been in the schema since phase 1.6 and NOTHING IN THE
-- APPLICATION EVER WROTE IT. A club could say which pool a group swims in and
-- not which lanes, which is the half of the answer that matters when two groups
-- share the water.
--
-- The shape comes from the domain expert rather than from a guess:
--
--   *"Vaak ligt het het seizoen vast, een enkele keer wisselt het."*
--   (Jack, swim instructor at the club, 2026-09-06)
--
-- So lanes are an attribute of the RULE — `RecurrenceLane` — inherited by every
-- lesson it generates, and one lesson may carry its own set when the water
-- shifts for a week. `ScheduledSession.laneSource` is what makes the two
-- distinguishable, and NULL — inherit — is the default for every existing row.
--
-- ENCRYPTED-COLUMN-IMPACT: none
--   Nothing here is in `ENCRYPTED_COLUMNS`, and nothing here is free text at
--   all: this migration adds one join table of two foreign keys and one
--   nullable enum column. There is nowhere in it for a pastoral remark to land.
--
-- NO BACKFILL, AND NONE IS POSSIBLE. Every `ScheduledSession` that exists today
-- was generated before lanes could be assigned, so every one of them inherits
-- an empty set — which is exactly what `laneSource IS NULL` says, and is why the
-- column is added nullable with no default rather than defaulted to a value
-- that would claim somebody had chosen something.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "SessionLaneSource" AS ENUM ('OVERRIDE', 'PINNED');

-- AlterTable
-- Nullable and NOT NULL-with-a-default: see `tests/unit/migration-safety.test.ts`
-- for why the second shape is the one that strands a populated database. NULL
-- is meaningful here rather than merely permitted — it is "this lesson follows
-- its recurrence".
ALTER TABLE "ScheduledSession" ADD COLUMN "laneSource" "SessionLaneSource";

-- CreateTable
CREATE TABLE "RecurrenceLane" (
    "recurrenceId" TEXT NOT NULL,
    "laneId" TEXT NOT NULL,

    CONSTRAINT "RecurrenceLane_pkey" PRIMARY KEY ("recurrenceId","laneId")
);

-- CreateIndex
CREATE INDEX "RecurrenceLane_laneId_idx" ON "RecurrenceLane"("laneId");

-- AddForeignKey
-- CASCADE from the recurrence, RESTRICT from the lane — the same asymmetry
-- `SessionLane` carries, and for the same reason. The rule OWNS its lane
-- selection, so the selection goes when the rule does; a lane does not own the
-- rules that point at it, and deleting a lane that lessons are planned in must
-- fail loudly rather than quietly empty a season's timetable.
ALTER TABLE "RecurrenceLane" ADD CONSTRAINT "RecurrenceLane_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "SessionRecurrence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurrenceLane" ADD CONSTRAINT "RecurrenceLane_laneId_fkey" FOREIGN KEY ("laneId") REFERENCES "Lane"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- THE ONE INVARIANT THIS MIGRATION DOES NOT ENFORCE, AND WHY
--
-- `laneSource IS NULL` means "ask the recurrence", so a `SessionLane` row
-- beside an inheriting lesson is a second and contradictory answer to the same
-- question. The pairing — marker set if and only if rows exist, marker cleared
-- in the same transaction that deletes them — is held by
-- `lane-assignment-service.ts` and pinned by
-- `tests/integration/lane-assignment.test.ts`, NOT by the database.
--
-- It spans two tables, so a CHECK cannot state it; the shape that could is a
-- pair of triggers. This schema contains no triggers and no functions at all,
-- and `applyRoleModel` (ADR-0002 / D-182) reassigns ownership of TABLES and
-- SEQUENCES only — so a plpgsql function added here would be the first database
-- object with no home in the role model. That is a decision about the schema's
-- mechanisms rather than an implementation detail of lane assignment, and
-- `docs/build/phase-1.8-lane-assignment-report.md` §6 states it as a deferral
-- with the two lines of work it needs, instead of smuggling it in here.
-- ---------------------------------------------------------------------------
