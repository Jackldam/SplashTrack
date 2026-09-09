/**
 * Fixtures for the `skills` suites — the `tests/support/courses-fixtures.ts`
 * pattern, one module later.
 *
 * `skills` owns no `ScopeRelations` and no `RelationshipSource` of its own
 * (it asks `groups`, `courses` and `people` for everything it needs — see
 * `src/modules/skills/index.ts`), so {@link installRealRelations} registers
 * the REAL relations of those three modules, exactly as `courses-fixtures.ts`
 * does one module earlier in the DAG.
 */
import { resetScopeRelations } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { resetRelationshipSources } from "@/lib/retention/last-relationship";
import {
  ensureCoursesRegistrations,
  resetCoursesRegistrations,
} from "@/modules/courses";
import {
  ensureGroupsRegistrations,
  resetGroupsRegistrations,
} from "@/modules/groups";
import {
  ensurePeopleRegistrations,
  resetPeopleRegistrations,
} from "@/modules/people";
import {
  ensureSessionsRegistrations,
  resetSessionsRegistrations,
} from "@/modules/sessions";

export const SKILLS_PREFIX = "skillsfx_";

export function sid(suffix: string): string {
  return `${SKILLS_PREFIX}${suffix}`;
}

export function installRealRelations(): void {
  resetScopeRelations();
  resetRelationshipSources();
  resetCoursesRegistrations();
  resetGroupsRegistrations();
  resetSessionsRegistrations();
  resetPeopleRegistrations();
  ensureGroupsRegistrations();
  ensureSessionsRegistrations();
  ensureCoursesRegistrations();
  ensurePeopleRegistrations();
}

/**
 * Drops everything these suites create, in dependency order.
 *
 * `AwardType`, `CriterionSet` and `Criterion` rows created through the
 * SERVICE (`createAwardType`, `createCriterionSet`, `createCriterion`) carry
 * a database-generated `cuid(2)` id, never this file's prefix — unlike every
 * row a fixture helper inserts directly. So these three are cleaned up by
 * `AwardType.code`, the one column every test in this suite is required to
 * prefix by hand (`sid(...)` or an explicit `skillsfx_...` literal), cascaded
 * through the relation rather than each table's own id.
 */
export async function resetSkillsFixtures(): Promise<void> {
  // THE PUPILS GO FIRST, AND NOT BY CHOICE. As of the phase 2.2 decision
  // round the runtime role — which is what `prisma` connects as here — holds
  // NO DELETE on `SkillProgress` (`skillProgressGrantStatements`), so this
  // file can no longer call `skillProgress.deleteMany`. Deleting the fixture
  // `StudentProfile`s instead lets the `onDelete: Cascade` referential action
  // take the progress rows as the table's OWNER — the same mechanism a real
  // erasure relies on, and the same shape `attendance-fixtures.ts` uses. It
  // must happen before `Criterion` (a `Restrict` target of the rows) and
  // before `Group` (ditto, via the `groupId` snapshot) can go.
  await prisma.studentLifecycleEvent.deleteMany({
    where: { studentProfile: { personId: { startsWith: SKILLS_PREFIX } } },
  });
  await prisma.studentProfile.deleteMany({
    where: { personId: { startsWith: SKILLS_PREFIX } },
  });
  await prisma.criterion.deleteMany({
    where: {
      criterionSet: { awardType: { code: { startsWith: SKILLS_PREFIX } } },
    },
  });
  await prisma.criterionSet.deleteMany({
    where: { awardType: { code: { startsWith: SKILLS_PREFIX } } },
  });
  await prisma.gradeValue.deleteMany({
    where: { id: { startsWith: SKILLS_PREFIX } },
  });
  await prisma.gradeScale.deleteMany({
    where: { id: { startsWith: SKILLS_PREFIX } },
  });
  // CourseLevel.awardTypeId is a Restrict FK, so any level pointing at one of
  // these award types must go first.
  await prisma.courseLevel.updateMany({
    where: { awardType: { code: { startsWith: SKILLS_PREFIX } } },
    data: { awardTypeId: null },
  });
  await prisma.awardType.deleteMany({
    where: { code: { startsWith: SKILLS_PREFIX } },
  });

  await prisma.sessionRosterEntry.deleteMany({
    where: { session: { group: { id: { startsWith: SKILLS_PREFIX } } } },
  });
  await prisma.sessionLane.deleteMany({
    where: { session: { group: { id: { startsWith: SKILLS_PREFIX } } } },
  });
  await prisma.scheduledSession.deleteMany({
    where: { groupId: { startsWith: SKILLS_PREFIX } },
  });
  await prisma.sessionRecurrence.deleteMany({
    where: { groupId: { startsWith: SKILLS_PREFIX } },
  });
  await prisma.groupMove.deleteMany({
    where: { toGroupId: { startsWith: SKILLS_PREFIX } },
  });
  await prisma.groupMembership.deleteMany({
    where: { groupId: { startsWith: SKILLS_PREFIX } },
  });
  await prisma.instructorAssignment.deleteMany({
    where: { groupId: { startsWith: SKILLS_PREFIX } },
  });
  await prisma.group.deleteMany({
    where: { id: { startsWith: SKILLS_PREFIX } },
  });
  await prisma.enrolment.deleteMany({
    where: {
      OR: [
        { courseId: { startsWith: SKILLS_PREFIX } },
        { studentProfile: { personId: { startsWith: SKILLS_PREFIX } } },
      ],
    },
  });
  await prisma.courseLevel.deleteMany({
    where: { courseId: { startsWith: SKILLS_PREFIX } },
  });
  await prisma.course.deleteMany({
    where: { id: { startsWith: SKILLS_PREFIX } },
  });
  // Profiles and their lifecycle events already went, at the top — see the
  // comment there for why the order is not free.
  await prisma.roleAssignment.deleteMany({
    where: { personId: { startsWith: SKILLS_PREFIX } },
  });
  await prisma.rolePermission.deleteMany({
    where: { roleId: { startsWith: SKILLS_PREFIX } },
  });
  await prisma.role.deleteMany({
    where: { id: { startsWith: SKILLS_PREFIX } },
  });
  await prisma.permission.deleteMany({
    where: { id: { startsWith: SKILLS_PREFIX } },
  });
  await prisma.person.deleteMany({
    where: { id: { startsWith: SKILLS_PREFIX } },
  });
  await prisma.organizationUnit.deleteMany({
    where: { id: { startsWith: SKILLS_PREFIX } },
  });
}

export async function makeUnit(suffix: string): Promise<string> {
  const id = sid(suffix);
  await prisma.organizationUnit.upsert({
    where: { id },
    update: {},
    create: { id, name: suffix, path: `/${suffix}/`, depth: 0 },
  });
  return id;
}

export async function makePerson(suffix: string): Promise<string> {
  const id = sid(suffix);
  await prisma.person.create({
    data: { id, givenName: "Fixture", familyName: suffix },
  });
  return id;
}

export async function makeStudent(
  suffix: string,
): Promise<{ personId: string; studentProfileId: string }> {
  const personId = await makePerson(suffix);
  const profile = await prisma.studentProfile.create({
    data: {
      id: sid(`sp_${suffix}`),
      personId,
      studentNumber: sid(`L_${suffix}`),
    },
    select: { id: true },
  });
  return { personId, studentProfileId: profile.id };
}

export async function makeCourse(suffix: string): Promise<string> {
  const id = sid(suffix);
  await prisma.course.create({ data: { id, name: `Cursus ${suffix}` } });
  return id;
}

export async function makeCourseLevel(
  courseId: string,
  suffix: string,
  options: { sequence?: number; awardTypeId?: string | null } = {},
): Promise<string> {
  const id = sid(`lvl_${suffix}`);
  await prisma.courseLevel.create({
    data: {
      id,
      courseId,
      name: `Niveau ${suffix}`,
      sequence: options.sequence ?? 1,
      awardTypeId: options.awardTypeId ?? null,
    },
  });
  return id;
}

export async function makeGroupAtLevel(
  suffix: string,
  courseLevelId: string | null,
): Promise<string> {
  const id = sid(suffix);
  await prisma.group.create({
    data: { id, name: `Groep ${suffix}`, courseLevelId },
  });
  return id;
}

/** Places a student in a group, ordinarily active from 2020. */
export async function placeInGroup(
  groupId: string,
  studentProfileId: string,
): Promise<void> {
  await prisma.groupMembership.create({
    data: {
      groupId,
      studentProfileId,
      fromDate: new Date("2020-01-01T00:00:00Z"),
    },
  });
}

export async function makeAwardType(
  suffix: string,
  options: {
    kind?: "DIPLOMA" | "CERTIFICATE";
    issuingBody?: "NRZ" | "ORG";
  } = {},
): Promise<string> {
  const id = sid(suffix);
  await prisma.awardType.create({
    data: {
      id,
      code: sid(`code_${suffix}`),
      name: `Diploma ${suffix}`,
      kind: options.kind ?? "DIPLOMA",
      issuingBody: options.issuingBody ?? "NRZ",
    },
  });
  return id;
}

export async function makeGradeScale(suffix: string): Promise<string> {
  const id = sid(`scale_${suffix}`);
  await prisma.gradeScale.create({
    data: { id, code: sid(`scalecode_${suffix}`), name: `Schaal ${suffix}` },
  });
  return id;
}

export async function makeGradeValue(
  scaleId: string,
  suffix: string,
  rank: number,
): Promise<string> {
  const id = sid(`grade_${suffix}`);
  await prisma.gradeValue.create({
    data: { id, scaleId, code: suffix.toUpperCase(), rank, label: suffix },
  });
  return id;
}

/** A five-point scale — `ONVOLDOENDE`..`ZEER_GOED` — for a single suite's use. */
export async function makeFiveGradeScale(
  suffix: string,
): Promise<{ scaleId: string; gradeIds: Record<string, string> }> {
  const scaleId = await makeGradeScale(suffix);
  const labels = ["onvoldoende", "matig", "voldoende", "goed", "zeergoed"];
  const gradeIds: Record<string, string> = {};
  for (let i = 0; i < labels.length; i++) {
    gradeIds[labels[i]!] = await makeGradeValue(
      scaleId,
      `${suffix}_${labels[i]}`,
      i + 1,
    );
  }
  return { scaleId, gradeIds };
}

export async function makeCriterionSet(
  awardTypeId: string,
  suffix: string,
  options: {
    version?: number;
    source?: "NRZ" | "ORG";
    status?: "DRAFT" | "ACTIVE" | "RETIRED";
    passFloorGradeId?: string | null;
    effectiveFrom?: Date | null;
    effectiveTo?: Date | null;
  } = {},
): Promise<string> {
  const id = sid(`set_${suffix}`);
  await prisma.criterionSet.create({
    data: {
      id,
      awardTypeId,
      version: options.version ?? 1,
      source: options.source ?? "ORG",
      status: options.status ?? "DRAFT",
      passFloorGradeId: options.passFloorGradeId ?? null,
      effectiveFrom: options.effectiveFrom ?? null,
      effectiveTo: options.effectiveTo ?? null,
    },
  });
  return id;
}

export async function makeCriterion(
  criterionSetId: string,
  suffix: string,
  options: { sequence?: number; minimumGradeId?: string | null } = {},
): Promise<string> {
  const id = sid(`crit_${suffix}`);
  await prisma.criterion.create({
    data: {
      id,
      criterionSetId,
      code: suffix.toUpperCase(),
      name: `Eis ${suffix}`,
      sequence: options.sequence ?? 1,
      minimumGradeId: options.minimumGradeId ?? null,
    },
  });
  return id;
}

export async function makeRole(
  suffix: string,
  permissions: readonly string[],
): Promise<string> {
  const roleId = sid(suffix);
  await prisma.role.create({ data: { id: roleId, key: roleId, name: suffix } });
  for (const key of permissions) {
    const permissionId = sid(`perm_${key.replace(/\./g, "_")}`);
    await prisma.permission.upsert({
      where: { id: permissionId },
      update: {},
      create: { id: permissionId, key },
    });
    await prisma.rolePermission.create({ data: { roleId, permissionId } });
  }
  return roleId;
}

export async function grantTo(spec: {
  personId: string;
  roleId: string;
  scopeType: "ORGANIZATION" | "UNIT" | "GROUP" | "COURSE" | "SESSION" | "SELF";
  scopeId?: string | null;
  validFrom?: Date;
  validUntil?: Date | null;
}): Promise<void> {
  await prisma.roleAssignment.create({
    data: {
      personId: spec.personId,
      roleId: spec.roleId,
      scopeType: spec.scopeType,
      scopeId: spec.scopeId ?? null,
      validFrom: spec.validFrom ?? new Date("2020-01-01T00:00:00Z"),
      validUntil: spec.validUntil ?? null,
    },
  });
}

/** Everything an administrator needs across the modules these suites touch. */
export const SKILLS_ADMIN_PERMISSIONS = [
  "skills.read",
  "skills.manage_catalogue",
  "skills.assess",
  "skills.revoke",
  "courses.read",
  "courses.manage",
  "groups.read",
  "groups.manage",
  "groups.assign_members",
] as const;

/** What a GROUP-scoped instructor holds — reading and recording. */
export const GROUP_PRINCIPAL_PERMISSIONS = [
  "skills.read",
  "skills.assess",
  "skills.revoke",
] as const;
