-- ---------------------------------------------------------------------------
-- Phase 1.6 — the `groups` and `sessions` modules (D-057, D-059, D-108, D-145,
-- D-175, D-179, D-180).
--
-- The two modules that turn this into something a swim school recognises: a
-- teaching group with people in it, and a timetable of lessons those people
-- turn up to.
--
-- ENCRYPTED-COLUMN-IMPACT: none
--   Nothing here is in `ENCRYPTED_COLUMNS`. Every free-text column added by this
--   migration — `GroupMove.reason`, `InstructorAssignment.role`,
--   `ScheduleException.reason`, `ScheduledSession.cancellationReason`,
--   `SessionRosterEntry.reason` — is administrative rather than pastoral, on the
--   same judgement `StudentLifecycleEvent.reason` records: D-148's protected
--   class is medical remarks, pastoral notes, assessment remarks and inquiry
--   text, and *"meer tijd nodig voor de schoolslagbeenslag"* or
--   *"kerstvakantie"* is not in it. The risk that somebody types a medical fact
--   into one is answered where the design answers it — a length bound, a purpose
--   line at the capture point, and `students.notes.*` for anything that is
--   actually a note about the child.
--
-- TWO TABLES IN HERE ARE NOT IN THE DESIGN SET, and they are half the reason
-- this phase exists: `SessionRecurrence` and `ScheduleException`. NOTHING in any
-- chapter creates a `ScheduledSession`. Six groups across roughly thirty-six
-- teaching weeks is about two hundred rows nobody will type, and the flagship
-- attendance screen is unreachable without them. Recorded as an addition in
-- `docs/build/phase-1.6-groups-and-sessions-report.md`.
--
-- There is NO `Location` table, against §3.2 and §3.4's `locationId`. D-175 is
-- the later and explicit decision — `Pool` and `Lane` are facilities owned by
-- `sessions`, never units and never scopes — and `docs/glossary.md` is where
-- D-159/D-189 put the tie-break. A session names a pool; its organisational
-- position comes from its group's `unitId` (§3.6).
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "GroupMoveDirection" AS ENUM ('UP', 'DOWN', 'LATERAL');

-- CreateEnum
CREATE TYPE "ScheduledSessionStatus" AS ENUM ('SCHEDULED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SessionRosterSource" AS ENUM ('GROUP', 'GUEST');

-- AlterEnum
-- Two new retention data classes (D-065, D-110). Adding a member is adding a
-- POLICY, and the rows that carry them are seeded by `RETENTION_CATALOGUE`,
-- never by this migration: a shipped default is a PROPOSAL the organisation
-- confirms (F-27), not a fact a migration asserts. Both ship with
-- `proposedLawfulBasis: UNRESOLVED`, which is D-110's own marker for a basis
-- that has not been settled — see the enum members in `prisma/schema.prisma`
-- for why neither could be folded into an existing class.
--
-- Prisma's generator warns that PostgreSQL 11 and earlier cannot add two enum
-- values in one migration. The supported floor here is 16 (`docker-compose.yml`),
-- and nothing in this migration USES either value, so there is no
-- same-transaction read of a value added in it.
ALTER TYPE "DataClass" ADD VALUE 'INSTRUCTOR_ASSIGNMENTS';
ALTER TYPE "DataClass" ADD VALUE 'SCHEDULED_SESSIONS';

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "unitId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMembership" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMove" (
    "id" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "fromGroupId" TEXT,
    "toGroupId" TEXT NOT NULL,
    "direction" "GroupMoveDirection" NOT NULL,
    "reason" TEXT NOT NULL,
    "decidedByPersonId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupMove_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstructorAssignment" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "role" TEXT,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstructorAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pool" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lengthMetres" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lane" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lane_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionRecurrence" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "poolId" TEXT,
    "weekday" INTEGER NOT NULL,
    "startMinuteOfDay" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionRecurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleException" (
    "id" TEXT NOT NULL,
    "groupId" TEXT,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledSession" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "poolId" TEXT,
    "recurrenceId" TEXT,
    "occursOn" DATE NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "ScheduledSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionLane" (
    "sessionId" TEXT NOT NULL,
    "laneId" TEXT NOT NULL,

    CONSTRAINT "SessionLane_pkey" PRIMARY KEY ("sessionId","laneId")
);

-- CreateTable
CREATE TABLE "SessionRosterEntry" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "source" "SessionRosterSource" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionRosterEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Group_unitId_idx" ON "Group"("unitId");

-- CreateIndex
CREATE INDEX "Group_active_idx" ON "Group"("active");

-- CreateIndex
CREATE INDEX "GroupMembership_groupId_idx" ON "GroupMembership"("groupId");

-- CreateIndex
CREATE INDEX "GroupMembership_studentProfileId_idx" ON "GroupMembership"("studentProfileId");

-- CreateIndex
CREATE INDEX "GroupMembership_groupId_studentProfileId_toDate_idx" ON "GroupMembership"("groupId", "studentProfileId", "toDate");

-- CreateIndex
CREATE INDEX "GroupMembership_studentProfileId_toDate_idx" ON "GroupMembership"("studentProfileId", "toDate");

-- CreateIndex
CREATE INDEX "GroupMove_studentProfileId_occurredAt_idx" ON "GroupMove"("studentProfileId", "occurredAt");

-- CreateIndex
CREATE INDEX "GroupMove_toGroupId_idx" ON "GroupMove"("toGroupId");

-- CreateIndex
CREATE INDEX "GroupMove_fromGroupId_idx" ON "GroupMove"("fromGroupId");

-- CreateIndex
CREATE INDEX "GroupMove_decidedByPersonId_idx" ON "GroupMove"("decidedByPersonId");

-- CreateIndex
CREATE INDEX "InstructorAssignment_groupId_idx" ON "InstructorAssignment"("groupId");

-- CreateIndex
CREATE INDEX "InstructorAssignment_personId_toDate_idx" ON "InstructorAssignment"("personId", "toDate");

-- CreateIndex
CREATE INDEX "InstructorAssignment_groupId_toDate_idx" ON "InstructorAssignment"("groupId", "toDate");

-- CreateIndex
CREATE UNIQUE INDEX "Pool_name_key" ON "Pool"("name");

-- CreateIndex
CREATE INDEX "Lane_poolId_sequence_idx" ON "Lane"("poolId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Lane_poolId_name_key" ON "Lane"("poolId", "name");

-- CreateIndex
CREATE INDEX "SessionRecurrence_groupId_active_idx" ON "SessionRecurrence"("groupId", "active");

-- CreateIndex
CREATE INDEX "SessionRecurrence_poolId_idx" ON "SessionRecurrence"("poolId");

-- CreateIndex
CREATE INDEX "ScheduleException_groupId_idx" ON "ScheduleException"("groupId");

-- CreateIndex
CREATE INDEX "ScheduleException_fromDate_toDate_idx" ON "ScheduleException"("fromDate", "toDate");

-- CreateIndex
CREATE INDEX "ScheduledSession_groupId_startsAt_idx" ON "ScheduledSession"("groupId", "startsAt");

-- CreateIndex
CREATE INDEX "ScheduledSession_startsAt_idx" ON "ScheduledSession"("startsAt");

-- CreateIndex
CREATE INDEX "ScheduledSession_poolId_startsAt_idx" ON "ScheduledSession"("poolId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledSession_recurrenceId_occursOn_key" ON "ScheduledSession"("recurrenceId", "occursOn");

-- CreateIndex
CREATE INDEX "SessionLane_laneId_idx" ON "SessionLane"("laneId");

-- CreateIndex
CREATE INDEX "SessionRosterEntry_studentProfileId_idx" ON "SessionRosterEntry"("studentProfileId");

-- CreateIndex
CREATE INDEX "SessionRosterEntry_sessionId_studentProfileId_idx" ON "SessionRosterEntry"("sessionId", "studentProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionRosterEntry_sessionId_studentProfileId_key" ON "SessionRosterEntry"("sessionId", "studentProfileId");

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "OrganizationUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMembership" ADD CONSTRAINT "GroupMembership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMembership" ADD CONSTRAINT "GroupMembership_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMove" ADD CONSTRAINT "GroupMove_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMove" ADD CONSTRAINT "GroupMove_fromGroupId_fkey" FOREIGN KEY ("fromGroupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMove" ADD CONSTRAINT "GroupMove_toGroupId_fkey" FOREIGN KEY ("toGroupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMove" ADD CONSTRAINT "GroupMove_decidedByPersonId_fkey" FOREIGN KEY ("decidedByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorAssignment" ADD CONSTRAINT "InstructorAssignment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorAssignment" ADD CONSTRAINT "InstructorAssignment_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lane" ADD CONSTRAINT "Lane_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRecurrence" ADD CONSTRAINT "SessionRecurrence_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRecurrence" ADD CONSTRAINT "SessionRecurrence_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleException" ADD CONSTRAINT "ScheduleException_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledSession" ADD CONSTRAINT "ScheduledSession_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledSession" ADD CONSTRAINT "ScheduledSession_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledSession" ADD CONSTRAINT "ScheduledSession_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "SessionRecurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionLane" ADD CONSTRAINT "SessionLane_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ScheduledSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionLane" ADD CONSTRAINT "SessionLane_laneId_fkey" FOREIGN KEY ("laneId") REFERENCES "Lane"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRosterEntry" ADD CONSTRAINT "SessionRosterEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ScheduledSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionRosterEntry" ADD CONSTRAINT "SessionRosterEntry_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- The constraints the Prisma DSL cannot express. Invisible in schema.prisma and
-- easy to lose in a future "regenerate the migrations" tidy-up, which is why
-- `tests/integration/groups-and-sessions-constraints.test.ts` names each one.
-- ---------------------------------------------------------------------------

-- D-059's intervals, applied to groups. A placement that ends before it starts
-- is a data-entry accident that reads as a silently dead membership — and, in
-- this table, as an instructor silently losing sight of a child (D-145 rule 1
-- reads `toDate`).
ALTER TABLE "GroupMembership"
  ADD CONSTRAINT "GroupMembership_window_order_check"
  CHECK ("toDate" IS NULL OR "toDate" > "fromDate");

-- AT MOST ONE OPEN PLACEMENT PER PUPIL PER GROUP. "Is this child in this group
-- right now" is derived from whether an open row exists, so two open rows make
-- that question one with two answers — the failure a status flag has.
--
-- It is scoped to the GROUP and not to the pupil, deliberately: a child in a
-- lesson group and a club-swimming group has two open placements and that is
-- ordinary. Overlapping CLOSED rows stay legal, because a club back-filling its
-- paper history produces them and refusing legitimate history to enforce
-- tidiness is how a status flag gets reinvented.
CREATE UNIQUE INDEX "GroupMembership_single_open_placement_key"
  ON "GroupMembership" ("groupId", "studentProfileId")
  WHERE "toDate" IS NULL;

-- D-108: the reason IS the record. *"A required reason on an action
-- administrators would rather do in two clicks. Accepted: the reason is the
-- entire value of the record."* NOT NULL alone would accept a space, and a move
-- down with a blank reason is exactly the row that reads as an administrative
-- error to the parent looking at it.
ALTER TABLE "GroupMove"
  ADD CONSTRAINT "GroupMove_reason_required_check"
  CHECK (length(btrim("reason")) > 0);

-- A move from a group to itself is not a move. It would render in a child's
-- history as an event with no content, and — worse — as a DOWN or UP that says
-- something happened when nothing did.
ALTER TABLE "GroupMove"
  ADD CONSTRAINT "GroupMove_distinct_groups_check"
  CHECK ("fromGroupId" IS NULL OR "fromGroupId" <> "toGroupId");

-- The same interval rule for the teaching side.
ALTER TABLE "InstructorAssignment"
  ADD CONSTRAINT "InstructorAssignment_window_order_check"
  CHECK ("toDate" IS NULL OR "toDate" > "fromDate");

-- AT MOST ONE OPEN ASSIGNMENT PER INSTRUCTOR PER GROUP, on the partial-unique
-- shape `RoleAssignment_standing_grant_key` established. Two open rows for the
-- same pair is noise that makes "when did they stop teaching this group?" — the
-- question D-145 rule 1 turns into an access decision — ambiguous.
CREATE UNIQUE INDEX "InstructorAssignment_single_open_assignment_key"
  ON "InstructorAssignment" ("personId", "groupId")
  WHERE "toDate" IS NULL;

-- A capacity of zero or less is not a capacity; D-180's placement screen would
-- report the group as permanently full for a value nobody meant to type. NULL
-- stays legal and means "nobody has stated one".
ALTER TABLE "Group"
  ADD CONSTRAINT "Group_capacity_positive_check"
  CHECK ("capacity" IS NULL OR "capacity" > 0);

ALTER TABLE "Pool"
  ADD CONSTRAINT "Pool_length_positive_check"
  CHECK ("lengthMetres" IS NULL OR "lengthMetres" > 0);

-- THE GENERATOR'S OWN INPUTS, held at the database. Every one of these produces
-- ZERO SESSIONS rather than an error if it is wrong, which would present as a
-- broken generator instead of as bad data — the failure mode worth spending
-- four CHECK constraints on.
ALTER TABLE "SessionRecurrence"
  ADD CONSTRAINT "SessionRecurrence_weekday_range_check"
  CHECK ("weekday" BETWEEN 1 AND 7);

ALTER TABLE "SessionRecurrence"
  ADD CONSTRAINT "SessionRecurrence_start_minute_range_check"
  CHECK ("startMinuteOfDay" >= 0 AND "startMinuteOfDay" < 1440);

ALTER TABLE "SessionRecurrence"
  ADD CONSTRAINT "SessionRecurrence_duration_range_check"
  CHECK ("durationMinutes" > 0 AND "durationMinutes" <= 1440);

-- `>=` and not `>`: a recurrence that runs for one day is a legitimate one-off
-- somebody entered as a rule, and refusing it would send them to the hand-
-- scheduling path for no reason.
ALTER TABLE "SessionRecurrence"
  ADD CONSTRAINT "SessionRecurrence_window_order_check"
  CHECK ("endsOn" IS NULL OR "endsOn" >= "startsOn");

-- A closure is INCLUSIVE on both ends, so a single day has fromDate = toDate.
ALTER TABLE "ScheduleException"
  ADD CONSTRAINT "ScheduleException_window_order_check"
  CHECK ("toDate" >= "fromDate");

-- An unexplained hole in a timetable is a support question.
ALTER TABLE "ScheduleException"
  ADD CONSTRAINT "ScheduleException_reason_required_check"
  CHECK (length(btrim("reason")) > 0);

ALTER TABLE "ScheduledSession"
  ADD CONSTRAINT "ScheduledSession_window_order_check"
  CHECK ("endsAt" > "startsAt");

-- CANCELLATION IS ALL-OR-NOTHING, both ways. A session marked CANCELLED with no
-- reason is the row a parent asks about and nobody can answer; a session
-- carrying a cancellation reason while still SCHEDULED is a lesson that reads as
-- both on and off. The equality — rather than two one-way implications — is what
-- makes UNCANCELLING have to clear the fields rather than leave a stale reason
-- behind. Same shape as `RetentionPolicy_confirmation_shape_check`: half a
-- cancellation is not a cancellation.
ALTER TABLE "ScheduledSession"
  ADD CONSTRAINT "ScheduledSession_cancellation_shape_check"
  CHECK (
    ("status" = 'CANCELLED')
    = ("cancelledAt" IS NOT NULL
       AND "cancellationReason" IS NOT NULL
       AND length(btrim("cancellationReason")) > 0)
  );
