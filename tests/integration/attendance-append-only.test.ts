/**
 * Is attendance append-only, or only claimed to be?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS — AND WHAT CHANGED IN PHASE 2.2
 *
 * `00-overview.md` P-07 states as a v1 property: *"Audit, attendance and
 * progress are append-only and queryable"*. An earlier version of this file
 * existed to keep a GAP loud: there was no attendance model at all, and the
 * nearest table (`SessionRosterEntry`, the roster) was ordinarily mutable. Its
 * own banner said what green would mean: *"a real `Attendance` module shipped
 * with its own carve-out (mirroring `auditGrantStatements`)"*.
 *
 * That is what phase 2.2 did. `AttendanceEvent` exists, and
 * `attendanceGrantStatements` (`src/lib/database/role-model.ts`, documented in
 * `infra/attendance-database-role.sql`) gives the runtime role `SELECT,
 * INSERT` and nothing else — so this file now proves the CONTROL the same way
 * `database-role-model.test.ts` proves the audit exception: by attempting the
 * forbidden statements against the real database as the real runtime role and
 * watching PostgreSQL refuse them.
 *
 * TWO DELIBERATE ASYMMETRIES, ASSERTED RATHER THAN ASSUMED:
 *
 *   - `SessionRosterEntry` STAYS ordinarily mutable. The roster is PLANNING
 *     (who is expected — a guest is added and removed by design,
 *     `removeGuestFromSession` deletes the row); the register is EVIDENCE.
 *     The append-only property belongs to the evidence.
 *   - Erasure still works. The runtime role cannot delete an attendance row,
 *     but deleting a pupil's `StudentProfile` cascades — a referential action
 *     runs with the OWNER's privileges — which is exactly the mechanism the
 *     erasure registry relies on.
 *
 * `SkillProgress` — P-07's third member — got the same carve-out in this
 * phase's DECISION ROUND (`skillProgressGrantStatements`, closing the
 * report's open item 6 on Jack's order), with one difference the grant file
 * explains: the retention role also holds UPDATE there, because severing
 * `assessedByPersonId` may need an explicit `SET NULL` the runtime role can
 * no longer issue. Asserted below beside the attendance proofs.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/database";
import { roleNameFrom } from "@/lib/database/role-model";
import { registerSessionAttendance } from "@/modules/attendance";

import {
  aid,
  ATTENDANCE_ADMIN_PERMISSIONS,
  grantTo,
  installRealRelations,
  makeGroup,
  makeLesson,
  makePerson,
  makeRole,
  makeStudent,
  placeInGroup,
  resetAttendanceFixtures,
} from "../support/attendance-fixtures";

/** The role this environment actually connects as — not the reference name. */
const APP_ROLE = roleNameFrom(process.env.DATABASE_URL as string);

const NOW = new Date("2026-03-10T18:00:00.000Z");

let adminId: string;

function admin() {
  return { principal: { personId: adminId }, at: NOW };
}

beforeAll(() => {
  installRealRelations();
});

beforeEach(async () => {
  await resetAttendanceFixtures();
  adminId = await makePerson("ao_admin");
  await grantTo({
    personId: adminId,
    roleId: await makeRole("ao_role_admin", ATTENDANCE_ADMIN_PERMISSIONS),
    scopeType: "ORGANIZATION",
  });
});

afterAll(async () => {
  await resetAttendanceFixtures();
});

/** One registered attendance row, written through the real service. */
async function aRegisteredRow(suffix: string) {
  const groupId = await makeGroup(`ao_${suffix}`);
  const pupil = await makeStudent(`ao_p_${suffix}`);
  await placeInGroup(groupId, pupil.studentProfileId);
  const sessionId = await makeLesson(groupId, `ao_${suffix}`);
  await registerSessionAttendance(admin(), sessionId, {
    entries: [
      {
        studentProfileId: pupil.studentProfileId,
        state: "ABSENT",
        clientEventId: aid(`ce_ao_${suffix}`),
      },
    ],
  });
  const event = await prisma.attendanceEvent.findFirstOrThrow({
    where: { sessionId },
  });
  return { groupId, sessionId, pupil, event };
}

describe("AttendanceEvent is append-only at the database level (P-07, D-061)", () => {
  it("the runtime role holds SELECT and INSERT, and nothing else", async () => {
    const privileges = await prisma.$queryRaw<{ privilege_type: string }[]>`
      SELECT privilege_type
        FROM information_schema.role_table_grants
       WHERE table_name = 'AttendanceEvent'
         AND grantee = ${APP_ROLE}
       ORDER BY privilege_type
    `;
    expect(privileges.map((row) => row.privilege_type)).toEqual([
      "INSERT",
      "SELECT",
    ]);
  });

  it("an UPDATE against a real row is REFUSED by the database — rewriting who was there is not a thing this application can do", async () => {
    const { event } = await aRegisteredRow("upd");

    await expect(
      prisma.attendanceEvent.update({
        where: { id: event.id },
        data: { state: "PRESENT" },
      }),
    ).rejects.toThrow(/permission denied|denied by|not permitted/i);

    // Byte-for-byte untouched.
    await expect(
      prisma.attendanceEvent.findUniqueOrThrow({ where: { id: event.id } }),
    ).resolves.toEqual(event);
  });

  it("a DELETE against a real row is REFUSED by the database", async () => {
    const { event } = await aRegisteredRow("del");

    await expect(
      prisma.attendanceEvent.delete({ where: { id: event.id } }),
    ).rejects.toThrow(/permission denied|denied by|not permitted/i);
    await expect(
      prisma.attendanceEvent.count({ where: { id: event.id } }),
    ).resolves.toBe(1);
  });

  it("erasing the PUPIL still takes the rows: the cascade runs as the owner, not as the runtime role", async () => {
    const { pupil, event } = await aRegisteredRow("erase");

    // The runtime role deletes the profile; the referential action deletes
    // the attendance rows it could never delete directly.
    await prisma.studentProfile.delete({
      where: { id: pupil.studentProfileId },
    });
    await expect(
      prisma.attendanceEvent.count({ where: { id: event.id } }),
    ).resolves.toBe(0);
  });
});

describe("the one deliberate asymmetry, and the retrofit that removed the other", () => {
  it("SessionRosterEntry stays ordinarily mutable — the roster is planning, not evidence", async () => {
    const privileges = await prisma.$queryRaw<{ privilege_type: string }[]>`
      SELECT privilege_type
        FROM information_schema.role_table_grants
       WHERE table_name = 'SessionRosterEntry'
         AND grantee = ${APP_ROLE}
       ORDER BY privilege_type
    `;
    const granted = new Set(privileges.map((row) => row.privilege_type));
    expect(granted.has("UPDATE")).toBe(true);
    expect(granted.has("DELETE")).toBe(true);
  });

  it("SkillProgress carries the same carve-out since the decision round: the runtime role appends and reads, nothing else", async () => {
    const privileges = await prisma.$queryRaw<{ privilege_type: string }[]>`
      SELECT privilege_type
        FROM information_schema.role_table_grants
       WHERE table_name = 'SkillProgress'
         AND grantee = ${APP_ROLE}
       ORDER BY privilege_type
    `;
    expect(privileges.map((row) => row.privilege_type)).toEqual([
      "INSERT",
      "SELECT",
    ]);
  });

  it("an UPDATE against a real SkillProgress row is REFUSED by the database — the phase 2.1 module's promise, now held by PostgreSQL", async () => {
    // A minimal direct row: the columns the INSERT needs are all FKs this
    // suite's own fixtures provide except the criterion chain, which is
    // inserted directly (and cleaned up below before the profile cascade
    // makes the criterion deletable again).
    const pupil = await makeStudent("ao_skills_upd");
    const awardTypeId = aid("ao_award");
    await prisma.awardType.create({
      data: {
        id: awardTypeId,
        code: aid("ao_award_code"),
        name: "Diploma fixture",
        kind: "DIPLOMA",
        issuingBody: "NRZ",
      },
    });
    const setId = aid("ao_set");
    await prisma.criterionSet.create({
      data: {
        id: setId,
        awardTypeId,
        version: 1,
        source: "NRZ",
        status: "ACTIVE",
        effectiveFrom: NOW,
      },
    });
    const criterionId = aid("ao_criterion");
    await prisma.criterion.create({
      data: {
        id: criterionId,
        criterionSetId: setId,
        code: aid("ao_crit_code"),
        name: "Borstcrawl fixture",
        sequence: 1,
      },
    });

    try {
      const row = await prisma.skillProgress.create({
        data: {
          studentProfileId: pupil.studentProfileId,
          criterionId,
          state: "PRACTISING",
          assessedAt: NOW,
        },
        select: { id: true, state: true },
      });

      await expect(
        prisma.skillProgress.update({
          where: { id: row.id },
          data: { state: "ACHIEVED" },
        }),
      ).rejects.toThrow(/permission denied|denied by|not permitted/i);
      await expect(
        prisma.skillProgress.delete({ where: { id: row.id } }),
      ).rejects.toThrow(/permission denied|denied by|not permitted/i);
    } finally {
      // The progress row leaves through the profile cascade (the only door
      // the runtime role has); only then is the criterion chain deletable.
      await prisma.studentProfile.delete({
        where: { id: pupil.studentProfileId },
      });
      await prisma.criterion.delete({ where: { id: criterionId } });
      await prisma.criterionSet.delete({ where: { id: setId } });
      await prisma.awardType.delete({ where: { id: awardTypeId } });
    }
  });
});
