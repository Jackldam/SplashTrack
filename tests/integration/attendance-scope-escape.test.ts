/**
 * The per-module scope-escape suite `06-delivery.md` §2.1 requires, for
 * `attendance`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WRITES GUARD `{ session }`, READS GUARD `{ session }` OR `{ student }` —
 * AND THE STUDENT READ IS NARROWED PER ROW
 *
 * The escape this suite exists for is the design set's *primary internal
 * threat* (§6.2): an instructor browsing children they do not teach. Three
 * shapes of it are pinned by name:
 *
 *   1. A `GROUP`-scoped instructor of group A cannot register or read
 *      attendance on group B's lesson.
 *   2. A `GROUP`-scoped instructor reading a pupil they DO teach sees only
 *      their own group's rows — never the pupil's attendance elsewhere
 *      (D-145 rule 2, via the `groupId` snapshot).
 *   3. A `SESSION`-scoped substitute (D-179) can register on exactly that
 *      lesson and nothing else.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PermissionDeniedError } from "@/lib/authorization";
import {
  getAttendanceForStudent,
  getSessionRegister,
  registerSessionAttendance,
} from "@/modules/attendance";
import { addGuestToSession } from "@/modules/sessions";

import {
  aid,
  assignInstructorTo,
  ATTENDANCE_ADMIN_PERMISSIONS,
  grantTo,
  installRealRelations,
  INSTRUCTOR_ATTENDANCE_PERMISSIONS,
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
let instructorRoleId: string;

function admin() {
  return { principal: { personId: adminId }, at: NOW };
}

function actorFor(personId: string) {
  return { principal: { personId }, at: NOW };
}

beforeAll(() => {
  installRealRelations();
});

beforeEach(async () => {
  await resetAttendanceFixtures();
  adminId = await makePerson("esc_admin");
  await grantTo({
    personId: adminId,
    roleId: await makeRole("esc_role_admin", ATTENDANCE_ADMIN_PERMISSIONS),
    scopeType: "ORGANIZATION",
  });
  instructorRoleId = await makeRole(
    "esc_role_instructor",
    INSTRUCTOR_ATTENDANCE_PERMISSIONS,
  );
});

afterAll(async () => {
  await resetAttendanceFixtures();
});

/** Two groups, one pupil in each, one lesson each, an instructor on A only. */
async function twoGroups(suffix: string) {
  const groupA = await makeGroup(`ga_${suffix}`);
  const groupB = await makeGroup(`gb_${suffix}`);
  const pupilA = await makeStudent(`pa_${suffix}`);
  const pupilB = await makeStudent(`pb_${suffix}`);
  await placeInGroup(groupA, pupilA.studentProfileId);
  await placeInGroup(groupB, pupilB.studentProfileId);
  const lessonA = await makeLesson(groupA, `la_${suffix}`);
  const lessonB = await makeLesson(groupB, `lb_${suffix}`, {
    isoDate: "2026-03-11",
  });

  const instructorId = await makePerson(`instr_${suffix}`);
  await assignInstructorTo(groupA, instructorId);
  await grantTo({
    personId: instructorId,
    roleId: instructorRoleId,
    scopeType: "GROUP",
    scopeId: groupA,
  });

  return { groupA, groupB, pupilA, pupilB, lessonA, lessonB, instructorId };
}

describe("a GROUP-scoped instructor stays inside their group", () => {
  it("registers on their own lesson, and is denied group B's, by name", async () => {
    const { pupilA, pupilB, lessonA, lessonB, instructorId } =
      await twoGroups("write");

    await expect(
      registerSessionAttendance(actorFor(instructorId), lessonA, {
        entries: [
          {
            studentProfileId: pupilA.studentProfileId,
            state: "PRESENT",
            clientEventId: aid("esc_ce_own"),
          },
        ],
      }),
    ).resolves.toMatchObject({ created: 1 });

    await expect(
      registerSessionAttendance(actorFor(instructorId), lessonB, {
        entries: [
          {
            studentProfileId: pupilB.studentProfileId,
            state: "PRESENT",
            clientEventId: aid("esc_ce_other"),
          },
        ],
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("reads their own lesson's register, and is denied group B's", async () => {
    const { lessonA, lessonB, instructorId } = await twoGroups("read");

    await expect(
      getSessionRegister(actorFor(instructorId), lessonA),
    ).resolves.toMatchObject({ sessionId: lessonA });

    await expect(
      getSessionRegister(actorFor(instructorId), lessonB),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("D-145 rule 2: reading a pupil they teach returns THIS group's rows only — the other group's attendance is not theirs to see", async () => {
    const { groupA, groupB, pupilA, lessonA, lessonB, instructorId } =
      await twoGroups("narrow");

    // The pupil swims in BOTH groups — a lesson group and a club group is
    // ordinary (`prisma/schema.prisma`, GroupMembership's own comment).
    await placeInGroup(groupB, pupilA.studentProfileId);

    await registerSessionAttendance(admin(), lessonA, {
      entries: [
        {
          studentProfileId: pupilA.studentProfileId,
          state: "PRESENT",
          clientEventId: aid("esc_ce_na"),
        },
      ],
    });
    await registerSessionAttendance(admin(), lessonB, {
      entries: [
        {
          studentProfileId: pupilA.studentProfileId,
          state: "ABSENT",
          clientEventId: aid("esc_ce_nb"),
        },
      ],
    });

    const narrowed = await getAttendanceForStudent(
      actorFor(instructorId),
      pupilA.studentProfileId,
    );
    expect(narrowed).toHaveLength(1);
    expect(narrowed[0].state).toBe("PRESENT");

    // The full history exists — an ORGANIZATION reach sees both rows.
    const full = await getAttendanceForStudent(
      admin(),
      pupilA.studentProfileId,
    );
    expect(full).toHaveLength(2);

    void groupA;
  });

  it("holds no reach over a pupil they do not teach at all", async () => {
    const { pupilB, instructorId } = await twoGroups("stranger");

    await expect(
      getAttendanceForStudent(actorFor(instructorId), pupilB.studentProfileId),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("a SESSION-scoped substitute (D-179's weekly machinery)", () => {
  it("registers on exactly that lesson, and is denied the next one", async () => {
    const { groupA, pupilA, lessonA } = await twoGroups("sub");
    const otherLesson = await makeLesson(groupA, "sub_other", {
      isoDate: "2026-03-17",
    });

    const substituteId = await makePerson("substitute");
    await grantTo({
      personId: substituteId,
      roleId: instructorRoleId,
      scopeType: "SESSION",
      scopeId: lessonA,
      validUntil: new Date("2026-03-18T00:00:00.000Z"),
    });

    await expect(
      registerSessionAttendance(actorFor(substituteId), lessonA, {
        entries: [
          {
            studentProfileId: pupilA.studentProfileId,
            state: "PRESENT",
            clientEventId: aid("esc_ce_sub"),
          },
        ],
      }),
    ).resolves.toMatchObject({ created: 1 });

    await expect(
      registerSessionAttendance(actorFor(substituteId), otherLesson, {
        entries: [
          {
            studentProfileId: pupilA.studentProfileId,
            state: "PRESENT",
            clientEventId: aid("esc_ce_sub2"),
          },
        ],
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("no grant at all", () => {
  it("is denied the register and the history outright", async () => {
    const { lessonA, pupilA } = await twoGroups("nobody");
    const nobodyId = await makePerson("nobody");

    await expect(
      getSessionRegister(actorFor(nobodyId), lessonA),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      getAttendanceForStudent(actorFor(nobodyId), pupilA.studentProfileId),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("the widened roster guard (decision round, item 4) stays inside the lesson", () => {
  it("a GROUP-scoped instructor holding ONLY attendance permissions adds a guest to their own lesson, is denied group B's — and can then register the child", async () => {
    const { pupilB, lessonA, lessonB, instructorId } = await twoGroups("guest");

    // INSTRUCTOR_ATTENDANCE_PERMISSIONS holds no `groups.assign_members`, so
    // this passes ONLY through the `attendance.record` fallback door — the
    // poolside case Jack's decision opened, on the caller's own lesson.
    await expect(
      addGuestToSession(actorFor(instructorId), lessonA, {
        studentProfileId: pupilB.studentProfileId,
        reason: "inhaalles",
      }),
    ).resolves.toMatchObject({ rosterEntryId: expect.any(String) });

    // The widening is about WHO, never HOW FAR: the same instructor, the
    // other group's lesson, denied.
    await expect(
      addGuestToSession(actorFor(instructorId), lessonB, {
        studentProfileId: pupilB.studentProfileId,
        reason: "inhaalles",
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    // And the point of the row: attendance for the guest now works through
    // the ordinary `{ session }` guard.
    await expect(
      registerSessionAttendance(actorFor(instructorId), lessonA, {
        entries: [
          {
            studentProfileId: pupilB.studentProfileId,
            state: "PRESENT",
            clientEventId: aid("esc_ce_guest"),
          },
        ],
      }),
    ).resolves.toMatchObject({ created: 1 });
  });

  it("no grant at all is denied the roster change outright", async () => {
    const { pupilB, lessonA } = await twoGroups("guest_nobody");
    const nobodyId = await makePerson("guest_nobody");

    await expect(
      addGuestToSession(actorFor(nobodyId), lessonA, {
        studentProfileId: pupilB.studentProfileId,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
