/**
 * `attendance-service.ts` against the real database — registration, the
 * idempotent replay, the correction path, and the derived register.
 *
 * The three properties worth naming, because each is a design sentence:
 *
 *   - ONE TRANSACTION per registration (`01-domain-model.md` §4: "partial
 *     attendance is not a valid state") — a refused entry refuses the lot.
 *   - ONE AUDIT EVENT per registration (D-126), not one per pupil.
 *   - APPEND-ONLY corrections (D-061): after an amend, the original row is
 *     byte-for-byte untouched and a second row exists.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/database";
import {
  amendAttendance,
  AttendanceError,
  getAttendanceForStudent,
  getSessionRegister,
  registerSessionAttendance,
} from "@/modules/attendance";

import {
  aid,
  ATTENDANCE_ADMIN_PERMISSIONS,
  addGuestRow,
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
  adminId = await makePerson("svc_admin");
  await grantTo({
    personId: adminId,
    roleId: await makeRole("svc_role_admin", ATTENDANCE_ADMIN_PERMISSIONS),
    scopeType: "ORGANIZATION",
  });
});

afterAll(async () => {
  await resetAttendanceFixtures();
});

/** A group with two placed pupils and one lesson. */
async function aLesson(suffix: string) {
  const groupId = await makeGroup(`g_${suffix}`);
  const one = await makeStudent(`p1_${suffix}`);
  const two = await makeStudent(`p2_${suffix}`);
  await placeInGroup(groupId, one.studentProfileId);
  await placeInGroup(groupId, two.studentProfileId);
  const sessionId = await makeLesson(groupId, suffix);
  return { groupId, sessionId, one, two };
}

describe("registerSessionAttendance", () => {
  it("writes the whole register in one call, stamps the group snapshot and the recorder, and audits ONCE (D-126)", async () => {
    const { groupId, sessionId, one, two } = await aLesson("happy");

    const report = await registerSessionAttendance(admin(), sessionId, {
      entries: [
        {
          studentProfileId: one.studentProfileId,
          state: "PRESENT",
          clientEventId: aid("ce_happy_1"),
        },
        {
          studentProfileId: two.studentProfileId,
          state: "ABSENT",
          clientEventId: aid("ce_happy_2"),
          note: "ziek gemeld",
        },
      ],
    });
    expect(report).toEqual({ created: 2, replayed: 0 });

    const rows = await prisma.attendanceEvent.findMany({
      where: { sessionId },
      orderBy: { clientEventId: "asc" },
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.groupId).toBe(groupId);
      expect(row.recordedByPersonId).toBe(adminId);
      expect(row.supersedesEventId).toBeNull();
    }
    expect(rows[1].note).toBe("ziek gemeld");

    const audits = await prisma.auditEvent.findMany({
      where: { eventType: "attendance.registered", targetId: sessionId },
    });
    expect(audits).toHaveLength(1);
    const fields = audits[0].changedFields as Record<string, unknown>;
    expect(fields.created).toBe(2);
    expect(fields.state_PRESENT).toBe(1);
    expect(fields.state_ABSENT).toBe(1);
    // The note itself never reaches the audit trail.
    expect(JSON.stringify(fields)).not.toContain("ziek");
  });

  it("replays idempotently: the same clientEventIds write nothing twice (P-02)", async () => {
    const { sessionId, one, two } = await aLesson("replay");
    const entries = [
      {
        studentProfileId: one.studentProfileId,
        state: "PRESENT",
        clientEventId: aid("ce_replay_1"),
      },
      {
        studentProfileId: two.studentProfileId,
        state: "LATE",
        clientEventId: aid("ce_replay_2"),
      },
    ];

    await registerSessionAttendance(admin(), sessionId, { entries });
    const again = await registerSessionAttendance(admin(), sessionId, {
      entries,
    });
    expect(again).toEqual({ created: 0, replayed: 2 });

    await expect(
      prisma.attendanceEvent.count({ where: { sessionId } }),
    ).resolves.toBe(2);
  });

  it("a partial replay writes only the fresh entries", async () => {
    const { sessionId, one, two } = await aLesson("partial");
    const first = {
      studentProfileId: one.studentProfileId,
      state: "PRESENT",
      clientEventId: aid("ce_partial_1"),
    };
    await registerSessionAttendance(admin(), sessionId, { entries: [first] });

    const report = await registerSessionAttendance(admin(), sessionId, {
      entries: [
        first,
        {
          studentProfileId: two.studentProfileId,
          state: "EXCUSED",
          clientEventId: aid("ce_partial_2"),
        },
      ],
    });
    expect(report).toEqual({ created: 1, replayed: 1 });
  });

  it("refuses a pupil who is not on the roster — and then writes NOTHING for anyone (§4's transaction boundary)", async () => {
    const { sessionId, one } = await aLesson("stranger");
    const outsider = await makeStudent("stranger_out");

    await expect(
      registerSessionAttendance(admin(), sessionId, {
        entries: [
          {
            studentProfileId: one.studentProfileId,
            state: "PRESENT",
            clientEventId: aid("ce_str_1"),
          },
          {
            studentProfileId: outsider.studentProfileId,
            state: "PRESENT",
            clientEventId: aid("ce_str_2"),
          },
        ],
      }),
    ).rejects.toMatchObject({ reason: "NOT_ON_ROSTER" });

    await expect(
      prisma.attendanceEvent.count({ where: { sessionId } }),
    ).resolves.toBe(0);
  });

  it("a GUEST on the roster is registrable — D-179: attendance derives from participation in the session", async () => {
    const { sessionId } = await aLesson("guest");
    const guest = await makeStudent("guest_child");
    await addGuestRow(sessionId, guest.studentProfileId);

    const report = await registerSessionAttendance(admin(), sessionId, {
      entries: [
        {
          studentProfileId: guest.studentProfileId,
          state: "PRESENT",
          clientEventId: aid("ce_guest_1"),
        },
      ],
    });
    expect(report.created).toBe(1);
  });

  it("resolves the roster at the LESSON's date: a pupil who left before it is not on it", async () => {
    const groupId = await makeGroup("g_left");
    const left = await makeStudent("left_child");
    await prisma.groupMembership.create({
      data: {
        groupId,
        studentProfileId: left.studentProfileId,
        fromDate: new Date("2020-01-01T00:00:00Z"),
        toDate: new Date("2026-01-01T00:00:00Z"),
      },
    });
    const sessionId = await makeLesson(groupId, "left");

    await expect(
      registerSessionAttendance(admin(), sessionId, {
        entries: [
          {
            studentProfileId: left.studentProfileId,
            state: "PRESENT",
            clientEventId: aid("ce_left_1"),
          },
        ],
      }),
    ).rejects.toMatchObject({ reason: "NOT_ON_ROSTER" });
  });

  it("refuses a cancelled lesson", async () => {
    const groupId = await makeGroup("g_cxl");
    const pupil = await makeStudent("cxl_child");
    await placeInGroup(groupId, pupil.studentProfileId);
    const sessionId = await makeLesson(groupId, "cxl", {
      status: "CANCELLED",
    });

    await expect(
      registerSessionAttendance(admin(), sessionId, {
        entries: [
          {
            studentProfileId: pupil.studentProfileId,
            state: "PRESENT",
            clientEventId: aid("ce_cxl_1"),
          },
        ],
      }),
    ).rejects.toMatchObject({ reason: "SESSION_CANCELLED" });
  });

  it("refuses an empty register and a duplicated pupil, by name", async () => {
    const { sessionId, one } = await aLesson("dupes");

    await expect(
      registerSessionAttendance(admin(), sessionId, { entries: [] }),
    ).rejects.toMatchObject({ reason: "NOTHING_TO_REGISTER" });

    await expect(
      registerSessionAttendance(admin(), sessionId, {
        entries: [
          {
            studentProfileId: one.studentProfileId,
            state: "PRESENT",
            clientEventId: aid("ce_dup_1"),
          },
          {
            studentProfileId: one.studentProfileId,
            state: "ABSENT",
            clientEventId: aid("ce_dup_2"),
          },
        ],
      }),
    ).rejects.toMatchObject({ reason: "DUPLICATE_PUPIL" });
  });
});

describe("amendAttendance", () => {
  it("appends a correction; the original row is untouched (D-061) and the derived answer flips", async () => {
    const { sessionId, one } = await aLesson("amend");
    await registerSessionAttendance(admin(), sessionId, {
      entries: [
        {
          studentProfileId: one.studentProfileId,
          state: "ABSENT",
          clientEventId: aid("ce_amend_orig"),
        },
      ],
    });
    const original = await prisma.attendanceEvent.findFirstOrThrow({
      where: { sessionId },
    });

    const correction = await amendAttendance(admin(), sessionId, {
      studentProfileId: one.studentProfileId,
      state: "PRESENT",
      clientEventId: aid("ce_amend_fix"),
      supersedesEventId: original.id,
      note: "stond gewoon in het water",
    });

    const originalAfter = await prisma.attendanceEvent.findUniqueOrThrow({
      where: { id: original.id },
    });
    expect(originalAfter).toEqual(original);

    const register = await getSessionRegister(admin(), sessionId);
    const line = register.lines.find(
      (candidate) => candidate.studentProfileId === one.studentProfileId,
    );
    expect(line?.effective).toMatchObject({
      eventId: correction.id,
      state: "PRESENT",
    });
    expect(register.events).toHaveLength(2);

    const audits = await prisma.auditEvent.findMany({
      where: { eventType: "attendance.amended", targetId: sessionId },
    });
    expect(audits).toHaveLength(1);
  });

  it("refuses a supersede pointer at another pupil's or another lesson's event", async () => {
    const { sessionId, one, two } = await aLesson("mismatch");
    await registerSessionAttendance(admin(), sessionId, {
      entries: [
        {
          studentProfileId: one.studentProfileId,
          state: "PRESENT",
          clientEventId: aid("ce_mm_1"),
        },
      ],
    });
    const event = await prisma.attendanceEvent.findFirstOrThrow({
      where: { sessionId },
    });

    // Same lesson, wrong pupil.
    await expect(
      amendAttendance(admin(), sessionId, {
        studentProfileId: two.studentProfileId,
        state: "ABSENT",
        clientEventId: aid("ce_mm_2"),
        supersedesEventId: event.id,
      }),
    ).rejects.toMatchObject({ reason: "SUPERSEDED_EVENT_MISMATCH" });

    // Right pupil, wrong lesson.
    const otherLesson = await makeLesson(event.groupId, "mm_other", {
      isoDate: "2026-03-17",
    });
    await expect(
      amendAttendance(admin(), otherLesson, {
        studentProfileId: one.studentProfileId,
        state: "ABSENT",
        clientEventId: aid("ce_mm_3"),
        supersedesEventId: event.id,
      }),
    ).rejects.toMatchObject({ reason: "SUPERSEDED_EVENT_MISMATCH" });
  });

  it("replays idempotently: the same clientEventId returns the first correction and writes nothing", async () => {
    const { sessionId, one } = await aLesson("amend_replay");
    await registerSessionAttendance(admin(), sessionId, {
      entries: [
        {
          studentProfileId: one.studentProfileId,
          state: "ABSENT",
          clientEventId: aid("ce_ar_orig"),
        },
      ],
    });
    const original = await prisma.attendanceEvent.findFirstOrThrow({
      where: { sessionId },
    });

    const input = {
      studentProfileId: one.studentProfileId,
      state: "PRESENT",
      clientEventId: aid("ce_ar_fix"),
      supersedesEventId: original.id,
    };
    const first = await amendAttendance(admin(), sessionId, input);
    const second = await amendAttendance(admin(), sessionId, input);
    expect(second.id).toBe(first.id);
    await expect(
      prisma.attendanceEvent.count({ where: { sessionId } }),
    ).resolves.toBe(2);
  });
});

describe("the reads", () => {
  it("getSessionRegister lists every roster member, registered or not", async () => {
    const { sessionId, one, two } = await aLesson("register_read");
    await registerSessionAttendance(admin(), sessionId, {
      entries: [
        {
          studentProfileId: one.studentProfileId,
          state: "LATE",
          clientEventId: aid("ce_rr_1"),
        },
      ],
    });

    const register = await getSessionRegister(admin(), sessionId);
    expect(register.lines).toHaveLength(2);
    const registered = register.lines.find(
      (line) => line.studentProfileId === one.studentProfileId,
    );
    const unregistered = register.lines.find(
      (line) => line.studentProfileId === two.studentProfileId,
    );
    expect(registered?.effective?.state).toBe("LATE");
    expect(unregistered?.effective).toBeNull();
  });

  it("getAttendanceForStudent returns the history with superseded rows marked, never hidden", async () => {
    const { sessionId, one } = await aLesson("history");
    await registerSessionAttendance(admin(), sessionId, {
      entries: [
        {
          studentProfileId: one.studentProfileId,
          state: "ABSENT",
          clientEventId: aid("ce_h_orig"),
        },
      ],
    });
    const original = await prisma.attendanceEvent.findFirstOrThrow({
      where: { sessionId },
    });
    await amendAttendance(admin(), sessionId, {
      studentProfileId: one.studentProfileId,
      state: "PRESENT",
      clientEventId: aid("ce_h_fix"),
      supersedesEventId: original.id,
    });

    const history = await getAttendanceForStudent(
      admin(),
      one.studentProfileId,
    );
    expect(history).toHaveLength(2);
    expect(history.find((entry) => entry.id === original.id)?.superseded).toBe(
      true,
    );
    expect(history.find((entry) => entry.id !== original.id)?.superseded).toBe(
      false,
    );
  });

  it("getSessionRegister names a missing lesson as such", async () => {
    await expect(
      getSessionRegister(admin(), aid("no_such_lesson")),
    ).rejects.toBeInstanceOf(AttendanceError);
  });
});
