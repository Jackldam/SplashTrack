/**
 * The per-module scope-escape suite `06-delivery.md` §2.1 requires, for
 * `courses` — on the `groups-scope-escape.test.ts` pattern.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE HAS TO EXIST
 *
 * Until `courses` registered its four `ScopeRelations`, every branch of
 * `coversResource`'s `COURSES` case threw and was converted into a denial —
 * `courses-scope-relations.ts` says so in as many words, and names this file by
 * name as the suite that has to assert each of the four against real rows,
 * "with a `COURSE`-scoped principal specifically, named as the case a
 * type-ranking implementation passes". This is that suite.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ASYMMETRY THIS SUITE PINS
 *
 * §2.2 gives a `COURSE` grant "that course, its levels, its enrolments, and all
 * its exam sessions" — and `ScheduledSession` is deliberately NOT in that list.
 * So a `COURSE`-scoped principal reaches the course's GROUPS (through
 * `groupsOfCourse`, needed for D-170's containment check) and none of those
 * groups' lessons (`sessionsOfCourse` always answers `[]`). That is real and
 * intentional — `courses-scope-relations.ts` records it as an asymmetry rather
 * than a gap — and it is exactly the kind of thing that reads as a bug to
 * whoever finds it next without a test saying otherwise.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * D-170: NO SCOPE-TYPE RANKING
 *
 * A `UNIT` grant never covers a `Course` object, however many of the course's
 * groups sit inside that unit — "one course across groups" (§2.1). `GROUP` and
 * `SESSION` grants never reach upward to the course either (§6.1's no-upward
 * rule). Three separate assertions below pin each of those, because a
 * type-ranking implementation is exactly the shape that passes two of the three
 * and fails the third.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  coversResource,
  PermissionDeniedError,
  resolveReach,
} from "@/lib/authorization";
import { prisma } from "@/lib/database";
import {
  courseFilterForReach,
  enrolStudent,
  endEnrolment,
  getCourseForPrincipal,
  getStudentEnrolments,
  listCoursesForPrincipal,
} from "@/modules/courses";
import { getGroupForPrincipal, listGroupsForPrincipal } from "@/modules/groups";
import {
  createRecurrence,
  generateSessions,
  getSessionForPrincipal,
  listSessionsForPrincipal,
} from "@/modules/sessions";

import {
  COURSE_PRINCIPAL_PERMISSIONS,
  COURSES_ADMIN_PERMISSIONS,
  grantTo,
  installRealRelations,
  makeCourse,
  makeCourseLevel,
  makeGroupAtLevel,
  makePerson,
  makeRole,
  makeStudent,
  makeUnit,
  resetCoursesFixtures,
} from "../support/courses-fixtures";

const NOW = new Date("2026-06-01T12:00:00.000Z");

let adminId: string;
let coursePrincipalRoleId: string;

function admin() {
  return { principal: { personId: adminId }, at: NOW };
}

beforeAll(() => {
  installRealRelations();
});

beforeEach(async () => {
  await resetCoursesFixtures();
  adminId = await makePerson("esc_admin");
  const adminRoleId = await makeRole(
    "esc_role_admin",
    COURSES_ADMIN_PERMISSIONS,
  );
  coursePrincipalRoleId = await makeRole(
    "esc_role_course",
    COURSE_PRINCIPAL_PERMISSIONS,
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

describe("a COURSE-scoped principal", () => {
  it("sees their own course and NOT the one next door", async () => {
    const mine = await makeCourse("esc_mine");
    const theirs = await makeCourse("esc_theirs");
    const examinerId = await makePerson("esc_examiner");

    await grantTo({
      personId: examinerId,
      roleId: coursePrincipalRoleId,
      scopeType: "COURSE",
      scopeId: mine,
      validUntil: new Date("2027-01-01T00:00:00Z"),
    });

    const examiner = { principal: { personId: examinerId }, at: NOW };

    // THE LIST returns exactly one course — not the other one, and not an
    // error.
    const listed = await listCoursesForPrincipal(examiner);
    expect(listed.map((course) => course.id)).toEqual([mine]);

    // THE PER-ROW READ agrees with the list, in both directions.
    await expect(
      getCourseForPrincipal(examiner, theirs),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect((await getCourseForPrincipal(examiner, mine))?.id).toBe(mine);
  });

  it("reaches its own levels, in the detail payload, and not the other course's", async () => {
    const mine = await makeCourse("esc_lvl_mine");
    const theirs = await makeCourse("esc_lvl_theirs");
    await makeCourseLevel(mine, "esc_lvl_mine_a", { sequence: 1 });
    await makeCourseLevel(theirs, "esc_lvl_theirs_a", { sequence: 1 });
    const examinerId = await makePerson("esc_lvl_examiner");

    await grantTo({
      personId: examinerId,
      roleId: coursePrincipalRoleId,
      scopeType: "COURSE",
      scopeId: mine,
      validUntil: new Date("2027-01-01T00:00:00Z"),
    });

    const detail = await getCourseForPrincipal(
      { principal: { personId: examinerId }, at: NOW },
      mine,
    );
    expect(detail!.levels.map((level) => level.name)).toEqual([
      "Niveau esc_lvl_mine_a",
    ]);
    expect(JSON.stringify(detail)).not.toContain("esc_lvl_theirs");
  });

  it("reaches an enrolled pupil LIVE, and loses them the moment the enrolment closes (D-145 rule 1)", async () => {
    // `isEnrolledInCourse` is evaluated at query time, never from a value
    // captured when the grant was issued — a closed enrolment grants nobody
    // sight of anybody (F-114, one table across from `GroupMembership`).
    const courseId = await makeCourse("esc_live");
    const { studentProfileId } = await makeStudent("esc_live_pupil");
    const examinerId = await makePerson("esc_live_examiner");

    await enrolStudent(admin(), courseId, {
      studentProfileId,
      status: "ENROLLED",
      startedAt: "2026-01-06",
    });

    await grantTo({
      personId: examinerId,
      roleId: coursePrincipalRoleId,
      scopeType: "COURSE",
      scopeId: courseId,
      validUntil: new Date("2027-01-01T00:00:00Z"),
    });

    const reachWhileOpen = await resolveReach(
      { personId: examinerId },
      "courses.read",
      { at: NOW },
    );
    expect(
      await coversResource(reachWhileOpen, { student: studentProfileId }, NOW),
    ).toBe(true);

    await endEnrolment(admin(), courseId, {
      studentProfileId,
      endedAt: "2026-03-03",
    });

    const reachAfterClose = await resolveReach(
      { personId: examinerId },
      "courses.read",
      { at: NOW },
    );
    expect(
      await coversResource(reachAfterClose, { student: studentProfileId }, NOW),
    ).toBe(false);
  });

  it("returns its own enrolments with the course named, and WITHHOLDS the other course's name (D-145 rule 2)", async () => {
    const mine = await makeCourse("esc_en_mine");
    const other = await makeCourse("esc_en_other");
    const { studentProfileId } = await makeStudent("esc_en_pupil");
    const examinerId = await makePerson("esc_en_examiner");

    await enrolStudent(admin(), mine, {
      studentProfileId,
      status: "ENROLLED",
      startedAt: "2026-01-06",
    });
    await enrolStudent(admin(), other, {
      studentProfileId,
      status: "TRIAL",
      startedAt: "2026-02-06",
    });

    await grantTo({
      personId: examinerId,
      roleId: coursePrincipalRoleId,
      scopeType: "COURSE",
      scopeId: mine,
      validUntil: new Date("2027-01-01T00:00:00Z"),
    });

    const entries = await getStudentEnrolments(
      { principal: { personId: examinerId }, at: NOW },
      studentProfileId,
    );
    expect(entries).toHaveLength(2);

    const own = entries.find((entry) => entry.courseId === mine)!;
    expect(own.courseName).toBe("Cursus esc_en_mine");
    expect(own.courseWithheld).toBe(false);

    const theirs = entries.find((entry) => entry.courseId === other)!;
    expect(theirs.courseName).toBeNull();
    expect(theirs.courseWithheld).toBe(true);
    // The other course's own id stays visible (the enrolment is still the
    // pupil's history, and the id is what `endEnrolment` re-checks against —
    // see `EnrolmentEntry.courseId`'s own comment). What is withheld is the
    // NAME, and the other course's name never appears anywhere in the payload.
    expect(JSON.stringify(entries)).not.toContain("Cursus esc_en_other");

    // An administrator sees both course names, so the withholding above is the
    // reach and not an empty fixture.
    const full = await getStudentEnrolments(admin(), studentProfileId);
    expect(full.map((entry) => entry.courseName).sort()).toEqual(
      ["Cursus esc_en_mine", "Cursus esc_en_other"].sort(),
    );
  });

  it("reaches the course's groups (D-170's containment relation) — and NOT another course's group", async () => {
    const mine = await makeCourse("esc_grp_mine");
    const other = await makeCourse("esc_grp_other");
    const myLevel = await makeCourseLevel(mine, "esc_grp_mine_a");
    const otherLevel = await makeCourseLevel(other, "esc_grp_other_a");
    const myGroup = await makeGroupAtLevel("esc_grp_mine_group", myLevel);
    const otherGroup = await makeGroupAtLevel(
      "esc_grp_other_group",
      otherLevel,
    );
    const examinerId = await makePerson("esc_grp_examiner");

    await grantTo({
      personId: examinerId,
      roleId: coursePrincipalRoleId,
      scopeType: "COURSE",
      scopeId: mine,
      validUntil: new Date("2027-01-01T00:00:00Z"),
    });
    const examiner = { principal: { personId: examinerId }, at: NOW };

    expect((await getGroupForPrincipal(examiner, myGroup))?.id).toBe(myGroup);
    await expect(
      getGroupForPrincipal(examiner, otherGroup),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    const listed = await listGroupsForPrincipal(examiner);
    expect(listed.map((group) => group.id)).toEqual([myGroup]);
  });

  it("does NOT reach the group's scheduled lessons — the asymmetry `sessionsOfCourse` records", async () => {
    // §2.2 enumerates COURSE coverage and `ScheduledSession` is not in the
    // list. `sessionFilterForReach`'s COURSES branch denies for the same
    // reason `sessionsOfCourse` always answers `[]` — the predicate and the
    // list filter agree, which is the property §2.1 exists to protect.
    const courseId = await makeCourse("esc_sess");
    const levelId = await makeCourseLevel(courseId, "esc_sess_a");
    const groupId = await makeGroupAtLevel("esc_sess_group", levelId);
    await createRecurrence(admin(), groupId, {
      weekday: 2,
      startTime: "18:00",
      durationMinutes: 45,
      startsOn: "2026-06-01",
    });
    await generateSessions(admin(), groupId, {
      from: "2026-06-01",
      to: "2026-06-09",
    });
    const session = await prisma.scheduledSession.findFirstOrThrow({
      where: { groupId },
      orderBy: { occursOn: "asc" },
      select: { id: true },
    });

    const examinerId = await makePerson("esc_sess_examiner");
    await grantTo({
      personId: examinerId,
      roleId: coursePrincipalRoleId,
      scopeType: "COURSE",
      scopeId: courseId,
      validUntil: new Date("2027-01-01T00:00:00Z"),
    });
    const examiner = { principal: { personId: examinerId }, at: NOW };

    // The group itself IS reached (the test above)...
    expect((await getGroupForPrincipal(examiner, groupId))?.id).toBe(groupId);
    // ...but the lesson inside it is not, and the list agrees.
    await expect(
      getSessionForPrincipal(examiner, session.id),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      listSessionsForPrincipal(examiner, {
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2027-01-01T00:00:00Z"),
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    const reach = await resolveReach(
      { personId: examinerId },
      "planning.read",
      { at: NOW },
    );
    expect(await coversResource(reach, { session: session.id }, NOW)).toBe(
      false,
    );
  });
});

describe("D-170: no scope-type ranking reaches a COURSE from outside it", () => {
  it("a UNIT grant does not cover a course, however many of its groups sit inside that unit", async () => {
    const unitId = await makeUnit("esc_u_unit");
    const courseId = await makeCourse("esc_u_course");
    const levelId = await makeCourseLevel(courseId, "esc_u_level");
    // Every group of this course sits in the unit — the exact case a
    // type-ranking implementation waves through.
    await makeGroupAtLevel("esc_u_group", levelId, { unitId });

    const managerId = await makePerson("esc_u_manager");
    const managerRoleId = await makeRole("esc_u_role", [
      "courses.read",
      "groups.read",
    ]);
    await grantTo({
      personId: managerId,
      roleId: managerRoleId,
      scopeType: "UNIT",
      scopeId: unitId,
    });

    const manager = { principal: { personId: managerId }, at: NOW };
    await expect(
      getCourseForPrincipal(manager, courseId),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(listCoursesForPrincipal(manager)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );

    const reach = await resolveReach({ personId: managerId }, "courses.read", {
      at: NOW,
    });
    expect(await coversResource(reach, { course: courseId }, NOW)).toBe(false);
  });

  it("a GROUP grant does not reach upward to the course the group is taught under (§6.1)", async () => {
    const courseId = await makeCourse("esc_g_course");
    const levelId = await makeCourseLevel(courseId, "esc_g_level");
    const groupId = await makeGroupAtLevel("esc_g_group", levelId);

    const instructorId = await makePerson("esc_g_instructor");
    const instructorRoleId = await makeRole("esc_g_role", [
      "groups.read",
      "courses.read",
    ]);
    await grantTo({
      personId: instructorId,
      roleId: instructorRoleId,
      scopeType: "GROUP",
      scopeId: groupId,
    });

    const reach = await resolveReach(
      { personId: instructorId },
      "courses.read",
      { at: NOW },
    );
    const filter = courseFilterForReach(reach);
    expect(filter.kind).toBe("DENIED");
    expect(await coversResource(reach, { course: courseId }, NOW)).toBe(false);
  });

  it("a SESSION grant does not reach upward to the course either", async () => {
    const courseId = await makeCourse("esc_s_course");
    const levelId = await makeCourseLevel(courseId, "esc_s_level");
    const groupId = await makeGroupAtLevel("esc_s_group", levelId);
    await createRecurrence(admin(), groupId, {
      weekday: 2,
      startTime: "18:00",
      durationMinutes: 45,
      startsOn: "2026-06-01",
    });
    await generateSessions(admin(), groupId, {
      from: "2026-06-01",
      to: "2026-06-09",
    });
    const session = await prisma.scheduledSession.findFirstOrThrow({
      where: { groupId },
      select: { id: true },
    });

    const assessorId = await makePerson("esc_s_assessor");
    const assessorRoleId = await makeRole("esc_s_role", [
      "planning.read",
      "courses.read",
    ]);
    await grantTo({
      personId: assessorId,
      roleId: assessorRoleId,
      scopeType: "SESSION",
      scopeId: session.id,
      validFrom: new Date("2026-05-01T00:00:00Z"),
      validUntil: new Date("2026-07-01T00:00:00Z"),
    });

    const reach = await resolveReach({ personId: assessorId }, "courses.read", {
      at: NOW,
    });
    expect(await coversResource(reach, { course: courseId }, NOW)).toBe(false);
  });
});

describe("the list filter mirrors coversResource", () => {
  it("agrees with the predicate on every course, for every principal", async () => {
    const a = await makeCourse("esc_m_a");
    const b = await makeCourse("esc_m_b");
    const examinerId = await makePerson("esc_m_examiner");
    await grantTo({
      personId: examinerId,
      roleId: coursePrincipalRoleId,
      scopeType: "COURSE",
      scopeId: a,
      validUntil: new Date("2027-01-01T00:00:00Z"),
    });

    for (const personId of [adminId, examinerId]) {
      const reach = await resolveReach({ personId }, "courses.read", {
        at: NOW,
      });
      const filter = courseFilterForReach(reach);

      const visible =
        filter.kind === "DENIED"
          ? []
          : await prisma.course.findMany({
              where: filter.kind === "WHERE" ? filter.where : {},
              select: { id: true },
            });
      const visibleIds = new Set(visible.map((row) => row.id));

      for (const courseId of [a, b]) {
        const covered = await coversResource(reach, { course: courseId }, NOW);
        expect(
          visibleIds.has(courseId),
          `${personId} / ${courseId}: list and predicate disagree`,
        ).toBe(covered);
      }
    }
  });
});

describe("a principal with no grant at all", () => {
  it("is DENIED rather than shown an empty list", async () => {
    await makeCourse("esc_n_course");
    const strangerId = await makePerson("esc_stranger");
    const stranger = { principal: { personId: strangerId }, at: NOW };

    await expect(listCoursesForPrincipal(stranger)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });
});
