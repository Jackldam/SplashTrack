/**
 * Fixtures for the scope/reach suite.
 *
 * TWO HALVES, and the split is deliberate.
 *
 * 1. **Grants are real rows.** Every `RoleAssignment`, `Role`, `Permission` and
 *    `RoleAssignment` window in these tests is written to the real Postgres and
 *    read back by the real `resolveReach`. The validity window, the CHECK
 *    constraints and the permission join are all exercised against the database
 *    that will run them.
 *
 * 2. **Domain relations are a fake, and they must be.** `GroupMembership`,
 *    `InstructorAssignment`, `ScheduledSession`, `SessionRosterEntry`,
 *    `Enrolment` and `StudentProfile` belong to the domain modules and do not
 *    exist yet — this pass builds the mechanisms and the tables that use them
 *    arrive later. The mechanism declares what it must know
 *    (`ScopeRelations`); this file supplies a truthful in-memory model of it,
 *    driven by explicit intervals so that "the assignment ended" is a fact the
 *    test states rather than a mock that returns a different value the second
 *    time.
 *
 *    What that proves and what it does not: it proves the MECHANISM honours a
 *    relation that has lapsed. It does not prove any module's own query is
 *    right — that is the per-module scope-escape suite `06-delivery.md` §2.1
 *    requires, which arrives with each module and asserts on the FIELDS
 *    returned as well as on reachability.
 */
import type {
  PermissionKey,
  ScopeRelations,
  ScopeType,
} from "@/lib/authorization";
import { prisma } from "@/lib/database";

// ---------------------------------------------------------------------------
// The in-memory domain the port answers from
// ---------------------------------------------------------------------------

/** A half-open interval `[from, to)`. `to: null` means "still open". */
export interface Interval {
  readonly from: Date;
  readonly to: Date | null;
}

const OPEN: Interval = { from: new Date("2000-01-01T00:00:00Z"), to: null };

function active(interval: Interval, at: Date): boolean {
  return at >= interval.from && (interval.to === null || at < interval.to);
}

export interface FakeWorld {
  /** groupId → unitId */
  groupUnit: Map<string, string>;
  /** personId → [{ groupId, interval }] — the `InstructorAssignment` table */
  instructorAssignments: {
    personId: string;
    groupId: string;
    interval: Interval;
  }[];
  /** the `GroupMembership` table */
  groupMemberships: {
    groupId: string;
    studentProfileId: string;
    interval: Interval;
  }[];
  /** sessionId → groupId */
  sessionGroup: Map<string, string>;
  /** sessionId → the instant it takes place */
  sessionDate: Map<string, Date>;
  /** the `SessionRosterEntry` table, guests included (D-179) */
  rosters: {
    sessionId: string;
    studentProfileId: string;
    interval: Interval;
  }[];
  /** courseId → groupIds */
  courseGroups: Map<string, string[]>;
  /** courseId → sessionIds */
  courseSessions: Map<string, string[]>;
  /** the `Enrolment` table */
  enrolments: {
    courseId: string;
    studentProfileId: string;
    interval: Interval;
  }[];
  /** courseId → end date */
  courseEnd: Map<string, Date>;
  /** studentProfileId → personId */
  studentPerson: Map<string, string>;
  /** personId → the unit of their `Membership` */
  personUnit: Map<string, string>;
}

export function emptyWorld(): FakeWorld {
  return {
    groupUnit: new Map(),
    instructorAssignments: [],
    groupMemberships: [],
    sessionGroup: new Map(),
    sessionDate: new Map(),
    rosters: [],
    courseGroups: new Map(),
    courseSessions: new Map(),
    enrolments: [],
    courseEnd: new Map(),
    studentPerson: new Map(),
    personUnit: new Map(),
  };
}

/** A `ScopeRelations` implementation reading the world. */
export function relationsFor(world: FakeWorld): ScopeRelations {
  return {
    activeInstructorGroupIds: async (personId, at) =>
      world.instructorAssignments
        .filter((a) => a.personId === personId && active(a.interval, at))
        .map((a) => a.groupId),
    isActiveGroupMember: async ({ groupId, studentProfileId, at }) =>
      world.groupMemberships.some(
        (m) =>
          m.groupId === groupId &&
          m.studentProfileId === studentProfileId &&
          active(m.interval, at),
      ),
    homeUnitOfStudent: async (studentProfileId) => {
      const person = world.studentPerson.get(studentProfileId);
      return person ? (world.personUnit.get(person) ?? null) : null;
    },
    unitOfGroup: async (groupId) => world.groupUnit.get(groupId) ?? null,
    unitOfPerson: async (personId) => world.personUnit.get(personId) ?? null,
    groupOfSession: async (sessionId) =>
      world.sessionGroup.get(sessionId) ?? null,
    isOnSessionRoster: async ({ sessionId, studentProfileId, at }) =>
      world.rosters.some(
        (r) =>
          r.sessionId === sessionId &&
          r.studentProfileId === studentProfileId &&
          active(r.interval, at),
      ),
    isEnrolledInCourse: async ({ courseId, studentProfileId, at }) =>
      world.enrolments.some(
        (e) =>
          e.courseId === courseId &&
          e.studentProfileId === studentProfileId &&
          active(e.interval, at),
      ),
    groupsOfCourse: async (courseId) => world.courseGroups.get(courseId) ?? [],
    sessionsOfCourse: async (courseId) =>
      world.courseSessions.get(courseId) ?? [],
    personOfStudent: async (studentProfileId) =>
      world.studentPerson.get(studentProfileId) ?? null,
    sessionDate: async (sessionId) => world.sessionDate.get(sessionId) ?? null,
    courseEndDate: async (courseId) => world.courseEnd.get(courseId) ?? null,
  };
}

/** An always-open interval, for facts a test does not want to time-box. */
export const ALWAYS: Interval = OPEN;

/** `[from, to)` — the shape every time-bounded domain row in this design has. */
export function between(from: string, to: string | null): Interval {
  return { from: new Date(from), to: to === null ? null : new Date(to) };
}

// ---------------------------------------------------------------------------
// Real rows
// ---------------------------------------------------------------------------

/** Everything this suite writes carries the prefix, so cleanup is exact. */
export const FIXTURE_PREFIX = "authzfx_";

export function id(suffix: string): string {
  return `${FIXTURE_PREFIX}${suffix}`;
}

export async function resetAuthorizationFixtures(): Promise<void> {
  await prisma.roleAssignment.deleteMany({
    where: { personId: { startsWith: FIXTURE_PREFIX } },
  });
  await prisma.rolePermission.deleteMany({
    where: { roleId: { startsWith: FIXTURE_PREFIX } },
  });
  await prisma.role.deleteMany({
    where: { id: { startsWith: FIXTURE_PREFIX } },
  });
  await prisma.permission.deleteMany({
    where: { id: { startsWith: FIXTURE_PREFIX } },
  });
  await prisma.person.deleteMany({
    where: { id: { startsWith: FIXTURE_PREFIX } },
  });
}

export async function createPerson(suffix: string): Promise<string> {
  const personId = id(suffix);
  await prisma.person.create({
    data: { id: personId, givenName: "Fixture", familyName: suffix },
  });
  return personId;
}

/**
 * A role carrying exactly these permissions.
 *
 * The keys are REAL catalogue keys (`@/lib/authorization`'s `PermissionKey`),
 * not fixture inventions, so `resolveReach` is called with the same values
 * production will pass and no test needs a cast to reach it. Only the row IDs
 * carry the fixture prefix, which is what cleanup keys on — the real catalogue
 * is seeded by the roles module, which does not exist yet.
 */
export async function createRole(
  suffix: string,
  permissions: readonly PermissionKey[],
): Promise<string> {
  const roleId = id(suffix);
  await prisma.role.create({
    data: { id: roleId, key: roleId, name: suffix },
  });
  for (const key of permissions) {
    const permissionId = id(`perm_${key.replace(/\./g, "_")}`);
    await prisma.permission.upsert({
      where: { id: permissionId },
      update: {},
      create: { id: permissionId, key },
    });
    await prisma.rolePermission.create({ data: { roleId, permissionId } });
  }
  return roleId;
}

export interface GrantSpec {
  personId: string;
  roleId: string;
  scopeType: ScopeType;
  scopeId?: string | null;
  validFrom?: Date;
  validUntil?: Date | null;
  grantedByPersonId?: string | null;
}

export async function grant(spec: GrantSpec): Promise<string> {
  const row = await prisma.roleAssignment.create({
    data: {
      personId: spec.personId,
      roleId: spec.roleId,
      scopeType: spec.scopeType,
      scopeId: spec.scopeId ?? null,
      validFrom: spec.validFrom ?? new Date("2020-01-01T00:00:00Z"),
      validUntil: spec.validUntil ?? null,
      grantedByPersonId: spec.grantedByPersonId ?? null,
    },
  });
  return row.id;
}
