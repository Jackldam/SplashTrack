-- ---------------------------------------------------------------------------
-- Phase 2.2 — the `attendance` module: `AttendanceEvent`, the append-only
-- register of who showed up (`01-domain-model.md` §3.4; D-005, D-061).
--
-- A NEW TABLE ONLY. `ScheduledSession` stays exactly as `sessions` owns it
-- (D-057: `attendance` writes rows AGAINST sessions, never a second owner),
-- and the derived `AttendanceStatus` §3.4 sketches is not a table at all —
-- "materialised only if measurement demands it", and nothing has measured.
--
-- THE APPEND-ONLY PROPERTY IS NOT IN THIS FILE. Migrations run as the schema
-- owner, and privileges are applied AFTER every migration by
-- `db:apply-grants` (`attendanceGrantStatements` in
-- `src/lib/database/role-model.ts`, documented in
-- `infra/attendance-database-role.sql`): the runtime role gets
-- `SELECT, INSERT` on this table and nothing else, the retention role gets
-- the only `DELETE` (D-111's hard delete at 24 months). Proved in
-- `tests/integration/attendance-append-only.test.ts` — the file that used to
-- prove the gap now proves the control.
--
-- ENCRYPTED-COLUMN-IMPACT: none — no column of this table is in
-- `ENCRYPTED_COLUMNS`; ids, an enum, timestamps and a short note.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "AttendanceState" AS ENUM ('PRESENT', 'ABSENT', 'EXCUSED', 'LATE');

-- CreateTable
CREATE TABLE "AttendanceEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "state" "AttendanceState" NOT NULL,
    "recordedByPersonId" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "clientEventId" TEXT NOT NULL,
    "supersedesEventId" TEXT,
    "groupId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — P-02's idempotency key: a retry, a double-tap or a replayed
-- offline queue all collapse to the same event.
CREATE UNIQUE INDEX "AttendanceEvent_clientEventId_key" ON "AttendanceEvent"("clientEventId");

-- CreateIndex — D-061's own words: "a (sessionId, studentProfileId,
-- recordedAt) index answers the derivation directly."
CREATE INDEX "AttendanceEvent_sessionId_studentProfileId_recordedAt_idx" ON "AttendanceEvent"("sessionId", "studentProfileId", "recordedAt");

-- CreateIndex
CREATE INDEX "AttendanceEvent_studentProfileId_recordedAt_idx" ON "AttendanceEvent"("studentProfileId", "recordedAt");

-- CreateIndex
CREATE INDEX "AttendanceEvent_groupId_idx" ON "AttendanceEvent"("groupId");

-- CreateIndex
CREATE INDEX "AttendanceEvent_recordedByPersonId_idx" ON "AttendanceEvent"("recordedByPersonId");

-- CreateIndex
CREATE INDEX "AttendanceEvent_supersedesEventId_idx" ON "AttendanceEvent"("supersedesEventId");

-- AddForeignKey
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ScheduledSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_recordedByPersonId_fkey" FOREIGN KEY ("recordedByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey — NO ACTION (not RESTRICT) so D-111's retention prune can
-- take a superseded event and its correction in ONE statement; the pair
-- always shares a session, so a per-session prune never strands either half.
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_supersedesEventId_fkey" FOREIGN KEY ("supersedesEventId") REFERENCES "AttendanceEvent"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- The constraint the Prisma DSL cannot express — the
-- `skills-constraints.test.ts` pattern, one migration later; named in
-- `tests/integration/attendance-constraints.test.ts`.
-- ---------------------------------------------------------------------------

-- D-061: a correction points at the event it replaces — pointing at ITSELF
-- would make a row that supersedes its own evidence, which no derivation can
-- read coherently. The service never writes one; this is the backstop against
-- a path nobody has written yet. (That the superseded event belongs to the
-- SAME session and pupil is a cross-row rule a CHECK cannot state — the
-- service enforces it and the integration suite pins it.)
ALTER TABLE "AttendanceEvent"
  ADD CONSTRAINT "AttendanceEvent_no_self_supersede_check"
  CHECK ("supersedesEventId" IS NULL OR "supersedesEventId" <> "id");
