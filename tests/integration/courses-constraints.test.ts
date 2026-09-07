/**
 * The constraints the Prisma DSL cannot express, each named and each proved —
 * on the `groups-and-sessions-constraints.test.ts` pattern.
 *
 * They live in
 * `prisma/migrations/20260907070000_courses_module/migration.sql` as
 * hand-written SQL, invisible in `schema.prisma`, and that migration's own
 * comment names this file as the one that has to hold them. Naming each one
 * here is what makes a future "regenerate the migrations" tidy-up go red
 * instead of silently dropping them.
 *
 * EVERY ASSERTION WRITES THROUGH RAW PRISMA, bypassing the services — the
 * services refuse these cases too (`courses-domain.test.ts`,
 * `courses-services.test.ts`), but a service check only holds for code that
 * goes through it, and a CHECK constraint's job is to hold for the path
 * nobody has written yet.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/database";

import {
  cid,
  makeCourse,
  makeCourseLevel,
  makeStudent,
  resetCoursesFixtures,
} from "../support/courses-fixtures";

let courseId: string;
let studentProfileId: string;

beforeEach(async () => {
  await resetCoursesFixtures();
  courseId = await makeCourse("c_course");
  ({ studentProfileId } = await makeStudent("c_pupil"));
});

afterAll(async () => {
  await resetCoursesFixtures();
});

describe("Enrolment", () => {
  it("Enrolment_window_order_check — refuses an end at or before the start", async () => {
    await expect(
      prisma.enrolment.create({
        data: {
          courseId,
          studentProfileId,
          status: "ENROLLED",
          startedAt: new Date("2026-03-10T00:00:00Z"),
          endedAt: new Date("2026-03-10T00:00:00Z"),
        },
      }),
    ).rejects.toThrow(/Enrolment_window_order_check/);

    await expect(
      prisma.enrolment.create({
        data: {
          courseId,
          studentProfileId,
          status: "ENROLLED",
          startedAt: new Date("2026-03-10T00:00:00Z"),
          endedAt: new Date("2026-03-01T00:00:00Z"),
        },
      }),
    ).rejects.toThrow(/Enrolment_window_order_check/);
  });

  it("Enrolment_single_open_enrolment_key — refuses two OPEN enrolments in one course", async () => {
    await prisma.enrolment.create({
      data: {
        courseId,
        studentProfileId,
        status: "ENROLLED",
        startedAt: new Date("2026-01-06"),
      },
    });
    // "Is this pupil enrolled in this course right now" must not be a
    // question with two answers.
    await expect(
      prisma.enrolment.create({
        data: {
          courseId,
          studentProfileId,
          status: "TRIAL",
          startedAt: new Date("2026-03-03"),
        },
      }),
    ).rejects.toThrow(/Enrolment_single_open_enrolment_key/);
  });

  it("permits an open enrolment in a DIFFERENT course at the same time", async () => {
    const otherCourseId = await makeCourse("c_other_course");
    await prisma.enrolment.create({
      data: {
        courseId,
        studentProfileId,
        status: "ENROLLED",
        startedAt: new Date("2026-01-06"),
      },
    });
    await expect(
      prisma.enrolment.create({
        data: {
          courseId: otherCourseId,
          studentProfileId,
          status: "ENROLLED",
          startedAt: new Date("2026-01-06"),
        },
      }),
    ).resolves.toBeDefined();
  });

  it("permits overlapping CLOSED enrolments — a club back-filling its history", async () => {
    await prisma.enrolment.create({
      data: {
        courseId,
        studentProfileId,
        status: "ENROLLED",
        startedAt: new Date("2026-01-06"),
        endedAt: new Date("2026-03-03"),
      },
    });
    await expect(
      prisma.enrolment.create({
        data: {
          courseId,
          studentProfileId,
          status: "TRIAL",
          startedAt: new Date("2026-02-01"),
          endedAt: new Date("2026-04-01"),
        },
      }),
    ).resolves.toBeDefined();
  });

  it("a TRIAL row must be closed before an ENROLLED row for the same course may open", async () => {
    // The mechanism behind D-109's honest conversion: no service check is
    // doing this, the partial unique index is.
    await prisma.enrolment.create({
      data: {
        courseId,
        studentProfileId,
        status: "TRIAL",
        startedAt: new Date("2026-01-06"),
      },
    });
    await expect(
      prisma.enrolment.create({
        data: {
          courseId,
          studentProfileId,
          status: "ENROLLED",
          startedAt: new Date("2026-01-13"),
        },
      }),
    ).rejects.toThrow(/Enrolment_single_open_enrolment_key/);
  });
});

describe("CourseLevel", () => {
  it("CourseLevel_sequence_positive_check — refuses a sequence of zero or less", async () => {
    for (const sequence of [0, -1]) {
      await expect(
        prisma.courseLevel.create({
          data: {
            id: cid(`c_seq_${sequence}`),
            courseId,
            name: "Ongeldig",
            sequence,
          },
        }),
      ).rejects.toThrow(/CourseLevel_sequence_positive_check/);
    }
  });

  it("CourseLevel_courseId_sequence_key — refuses two levels of one course at the same position", async () => {
    await makeCourseLevel(courseId, "c_dup_a", { sequence: 1 });
    await expect(
      prisma.courseLevel.create({
        data: { id: cid("c_dup_b"), courseId, name: "Dubbel", sequence: 1 },
      }),
    ).rejects.toThrow(/CourseLevel_courseId_sequence_key/);
  });

  it("permits two DIFFERENT courses each having a level at sequence 1", async () => {
    const otherCourseId = await makeCourse("c_seq_other");
    await makeCourseLevel(courseId, "c_seq_mine", { sequence: 1 });
    await expect(
      prisma.courseLevel.create({
        data: {
          id: cid("c_seq_theirs"),
          courseId: otherCourseId,
          name: "Ook op 1",
          sequence: 1,
        },
      }),
    ).resolves.toBeDefined();
  });
});

describe("Restrict foreign keys — nothing underneath a course or level may vanish", () => {
  it("refuses deleting a course that still has a level", async () => {
    await makeCourseLevel(courseId, "c_fk_level");
    await expect(
      prisma.course.delete({ where: { id: courseId } }),
    ).rejects.toThrow();
  });

  it("refuses deleting a course that still has an enrolment", async () => {
    await prisma.enrolment.create({
      data: {
        courseId,
        studentProfileId,
        status: "ENROLLED",
        startedAt: new Date("2026-01-06"),
      },
    });
    await expect(
      prisma.course.delete({ where: { id: courseId } }),
    ).rejects.toThrow();
  });

  it("refuses deleting a level a group is still taught at", async () => {
    const levelId = await makeCourseLevel(courseId, "c_fk_group_level");
    const groupId = cid("c_fk_group");
    await prisma.group.create({
      data: { id: groupId, name: "Groep", courseLevelId: levelId },
    });
    await expect(
      prisma.courseLevel.delete({ where: { id: levelId } }),
    ).rejects.toThrow();
  });
});
