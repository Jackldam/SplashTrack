/**
 * Functional coverage for the `courses` module's application services —
 * `course-service.ts`, `level-service.ts`, `enrolment-service.ts` — against a
 * real Postgres with the real scope relations registered. On the
 * `groups-and-sessions.test.ts` pattern: this proves the queries and guards
 * that run in production, not a stand-in.
 *
 * WHAT THIS FILE PINS THAT THE SCOPE-ESCAPE SUITE DOES NOT:
 *   - ordinary create/update flows and their validation errors;
 *   - the domain refusals (`SEQUENCE_TAKEN`, `ALREADY_ENROLLED`,
 *     `NOT_ENROLLED`, `ENDS_BEFORE_IT_STARTS`) surfacing through the service,
 *     not only through the pure functions (`courses-domain.test.ts` covers
 *     those in isolation);
 *   - the append-only / no-status-mutation invariant the module's own
 *     comments describe: converting a TRIAL into an ENROLLED pupil is TWO
 *     rows, and the old one is never touched.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PermissionDeniedError } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { ApiError } from "@/lib/errors";
import {
  createCourse,
  createCourseLevel,
  CourseLevelError,
  enrolStudent,
  endEnrolment,
  EnrolmentError,
  getCourseForPrincipal,
  hasOpenEnrolment,
  listCourseLevelsForPrincipal,
  updateCourse,
  updateCourseLevel,
} from "@/modules/courses";

import {
  COURSES_ADMIN_PERMISSIONS,
  grantTo,
  installRealRelations,
  makeCourse,
  makeCourseLevel,
  makePerson,
  makeRole,
  makeStudent,
  resetCoursesFixtures,
} from "../support/courses-fixtures";

const NOW = new Date("2026-06-01T12:00:00.000Z");

let adminId: string;

function admin() {
  return { principal: { personId: adminId }, at: NOW };
}

beforeAll(() => {
  installRealRelations();
});

beforeEach(async () => {
  await resetCoursesFixtures();
  adminId = await makePerson("svc_admin");
  const adminRoleId = await makeRole(
    "svc_role_admin",
    COURSES_ADMIN_PERMISSIONS,
  );
  await grantTo({
    personId: adminId,
    roleId: adminRoleId,
    scopeType: "ORGANIZATION",
  });
});

afterAll(async () => {
  await resetCoursesFixtures();
});

describe("createCourse", () => {
  it("creates a course with the supplied name and description", async () => {
    const { id } = await createCourse(admin(), {
      name: "Zwem-ABC",
      description: "Het volledige diplomatraject",
    });
    const row = await prisma.course.findUniqueOrThrow({ where: { id } });
    expect(row.name).toBe("Zwem-ABC");
    expect(row.description).toBe("Het volledige diplomatraject");
    expect(row.active).toBe(true);
  });

  it("refuses a blank name (ApiError VALIDATION_ERROR)", async () => {
    await expect(createCourse(admin(), { name: "   " })).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it("treats an absent description as null, not empty text", async () => {
    const { id } = await createCourse(admin(), { name: "Snorkelduiken" });
    const row = await prisma.course.findUniqueOrThrow({ where: { id } });
    expect(row.description).toBeNull();
  });

  it("requires courses.manage — a reader is denied", async () => {
    const readerId = await makePerson("svc_reader");
    const readerRoleId = await makeRole("svc_role_reader", ["courses.read"]);
    await grantTo({
      personId: readerId,
      roleId: readerRoleId,
      scopeType: "ORGANIZATION",
    });

    await expect(
      createCourse(
        { principal: { personId: readerId }, at: NOW },
        { name: "Onbevoegd" },
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("a principal with no grant at all is denied, never silently accepted", async () => {
    const strangerId = await makePerson("svc_stranger");
    await expect(
      createCourse(
        { principal: { personId: strangerId }, at: NOW },
        { name: "Vreemdeling" },
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("updateCourse", () => {
  it("changes name, description and active together", async () => {
    const { id } = await createCourse(admin(), {
      name: "Origineel",
      description: "eerste versie",
    });
    await updateCourse(admin(), id, {
      name: "Herzien",
      description: "tweede versie",
      active: "on",
    });
    const row = await prisma.course.findUniqueOrThrow({ where: { id } });
    expect(row.name).toBe("Herzien");
    expect(row.description).toBe("tweede versie");
    expect(row.active).toBe(true);
  });

  it("reads an unchecked checkbox as false, not as 'leave it alone'", async () => {
    const { id } = await createCourse(admin(), { name: "Actief" });
    await updateCourse(admin(), id, { name: "Actief", active: undefined });
    expect(
      (await prisma.course.findUniqueOrThrow({ where: { id } })).active,
    ).toBe(true);

    // An unchecked box posts the string "off", never nothing at all — the
    // screen sends a hidden field alongside the checkbox for exactly this
    // reason. `active !== "on"` reads as false, not as "leave it alone".
    await updateCourse(admin(), id, { name: "Actief", active: "off" });
    expect(
      (await prisma.course.findUniqueOrThrow({ where: { id } })).active,
    ).toBe(false);
  });

  it("does nothing to a course id that names no row", async () => {
    await expect(
      updateCourse(admin(), "does-not-exist", { name: "Wat dan ook" }),
    ).resolves.toBeUndefined();
  });

  it("is a no-op, and writes no audit event, when nothing changed", async () => {
    const { id } = await createCourse(admin(), {
      name: "Stabiel",
      description: "blijft gelijk",
    });
    const before = await prisma.auditEvent.count();
    await updateCourse(admin(), id, {
      name: "Stabiel",
      description: "blijft gelijk",
    });
    const after = await prisma.auditEvent.count();
    expect(after).toBe(before);
  });

  it("retires a course with active=false rather than deleting it", async () => {
    const { id } = await createCourse(admin(), { name: "Gestopt" });
    await updateCourse(admin(), id, { name: "Gestopt", active: "off" });
    // Still there — retirement, not deletion (§4.4 D-163's stub-column
    // reasoning applies equally to a whole row: the levels and enrolments
    // beneath it are still somebody's history).
    const row = await prisma.course.findUniqueOrThrow({ where: { id } });
    expect(row.active).toBe(false);
  });
});

describe("createCourseLevel", () => {
  it("allocates the next free sequence when none is supplied", async () => {
    const courseId = await makeCourse("svc_seq");
    const first = await createCourseLevel(admin(), courseId, {
      name: "Diploma A",
    });
    const second = await createCourseLevel(admin(), courseId, {
      name: "Diploma B",
    });
    const rows = await prisma.courseLevel.findMany({
      where: { id: { in: [first.id, second.id] } },
      orderBy: { sequence: "asc" },
    });
    expect(rows.map((row) => row.sequence)).toEqual([1, 2]);
  });

  it("accepts an explicit free sequence, for inserting a level by hand", async () => {
    const courseId = await makeCourse("svc_ins");
    await makeCourseLevel(courseId, "svc_ins_a", { sequence: 1 });
    await makeCourseLevel(courseId, "svc_ins_c", { sequence: 3 });
    const inserted = await createCourseLevel(admin(), courseId, {
      name: "Tussenin",
      sequence: 2,
    });
    const row = await prisma.courseLevel.findUniqueOrThrow({
      where: { id: inserted.id },
    });
    expect(row.sequence).toBe(2);
  });

  it("refuses a sequence another level already holds — SEQUENCE_TAKEN", async () => {
    const courseId = await makeCourse("svc_clash");
    await makeCourseLevel(courseId, "svc_clash_a", { sequence: 1 });
    await expect(
      createCourseLevel(admin(), courseId, { name: "Botsing", sequence: 1 }),
    ).rejects.toBeInstanceOf(CourseLevelError);
  });

  it("requires courses.manage on the course", async () => {
    const courseId = await makeCourse("svc_deny");
    const readerId = await makePerson("svc_lvl_reader");
    const readerRoleId = await makeRole("svc_lvl_role", ["courses.read"]);
    await grantTo({
      personId: readerId,
      roleId: readerRoleId,
      scopeType: "ORGANIZATION",
    });
    await expect(
      createCourseLevel(
        { principal: { personId: readerId }, at: NOW },
        courseId,
        { name: "Onbevoegd" },
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("updateCourseLevel", () => {
  it("renames and repositions a level", async () => {
    const courseId = await makeCourse("svc_upd");
    const levelId = await makeCourseLevel(courseId, "svc_upd_a", {
      sequence: 1,
    });
    await makeCourseLevel(courseId, "svc_upd_b", { sequence: 2 });

    await updateCourseLevel(admin(), levelId, {
      name: "Herzien niveau",
      sequence: 3,
    });
    const row = await prisma.courseLevel.findUniqueOrThrow({
      where: { id: levelId },
    });
    expect(row.name).toBe("Herzien niveau");
    expect(row.sequence).toBe(3);
  });

  it("refuses moving onto a position a sibling already holds", async () => {
    const courseId = await makeCourse("svc_upd_clash");
    const levelId = await makeCourseLevel(courseId, "svc_upd_clash_a", {
      sequence: 1,
    });
    await makeCourseLevel(courseId, "svc_upd_clash_b", { sequence: 2 });

    await expect(
      updateCourseLevel(admin(), levelId, { name: "Naar 2", sequence: 2 }),
    ).rejects.toBeInstanceOf(CourseLevelError);
  });

  it("permits leaving a level at its own current position", async () => {
    const courseId = await makeCourse("svc_upd_same");
    const levelId = await makeCourseLevel(courseId, "svc_upd_same_a", {
      sequence: 1,
    });
    await expect(
      updateCourseLevel(admin(), levelId, {
        name: "Zelfde plek",
        sequence: 1,
      }),
    ).resolves.toBeUndefined();
  });

  it("does nothing, and guards nothing, for a level id that names no row", async () => {
    const strangerId = await makePerson("svc_upd_stranger");
    // No grant at all — if the guard ran, this would throw PermissionDeniedError.
    // It resolves cleanly instead, because `courseOfLevel` finds nothing first.
    await expect(
      updateCourseLevel(
        { principal: { personId: strangerId }, at: NOW },
        "does-not-exist",
        { name: "Wat dan ook", sequence: 1 },
      ),
    ).resolves.toBeUndefined();
  });
});

describe("enrolStudent / endEnrolment — the interval, through the service", () => {
  it("opens an ENROLLED enrolment", async () => {
    const courseId = await makeCourse("svc_enrol");
    const { studentProfileId } = await makeStudent("svc_enrol_pupil");

    const { id } = await enrolStudent(admin(), courseId, {
      studentProfileId,
      status: "ENROLLED",
      startedAt: "2026-01-06",
    });
    const row = await prisma.enrolment.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("ENROLLED");
    expect(row.endedAt).toBeNull();
    expect(await hasOpenEnrolment(courseId, studentProfileId)).toBe(true);
  });

  it("refuses a second open enrolment in the same course — ALREADY_ENROLLED", async () => {
    const courseId = await makeCourse("svc_dup");
    const { studentProfileId } = await makeStudent("svc_dup_pupil");
    await enrolStudent(admin(), courseId, {
      studentProfileId,
      status: "ENROLLED",
      startedAt: "2026-01-06",
    });

    await expect(
      enrolStudent(admin(), courseId, {
        studentProfileId,
        status: "TRIAL",
        startedAt: "2026-02-01",
      }),
    ).rejects.toBeInstanceOf(EnrolmentError);
  });

  it("permits a second open enrolment in a DIFFERENT course at once", async () => {
    const courseA = await makeCourse("svc_multi_a");
    const courseB = await makeCourse("svc_multi_b");
    const { studentProfileId } = await makeStudent("svc_multi_pupil");

    await enrolStudent(admin(), courseA, {
      studentProfileId,
      status: "ENROLLED",
      startedAt: "2026-01-06",
    });
    await expect(
      enrolStudent(admin(), courseB, {
        studentProfileId,
        status: "ENROLLED",
        startedAt: "2026-01-06",
      }),
    ).resolves.toBeDefined();
  });

  it("ends the open enrolment; the row stays with endedAt set", async () => {
    const courseId = await makeCourse("svc_end");
    const { studentProfileId } = await makeStudent("svc_end_pupil");
    await enrolStudent(admin(), courseId, {
      studentProfileId,
      status: "ENROLLED",
      startedAt: "2026-01-06",
    });

    await endEnrolment(admin(), courseId, {
      studentProfileId,
      endedAt: "2026-03-03",
    });

    const rows = await prisma.enrolment.findMany({
      where: { courseId, studentProfileId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.endedAt).toEqual(new Date("2026-03-03T00:00:00.000Z"));
    expect(await hasOpenEnrolment(courseId, studentProfileId)).toBe(false);
  });

  it("refuses ending when nothing is open — NOT_ENROLLED", async () => {
    const courseId = await makeCourse("svc_notenrolled");
    const { studentProfileId } = await makeStudent("svc_ne_pupil");
    await expect(
      endEnrolment(admin(), courseId, {
        studentProfileId,
        endedAt: "2026-03-03",
      }),
    ).rejects.toBeInstanceOf(EnrolmentError);
  });

  it("refuses an end at or before the start — ENDS_BEFORE_IT_STARTS", async () => {
    const courseId = await makeCourse("svc_backwards");
    const { studentProfileId } = await makeStudent("svc_bw_pupil");
    await enrolStudent(admin(), courseId, {
      studentProfileId,
      status: "ENROLLED",
      startedAt: "2026-03-03",
    });
    await expect(
      endEnrolment(admin(), courseId, {
        studentProfileId,
        endedAt: "2026-03-03",
      }),
    ).rejects.toBeInstanceOf(EnrolmentError);
    await expect(
      endEnrolment(admin(), courseId, {
        studentProfileId,
        endedAt: "2026-01-01",
      }),
    ).rejects.toBeInstanceOf(EnrolmentError);
  });

  it("requires enrolments.manage on the course", async () => {
    const courseId = await makeCourse("svc_enrol_deny");
    const { studentProfileId } = await makeStudent("svc_enrol_deny_pupil");
    const readerId = await makePerson("svc_enrol_reader");
    const readerRoleId = await makeRole("svc_enrol_role", ["courses.read"]);
    await grantTo({
      personId: readerId,
      roleId: readerRoleId,
      scopeType: "ORGANIZATION",
    });

    await expect(
      enrolStudent({ principal: { personId: readerId }, at: NOW }, courseId, {
        studentProfileId,
        status: "ENROLLED",
        startedAt: "2026-01-06",
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  describe("converting a TRIAL into an ENROLLED pupil (D-109 / D-059)", () => {
    it("is two rows — the TRIAL is closed, never edited into ENROLLED", async () => {
      const courseId = await makeCourse("svc_convert");
      const { studentProfileId } = await makeStudent("svc_convert_pupil");

      const trial = await enrolStudent(admin(), courseId, {
        studentProfileId,
        status: "TRIAL",
        startedAt: "2026-01-06",
      });

      await endEnrolment(admin(), courseId, {
        studentProfileId,
        endedAt: "2026-01-13",
      });

      const enrolled = await enrolStudent(admin(), courseId, {
        studentProfileId,
        status: "ENROLLED",
        startedAt: "2026-01-13",
      });

      // THE OLD ROW IS UNTOUCHED — still TRIAL, still started the day the
      // trial happened, closed on the day it was converted.
      const trialRow = await prisma.enrolment.findUniqueOrThrow({
        where: { id: trial.id },
      });
      expect(trialRow.status).toBe("TRIAL");
      expect(trialRow.startedAt).toEqual(new Date("2026-01-06T00:00:00.000Z"));
      expect(trialRow.endedAt).toEqual(new Date("2026-01-13T00:00:00.000Z"));

      // A SECOND, NEW row carries the ENROLLED status.
      const enrolledRow = await prisma.enrolment.findUniqueOrThrow({
        where: { id: enrolled.id },
      });
      expect(enrolledRow.id).not.toBe(trialRow.id);
      expect(enrolledRow.status).toBe("ENROLLED");
      expect(enrolledRow.startedAt).toEqual(
        new Date("2026-01-13T00:00:00.000Z"),
      );
      expect(enrolledRow.endedAt).toBeNull();

      // Both rows exist — the record that the trial happened survives the
      // conversion.
      const all = await prisma.enrolment.findMany({
        where: { courseId, studentProfileId },
      });
      expect(all).toHaveLength(2);
    });
  });
});

describe("listCourseLevelsForPrincipal", () => {
  it("flattens every level of every course this principal reaches", async () => {
    const courseId = await makeCourse("svc_flat");
    await makeCourseLevel(courseId, "svc_flat_a", { sequence: 1 });
    await makeCourseLevel(courseId, "svc_flat_b", { sequence: 2 });

    const options = await listCourseLevelsForPrincipal(admin());
    const mine = options.filter((option) => option.courseId === courseId);
    expect(mine.map((option) => option.levelName)).toEqual([
      "Niveau svc_flat_a",
      "Niveau svc_flat_b",
    ]);
  });

  it("is denied, not shown an empty list, for a principal with no grant", async () => {
    const strangerId = await makePerson("svc_flat_stranger");
    await expect(
      listCourseLevelsForPrincipal({
        principal: { personId: strangerId },
        at: NOW,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("getCourseForPrincipal counts", () => {
  it("counts open enrolments at `at`, and not closed or future ones", async () => {
    const courseId = await makeCourse("svc_count");
    const { studentProfileId: open } = await makeStudent("svc_count_open");
    const { studentProfileId: closed } = await makeStudent("svc_count_closed");
    const { studentProfileId: future } = await makeStudent("svc_count_future");

    await enrolStudent(admin(), courseId, {
      studentProfileId: open,
      status: "ENROLLED",
      startedAt: "2026-01-06",
    });
    await enrolStudent(admin(), courseId, {
      studentProfileId: closed,
      status: "ENROLLED",
      startedAt: "2025-01-06",
    });
    await endEnrolment(
      {
        principal: { personId: adminId },
        at: new Date("2025-06-01T00:00:00Z"),
      },
      courseId,
      { studentProfileId: closed, endedAt: "2025-06-01" },
    );
    await enrolStudent(admin(), courseId, {
      studentProfileId: future,
      status: "ENROLLED",
      startedAt: "2099-01-01",
    });

    const detail = await getCourseForPrincipal(admin(), courseId);
    expect(detail!.openEnrolments).toBe(1);
  });
});
