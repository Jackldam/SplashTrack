/**
 * Fixtures for the `courses` suites.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING IS FAKED, ON THE `groups-fixtures.ts` PATTERN
 *
 * `courses` is the module that finally makes a `COURSE` grant mean anything:
 * before it registered, every branch of `coversResource`'s `COURSES` case threw
 * and was converted into a denial (`courses-scope-relations.ts`). So this file
 * registers the REAL relations of `courses`, `groups`, `sessions` and `people` —
 * `groupsOfCourse` needs a real `groupIdsForCourseLevels` to walk `Group ->
 * CourseLevel -> Course`, and the asymmetry test for `sessionsOfCourse` needs a
 * real scheduled lesson to be denied against.
 *
 * REGISTRATION ORDER IS LOAD-BEARING, exactly as in `groups-fixtures.ts`:
 * `configureScopeRelations` MERGES, so {@link installRealRelations} resets first
 * and registers nothing else.
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

/** Everything these suites write carries the prefix, so cleanup is exact. */
export const COURSES_PREFIX = "coursesfx_";

export function cid(suffix: string): string {
  return `${COURSES_PREFIX}${suffix}`;
}

/**
 * Registers the REAL relations of all four modules. No fakes.
 *
 * `people` last is harmless (the modules own disjoint relations), but the reset
 * first is not optional: without it a previous suite's fake survives in the
 * merged registry and shadows the real implementation.
 */
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

/** Drops everything these suites create, in dependency order. */
export async function resetCoursesFixtures(): Promise<void> {
  await prisma.sessionRosterEntry.deleteMany({
    where: { session: { group: { id: { startsWith: COURSES_PREFIX } } } },
  });
  await prisma.sessionLane.deleteMany({
    where: { session: { group: { id: { startsWith: COURSES_PREFIX } } } },
  });
  await prisma.scheduledSession.deleteMany({
    where: { groupId: { startsWith: COURSES_PREFIX } },
  });
  await prisma.sessionRecurrence.deleteMany({
    where: { groupId: { startsWith: COURSES_PREFIX } },
  });
  await prisma.groupMove.deleteMany({
    where: { toGroupId: { startsWith: COURSES_PREFIX } },
  });
  await prisma.groupMembership.deleteMany({
    where: { groupId: { startsWith: COURSES_PREFIX } },
  });
  await prisma.instructorAssignment.deleteMany({
    where: { groupId: { startsWith: COURSES_PREFIX } },
  });
  // Groups reference CourseLevel with a Restrict FK, so they must go before it.
  await prisma.group.deleteMany({
    where: { id: { startsWith: COURSES_PREFIX } },
  });
  await prisma.enrolment.deleteMany({
    where: {
      OR: [
        { courseId: { startsWith: COURSES_PREFIX } },
        { studentProfile: { personId: { startsWith: COURSES_PREFIX } } },
      ],
    },
  });
  await prisma.courseLevel.deleteMany({
    where: { courseId: { startsWith: COURSES_PREFIX } },
  });
  await prisma.course.deleteMany({
    where: { id: { startsWith: COURSES_PREFIX } },
  });
  await prisma.studentLifecycleEvent.deleteMany({
    where: { studentProfile: { personId: { startsWith: COURSES_PREFIX } } },
  });
  await prisma.studentProfile.deleteMany({
    where: { personId: { startsWith: COURSES_PREFIX } },
  });
  await prisma.roleAssignment.deleteMany({
    where: { personId: { startsWith: COURSES_PREFIX } },
  });
  await prisma.rolePermission.deleteMany({
    where: { roleId: { startsWith: COURSES_PREFIX } },
  });
  await prisma.role.deleteMany({
    where: { id: { startsWith: COURSES_PREFIX } },
  });
  await prisma.permission.deleteMany({
    where: { id: { startsWith: COURSES_PREFIX } },
  });
  await prisma.person.deleteMany({
    where: { id: { startsWith: COURSES_PREFIX } },
  });
  await prisma.organizationUnit.deleteMany({
    where: { id: { startsWith: COURSES_PREFIX } },
  });
}

export async function makeUnit(suffix: string): Promise<string> {
  const id = cid(suffix);
  await prisma.organizationUnit.upsert({
    where: { id },
    update: {},
    create: { id, name: suffix, path: `/${suffix}/`, depth: 0 },
  });
  return id;
}

/** A `Person`, with no membership and no pupil record. Staff, typically. */
export async function makePerson(suffix: string): Promise<string> {
  const id = cid(suffix);
  await prisma.person.create({
    data: { id, givenName: "Fixture", familyName: suffix },
  });
  return id;
}

/** A `Person` AND their `StudentProfile`. Returns the profile id. */
export async function makeStudent(
  suffix: string,
  options: { homeUnitId?: string | null } = {},
): Promise<{ personId: string; studentProfileId: string }> {
  const personId = await makePerson(suffix);
  const profile = await prisma.studentProfile.create({
    data: {
      id: cid(`sp_${suffix}`),
      personId,
      studentNumber: cid(`L_${suffix}`),
      unitId: options.homeUnitId ?? null,
    },
    select: { id: true },
  });
  return { personId, studentProfileId: profile.id };
}

export async function makeCourse(
  suffix: string,
  options: { active?: boolean; description?: string | null } = {},
): Promise<string> {
  const id = cid(suffix);
  await prisma.course.create({
    data: {
      id,
      name: `Cursus ${suffix}`,
      description: options.description ?? null,
      active: options.active ?? true,
    },
  });
  return id;
}

export async function makeCourseLevel(
  courseId: string,
  suffix: string,
  options: { sequence?: number } = {},
): Promise<string> {
  const id = cid(`lvl_${suffix}`);
  await prisma.courseLevel.create({
    data: {
      id,
      courseId,
      name: `Niveau ${suffix}`,
      sequence: options.sequence ?? 1,
    },
  });
  return id;
}

/**
 * A `Group` taught at a `CourseLevel` — the join `groupsOfCourse` walks. Raw
 * `prisma.group.create`, on the `groups-fixtures.ts` pattern: this file is not
 * exercising the `groups` module's own write path, only supplying rows for it.
 */
export async function makeGroupAtLevel(
  suffix: string,
  courseLevelId: string | null,
  options: { unitId?: string | null } = {},
): Promise<string> {
  const id = cid(suffix);
  await prisma.group.create({
    data: {
      id,
      name: `Groep ${suffix}`,
      unitId: options.unitId ?? null,
      courseLevelId,
    },
  });
  return id;
}

/** A role carrying real catalogue permissions, prefixed so cleanup is exact. */
export async function makeRole(
  suffix: string,
  permissions: readonly string[],
): Promise<string> {
  const roleId = cid(suffix);
  await prisma.role.create({
    data: { id: roleId, key: roleId, name: suffix },
  });
  for (const key of permissions) {
    const permissionId = cid(`perm_${key.replace(/\./g, "_")}`);
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

/** Everything an administrator needs across all four modules. */
export const COURSES_ADMIN_PERMISSIONS = [
  "courses.read",
  "courses.manage",
  "enrolments.manage",
  "groups.read",
  "groups.manage",
  "groups.assign_members",
  "planning.read",
  "planning.manage",
] as const;

/**
 * What a `COURSE`-scoped internal examiner holds (§2.4) — reading and
 * enrolling within their course, PLUS `groups.read`/`planning.read` so the
 * scope-escape suite can show the asymmetry §2.2 states explicitly: the same
 * grant reaches the course's groups (`groupsOfCourse`) and none of those
 * groups' scheduled lessons (`sessionsOfCourse` is always empty).
 */
export const COURSE_PRINCIPAL_PERMISSIONS = [
  "courses.read",
  "enrolments.manage",
  "groups.read",
  "planning.read",
] as const;

/** A calendar date at UTC midnight, as every `@db.Date` column stores one. */
export function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
