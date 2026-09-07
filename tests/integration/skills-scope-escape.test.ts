/**
 * The per-module scope-escape suite `06-delivery.md` §2.1 requires, for
 * `skills`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CATALOGUE HAS NO SCOPE TYPE OF ITS OWN
 *
 * Unlike `courses`, `skills` registers no `ScopeRelations`: `AwardType`,
 * `GradeScale`/`GradeValue`, `CriterionSet` and `Criterion` are visible only
 * through an `ORGANIZATION`-scoped grant (`award-type-service.ts`'s file
 * comment). So the escape property here is narrower and sharper than in any
 * module so far: EVERY non-`ORGANIZATION` reach — `UNIT`, `GROUP`, `COURSE`,
 * `SESSION`, `SELF` — must be refused the catalogue outright, with no
 * type-ranking exception. This suite pins `UNIT` and `GROUP` by name, the two
 * scopes a real starter role in this domain actually holds.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `SkillProgress` DOES HAVE A SCOPE — `{ group }` FOR WRITES, `{ student }`
 * FOR READS
 *
 * `recordSkillProgress` guards `{ group: groupId }` (§2.2's own
 * `attendance.record` example) and additionally refuses a student who is not
 * an ACTIVE member of that group — a domain check layered under the
 * authorization one, both asserted here. `getSkillProgressForStudent` guards
 * `{ student: studentProfileId }`, the `getStudentEnrolments` shape.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PermissionDeniedError } from "@/lib/authorization";
import { assignInstructor } from "@/modules/groups";
import {
  createAwardType,
  getAwardTypeForPrincipal,
  getSkillProgressForStudent,
  listAwardTypesForPrincipal,
  listCriteriaForGroup,
  recordSkillProgress,
  SkillProgressError,
} from "@/modules/skills";

import {
  GROUP_PRINCIPAL_PERMISSIONS,
  SKILLS_ADMIN_PERMISSIONS,
  grantTo,
  installRealRelations,
  makeAwardType,
  makeCourse,
  makeCourseLevel,
  makeCriterion,
  makeCriterionSet,
  makeFiveGradeScale,
  makeGroupAtLevel,
  makePerson,
  makeRole,
  makeStudent,
  makeUnit,
  placeInGroup,
  resetSkillsFixtures,
} from "../support/skills-fixtures";

const NOW = new Date("2026-06-01T12:00:00.000Z");

let adminId: string;
let adminRoleId: string;
let groupPrincipalRoleId: string;

function admin() {
  return { principal: { personId: adminId }, at: NOW };
}

beforeAll(() => {
  installRealRelations();
});

beforeEach(async () => {
  await resetSkillsFixtures();
  adminId = await makePerson("esc_admin");
  adminRoleId = await makeRole("esc_role_admin", SKILLS_ADMIN_PERMISSIONS);
  groupPrincipalRoleId = await makeRole(
    "esc_role_group",
    GROUP_PRINCIPAL_PERMISSIONS,
  );
  await grantTo({
    personId: adminId,
    roleId: adminRoleId,
    scopeType: "ORGANIZATION",
  });
});

afterAll(async () => {
  await resetSkillsFixtures();
});

describe("the catalogue is ORGANIZATION-scoped only", () => {
  it("a UNIT-scoped principal is denied the award-type list, by name", async () => {
    const unitId = await makeUnit("esc_unit");
    const managerId = await makePerson("esc_unit_manager");
    await grantTo({
      personId: managerId,
      roleId: adminRoleId,
      scopeType: "UNIT",
      scopeId: unitId,
    });

    await expect(
      listAwardTypesForPrincipal({
        principal: { personId: managerId },
        at: NOW,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("a GROUP-scoped instructor is denied the award-type list and detail", async () => {
    const awardTypeId = await makeAwardType("esc_group_denied");
    const courseId = await makeCourse("esc_group_denied_course");
    const levelId = await makeCourseLevel(courseId, "esc_group_denied_level", {
      awardTypeId,
    });
    const groupId = await makeGroupAtLevel("esc_group_denied_group", levelId);
    const instructorId = await makePerson("esc_group_denied_instructor");
    await grantTo({
      personId: instructorId,
      roleId: groupPrincipalRoleId,
      scopeType: "GROUP",
      scopeId: groupId,
    });
    await assignInstructor(admin(), groupId, {
      personId: instructorId,
      fromDate: "2026-01-01",
    });
    const instructor = { principal: { personId: instructorId }, at: NOW };

    await expect(listAwardTypesForPrincipal(instructor)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(
      getAwardTypeForPrincipal(instructor, awardTypeId),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("an ORGANIZATION-scoped principal reaches the catalogue", async () => {
    await makeAwardType("esc_org_visible");
    const list = await listAwardTypesForPrincipal(admin());
    expect(list.some((a) => a.code.startsWith("skillsfx_"))).toBe(true);
  });

  it("a principal with no grant at all is denied catalogue writes", async () => {
    const strangerId = await makePerson("esc_stranger");
    await expect(
      createAwardType(
        { principal: { personId: strangerId }, at: NOW },
        { code: "X", name: "X", kind: "DIPLOMA", issuingBody: "ORG" },
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("recordSkillProgress — GROUP-scoped, and the student must be a member", () => {
  async function setUpAwardTypeAndActiveSet(suffix: string) {
    const awardTypeId = await makeAwardType(suffix);
    const { gradeIds } = await makeFiveGradeScale(suffix);
    const setId = await makeCriterionSet(awardTypeId, suffix, {
      status: "ACTIVE",
      passFloorGradeId: gradeIds.voldoende,
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    });
    const criterionId = await makeCriterion(setId, suffix, { sequence: 1 });
    return { awardTypeId, criterionId };
  }

  it("an instructor scoped to GROUP A cannot record progress in GROUP B", async () => {
    const { criterionId } =
      await setUpAwardTypeAndActiveSet("esc_write_shared");
    const courseId = await makeCourse("esc_write_course");
    const levelId = await makeCourseLevel(courseId, "esc_write_level");
    const groupA = await makeGroupAtLevel("esc_write_a", levelId);
    const groupB = await makeGroupAtLevel("esc_write_b", levelId);
    const { studentProfileId } = await makeStudent("esc_write_student");
    await placeInGroup(groupB, studentProfileId);

    const instructorId = await makePerson("esc_write_instructor");
    await grantTo({
      personId: instructorId,
      roleId: groupPrincipalRoleId,
      scopeType: "GROUP",
      scopeId: groupA,
    });
    await assignInstructor(admin(), groupA, {
      personId: instructorId,
      fromDate: "2026-01-01",
    });
    const instructor = { principal: { personId: instructorId }, at: NOW };

    // The instructor's reach DOES cover group A (proven by the assignment
    // above) — denied here for group B specifically, not for lack of any
    // reach at all.
    await expect(
      recordSkillProgress(instructor, groupB, {
        studentProfileId,
        criterionId,
        state: "INTRODUCED",
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("a GROUP-scoped instructor cannot record progress for a pupil not in that group (domain refusal, not a guard denial)", async () => {
    const { criterionId } =
      await setUpAwardTypeAndActiveSet("esc_write_domain");
    const courseId = await makeCourse("esc_write_domain_course");
    const levelId = await makeCourseLevel(courseId, "esc_write_domain_level");
    const groupId = await makeGroupAtLevel("esc_write_domain_group", levelId);
    // The student is real but never placed in this group.
    const { studentProfileId } = await makeStudent("esc_write_domain_student");

    const instructorId = await makePerson("esc_write_domain_instructor");
    await grantTo({
      personId: instructorId,
      roleId: groupPrincipalRoleId,
      scopeType: "GROUP",
      scopeId: groupId,
    });
    await assignInstructor(admin(), groupId, {
      personId: instructorId,
      fromDate: "2026-01-01",
    });
    const instructor = { principal: { personId: instructorId }, at: NOW };

    // The GUARD passes (the instructor does reach this group) — the refusal
    // is the domain check, and it must be distinguishable from a denial.
    await expect(
      recordSkillProgress(instructor, groupId, {
        studentProfileId,
        criterionId,
        state: "INTRODUCED",
      }),
    ).rejects.toBeInstanceOf(SkillProgressError);
  });

  it("an ORGANIZATION-scoped principal can record progress in any group", async () => {
    const { criterionId } = await setUpAwardTypeAndActiveSet("esc_write_admin");
    const courseId = await makeCourse("esc_write_admin_course");
    const levelId = await makeCourseLevel(courseId, "esc_write_admin_level");
    const groupId = await makeGroupAtLevel("esc_write_admin_group", levelId);
    const { studentProfileId } = await makeStudent("esc_write_admin_student");
    await placeInGroup(groupId, studentProfileId);

    const created = await recordSkillProgress(admin(), groupId, {
      studentProfileId,
      criterionId,
      state: "ACHIEVED",
    });
    expect(created.id).toBeTruthy();
  });

  it("listCriteriaForGroup denies a principal outside the group and its containing scopes", async () => {
    const { awardTypeId } = await setUpAwardTypeAndActiveSet(
      "esc_criteria_denied",
    );
    const courseId = await makeCourse("esc_criteria_course");
    const levelId = await makeCourseLevel(courseId, "esc_criteria_level", {
      awardTypeId,
    });
    const groupId = await makeGroupAtLevel("esc_criteria_group", levelId);
    const strangerId = await makePerson("esc_criteria_stranger");

    await expect(
      listCriteriaForGroup(
        { principal: { personId: strangerId }, at: NOW },
        groupId,
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("listCriteriaForGroup, for a GROUP-scoped instructor, resolves through Group -> CourseLevel -> AwardType -> ACTIVE CriterionSet", async () => {
    const { awardTypeId, criterionId } = await setUpAwardTypeAndActiveSet(
      "esc_criteria_resolve",
    );
    const courseId = await makeCourse("esc_criteria_resolve_course");
    const levelId = await makeCourseLevel(
      courseId,
      "esc_criteria_resolve_level",
      { awardTypeId },
    );
    const groupId = await makeGroupAtLevel(
      "esc_criteria_resolve_group",
      levelId,
    );
    const instructorId = await makePerson("esc_criteria_resolve_instructor");
    await grantTo({
      personId: instructorId,
      roleId: groupPrincipalRoleId,
      scopeType: "GROUP",
      scopeId: groupId,
    });
    await assignInstructor(admin(), groupId, {
      personId: instructorId,
      fromDate: "2026-01-01",
    });

    const result = await listCriteriaForGroup(
      { principal: { personId: instructorId }, at: NOW },
      groupId,
    );
    expect(result.reason).toBeNull();
    expect(result.criteria.map((c) => c.id)).toEqual([criterionId]);
  });
});

describe("getSkillProgressForStudent — { student }-scoped", () => {
  it("a GROUP-scoped instructor teaching the pupil's group reaches their progress", async () => {
    const awardTypeSuffix = "esc_read_group";
    const awardTypeId = await makeAwardType(awardTypeSuffix);
    const { gradeIds } = await makeFiveGradeScale(awardTypeSuffix);
    const setId = await makeCriterionSet(awardTypeId, awardTypeSuffix, {
      status: "ACTIVE",
      passFloorGradeId: gradeIds.voldoende,
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    });
    const criterionId = await makeCriterion(setId, awardTypeSuffix, {
      sequence: 1,
    });

    const courseId = await makeCourse("esc_read_group_course");
    const levelId = await makeCourseLevel(courseId, "esc_read_group_level", {
      awardTypeId,
    });
    const groupId = await makeGroupAtLevel("esc_read_group_group", levelId);
    const { studentProfileId } = await makeStudent("esc_read_group_student");
    await placeInGroup(groupId, studentProfileId);

    await recordSkillProgress(admin(), groupId, {
      studentProfileId,
      criterionId,
      state: "PRACTISING",
    });

    const instructorId = await makePerson("esc_read_group_instructor");
    await grantTo({
      personId: instructorId,
      roleId: groupPrincipalRoleId,
      scopeType: "GROUP",
      scopeId: groupId,
    });
    await assignInstructor(admin(), groupId, {
      personId: instructorId,
      fromDate: "2026-01-01",
    });

    const entries = await getSkillProgressForStudent(
      { principal: { personId: instructorId }, at: NOW },
      studentProfileId,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.state).toBe("PRACTISING");
  });

  it("a principal with no relation to the pupil at all is denied", async () => {
    const { studentProfileId } = await makeStudent("esc_read_denied_student");
    const strangerId = await makePerson("esc_read_denied_stranger");

    await expect(
      getSkillProgressForStudent(
        { principal: { personId: strangerId }, at: NOW },
        studentProfileId,
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
