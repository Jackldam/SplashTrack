/**
 * The hand-written constraint of `20260909080000_attendance_module` —
 * invisible in `schema.prisma` and easy to lose in a future "regenerate the
 * migrations" tidy-up, which is why it is named and proved here (the
 * `skills-constraints.test.ts` pattern, one migration later).
 *
 * There is exactly ONE, plus the unique index Prisma does express but whose
 * behaviour is load-bearing enough to pin:
 *
 *   - `AttendanceEvent_no_self_supersede_check` — a row cannot supersede
 *     itself. The service never writes one (it reads the superseded row
 *     first); the CHECK is the backstop against a path nobody has written.
 *   - `AttendanceEvent_clientEventId_key` — P-02's idempotency: two rows with
 *     one client id cannot exist, even under a race the service's pre-read
 *     cannot see.
 *
 * The cross-row half of D-061's rule — the superseded event belongs to the
 * SAME session and pupil — is a rule no CHECK can state; it is enforced in
 * `amendAttendance` and pinned in `attendance-services.test.ts`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/database";
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
  adminId = await makePerson("con_admin");
  await grantTo({
    personId: adminId,
    roleId: await makeRole("con_role_admin", ATTENDANCE_ADMIN_PERMISSIONS),
    scopeType: "ORGANIZATION",
  });
});

afterAll(async () => {
  await resetAttendanceFixtures();
});

async function aRegisteredRow(suffix: string) {
  const groupId = await makeGroup(`con_${suffix}`);
  const pupil = await makeStudent(`con_p_${suffix}`);
  await placeInGroup(groupId, pupil.studentProfileId);
  const sessionId = await makeLesson(groupId, `con_${suffix}`);
  await registerSessionAttendance(admin(), sessionId, {
    entries: [
      {
        studentProfileId: pupil.studentProfileId,
        state: "PRESENT",
        clientEventId: aid(`ce_con_${suffix}`),
      },
    ],
  });
  const event = await prisma.attendanceEvent.findFirstOrThrow({
    where: { sessionId },
  });
  return { groupId, sessionId, pupil, event };
}

describe("AttendanceEvent_no_self_supersede_check", () => {
  it("refuses a row that supersedes itself, at the database", async () => {
    const { sessionId, pupil, event } = await aRegisteredRow("self");

    // A raw INSERT with a chosen id, so the row can point at itself — the
    // exact write no service performs and the CHECK exists for. The INSERT
    // privilege is one the runtime role legitimately holds.
    const selfId = aid("self_row");
    await expect(
      prisma.$executeRaw`
        INSERT INTO "AttendanceEvent"
          ("id", "sessionId", "studentProfileId", "state",
           "recordedAt", "clientEventId", "supersedesEventId", "groupId")
        VALUES
          (${selfId}, ${sessionId}, ${pupil.studentProfileId},
           'PRESENT', ${NOW}, ${aid("ce_self")}, ${selfId}, ${event.groupId})
      `,
    ).rejects.toThrow(/no_self_supersede/i);
  });
});

describe("AttendanceEvent_clientEventId_key", () => {
  it("refuses a second row with the same client id — the race the service's pre-read cannot see", async () => {
    const { sessionId, pupil, event } = await aRegisteredRow("dup");

    await expect(
      prisma.attendanceEvent.create({
        data: {
          sessionId,
          studentProfileId: pupil.studentProfileId,
          state: "ABSENT",
          recordedAt: NOW,
          clientEventId: event.clientEventId,
          groupId: event.groupId,
        },
      }),
    ).rejects.toThrow(/unique/i);
  });
});
