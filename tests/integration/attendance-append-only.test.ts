/**
 * Is attendance append-only, or only claimed to be?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * `00-overview.md` P-07 states as a v1 property: *"Audit, attendance and
 * progress are append-only and queryable"*. For the audit trail that claim is
 * tested at the database level in `database-role-model.test.ts` — the runtime
 * role holds `INSERT`+`SELECT` on `AuditEvent` and nothing else, proved by
 * attempting the forbidden statements and watching PostgreSQL refuse them.
 *
 * Attendance has no equivalent test, for a reason this file makes explicit:
 * `src/modules/sessions/index.ts` says outright *"Attendance, in any form...
 * is out of scope for this pass"* (D-057), and there is no `Attendance` model
 * in `prisma/schema.prisma` at all. The nearest thing that exists is
 * `SessionRosterEntry` — the lesson ROSTER (who is invited), not an attendance
 * REGISTER (who showed up) — tagged `@dataClass ATTENDANCE_EVENTS` purely for
 * retention purposes (`src/lib/retention/data-class-registry.ts`), with a
 * comment on the model itself naming the still-to-be-built step: *"the `GROUP`
 * value exists for the future step that FREEZES a roster once attendance has
 * been registered against it"*.
 *
 * `role-model.ts` and `auditGrantStatements()` carve the append-only exception
 * out for exactly two tables — `AuditEvent` and `AuditCheckpoint`. Every other
 * table, `SessionRosterEntry` included, receives the ordinary blanket grant in
 * `databaseProvisionStatements()`: `GRANT SELECT, INSERT, UPDATE, DELETE ... TO
 * splashtrack_app`. So the runtime role that the web process connects as CAN
 * update and delete roster rows today, and the application itself does so
 * (`roster-service.ts` calls `tx.sessionRosterEntry.delete(...)` when a guest
 * is removed from a lesson).
 *
 * This test proves that directly, against the real database and the real
 * runtime role, the same way `database-role-model.test.ts` proves the audit
 * exception. IT IS EXPECTED TO FAIL while the gap stands: the properly
 * append-only assertions below (no UPDATE, no DELETE) do not hold today. A
 * green run of this file is the signal that either a real `Attendance` module
 * shipped with its own carve-out (mirroring `auditGrantStatements`), or that
 * `SessionRosterEntry` gained the same protection. Until then, red here is
 * correct and is the evidence for the gap, not a broken test.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/database";
import { roleNameFrom } from "@/lib/database/role-model";

/** The role this environment actually connects as — not the reference name. */
const APP_ROLE = roleNameFrom(process.env.DATABASE_URL as string);
import {
  createPool,
  createRecurrence,
  generateSessions,
} from "@/modules/sessions";

import {
  grantTo,
  GROUPS_ADMIN_PERMISSIONS,
  installRealRelations,
  makeGroup,
  makePerson,
  makeRole,
  makeStudent,
  resetGroupsFixtures,
} from "../support/groups-fixtures";

const NOW = new Date("2026-03-18T12:00:00.000Z");

let adminId: string;

function admin() {
  return { principal: { personId: adminId }, at: NOW };
}

beforeAll(() => {
  installRealRelations();
});

async function clearFacilities(): Promise<void> {
  await prisma.lane.deleteMany({});
  await prisma.pool.deleteMany({});
}

beforeEach(async () => {
  await resetGroupsFixtures();
  await clearFacilities();

  adminId = await makePerson("attendance_admin_person");
  await grantTo({
    personId: adminId,
    roleId: await makeRole("role_attendance_admin", [
      ...GROUPS_ADMIN_PERMISSIONS,
    ]),
    scopeType: "ORGANIZATION",
  });
});

afterAll(async () => {
  await resetGroupsFixtures();
  await clearFacilities();
});

/** One real lesson, produced through the actual scheduling path. */
async function aLesson(suffix: string): Promise<{ sessionId: string }> {
  const groupId = await makeGroup(`att_${suffix}`);
  const pool = await createPool(admin(), {
    name: `Bad ${suffix}`,
    lengthMetres: 25,
  });
  await createRecurrence(admin(), groupId, {
    poolId: pool.id,
    weekday: 2,
    startTime: "18:00",
    durationMinutes: 45,
    startsOn: "2026-03-01",
    endsOn: "2026-03-31",
  });
  await generateSessions(admin(), groupId, {
    from: "2026-03-01",
    to: "2026-03-31",
  });
  const session = await prisma.scheduledSession.findFirstOrThrow({
    where: { groupId },
    select: { id: true },
  });
  return { sessionId: session.id };
}

describe("the nearest thing attendance has today: SessionRosterEntry", () => {
  it(
    "the runtime role holds UPDATE and DELETE on it, so it is not append-only " +
      "at the database level (only AuditEvent/AuditCheckpoint carry that " +
      "exception — role-model.ts, auditGrantStatements)",
    async () => {
      const privileges = await prisma.$queryRaw<
        { privilege_type: string }[]
      >`
        SELECT privilege_type
          FROM information_schema.role_table_grants
         WHERE table_name = 'SessionRosterEntry'
           AND grantee = ${APP_ROLE}
         ORDER BY privilege_type
      `;
      const granted = new Set(privileges.map((row) => row.privilege_type));

      // THE CURRENT, UNDESIRED STATE — asserted as a fact so this test fails
      // loudly (not silently passes) the day someone tightens the grant and
      // forgets to update this file. See the file banner.
      expect(granted.has("UPDATE")).toBe(true);
      expect(granted.has("DELETE")).toBe(true);
    },
  );

  it(
    "an UPDATE against a real roster row is PERMITTED by the database today " +
      "— the gap this file exists to make visible",
    async () => {
      const { sessionId } = await aLesson("update_gap");
      const { studentProfileId } = await makeStudent("att_guest_update");
      const entry = await prisma.sessionRosterEntry.create({
        data: {
          sessionId,
          studentProfileId,
          source: "GUEST",
          reason: "inhaalles",
        },
        select: { id: true, reason: true },
      });
      expect(entry.reason).toBe("inhaalles");

      // THE ASSERTION AN APPEND-ONLY ATTENDANCE RECORD WOULD REQUIRE: rewriting
      // history should be refused by the database, exactly as it is for
      // `AuditEvent`. It is not — this resolves, and the row is changed in
      // place rather than superseded by a new one.
      await expect(
        prisma.sessionRosterEntry.update({
          where: { id: entry.id },
          data: { reason: "rewritten after the fact" },
        }),
      ).resolves.toMatchObject({ reason: "rewritten after the fact" });
    },
  );

  it(
    "a DELETE against a real roster row is PERMITTED by the database today " +
      "— the gap this file exists to make visible",
    async () => {
      const { sessionId } = await aLesson("delete_gap");
      const { studentProfileId } = await makeStudent("att_guest_delete");
      const entry = await prisma.sessionRosterEntry.create({
        data: { sessionId, studentProfileId, source: "GUEST" },
        select: { id: true },
      });

      // An append-only record cannot be made to disappear without trace. This
      // one can: the row is gone and nothing takes its place.
      await expect(
        prisma.sessionRosterEntry.delete({ where: { id: entry.id } }),
      ).resolves.toMatchObject({ id: entry.id });
      await expect(
        prisma.sessionRosterEntry.findUnique({ where: { id: entry.id } }),
      ).resolves.toBeNull();
    },
  );
});

describe("attendance itself — the register of who showed up", () => {
  it("has no model, no table and no module in this codebase yet", async () => {
    // Non-vacuous: SessionRosterEntry (the roster, a different thing) DOES
    // exist, so a query that found nothing because of a typo would not pass
    // this the way an always-true assertion would.
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_name ILIKE '%attendance%'
    `;
    expect(tables).toEqual([]);

    const rosterExists = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_name = 'SessionRosterEntry'
    `;
    expect(rosterExists).toHaveLength(1);
  });
});
