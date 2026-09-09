/**
 * Fixtures for the `attendance` suites — the `tests/support/skills-fixtures.ts`
 * pattern, one module later.
 *
 * `attendance` owns no `ScopeRelations` and no `RelationshipSource` of its own
 * (it asks `sessions` for everything it needs — see
 * `src/modules/attendance/index.ts`), so {@link installRealRelations}
 * registers the REAL relations of `groups`, `sessions` and `people`, exactly
 * as the skills fixtures do for their dependency set.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CLEANUP ORDER IS LOAD-BEARING HERE, MORE THAN IN ANY EARLIER FIXTURE FILE
 *
 * The runtime role — which is what `prisma` connects as in a test — holds NO
 * `DELETE` on `AttendanceEvent` (`attendanceGrantStatements`; that is the
 * property half these suites exist to prove). So this file never calls
 * `attendanceEvent.deleteMany`. Instead it deletes the fixture
 * `StudentProfile`s FIRST: the `onDelete: Cascade` referential action runs
 * with the OWNER's privileges and takes the attendance rows with it — which
 * is also, deliberately, the mechanism a real erasure relies on. Only then
 * can sessions and groups go (both are `Restrict` targets of the events).
 */
import { resetScopeRelations } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { resetRelationshipSources } from "@/lib/retention/last-relationship";
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

export const ATTENDANCE_PREFIX = "attfx_";

export function aid(suffix: string): string {
  return `${ATTENDANCE_PREFIX}${suffix}`;
}

export function installRealRelations(): void {
  resetScopeRelations();
  resetRelationshipSources();
  resetGroupsRegistrations();
  resetSessionsRegistrations();
  resetPeopleRegistrations();
  ensureGroupsRegistrations();
  ensureSessionsRegistrations();
  ensurePeopleRegistrations();
}

/** Drops everything these suites create — see the file comment for the order. */
export async function resetAttendanceFixtures(): Promise<void> {
  // FIRST: the pupils. Cascades their AttendanceEvent, SessionRosterEntry,
  // GroupMembership, GroupMove and StudentLifecycleEvent rows as the table
  // owner — the only way attendance rows leave, since the runtime role holds
  // no DELETE on them.
  await prisma.studentLifecycleEvent.deleteMany({
    where: { studentProfile: { personId: { startsWith: ATTENDANCE_PREFIX } } },
  });
  await prisma.studentProfile.deleteMany({
    where: { personId: { startsWith: ATTENDANCE_PREFIX } },
  });

  // Then the timetable and the group tree.
  await prisma.sessionRosterEntry.deleteMany({
    where: { session: { groupId: { startsWith: ATTENDANCE_PREFIX } } },
  });
  await prisma.scheduledSession.deleteMany({
    where: { groupId: { startsWith: ATTENDANCE_PREFIX } },
  });
  await prisma.sessionRecurrence.deleteMany({
    where: { groupId: { startsWith: ATTENDANCE_PREFIX } },
  });
  await prisma.groupMembership.deleteMany({
    where: { groupId: { startsWith: ATTENDANCE_PREFIX } },
  });
  await prisma.instructorAssignment.deleteMany({
    where: { groupId: { startsWith: ATTENDANCE_PREFIX } },
  });
  await prisma.group.deleteMany({
    where: { id: { startsWith: ATTENDANCE_PREFIX } },
  });

  // Then authorization and identity.
  await prisma.roleAssignment.deleteMany({
    where: { personId: { startsWith: ATTENDANCE_PREFIX } },
  });
  await prisma.rolePermission.deleteMany({
    where: { roleId: { startsWith: ATTENDANCE_PREFIX } },
  });
  await prisma.role.deleteMany({
    where: { id: { startsWith: ATTENDANCE_PREFIX } },
  });
  await prisma.permission.deleteMany({
    where: { id: { startsWith: ATTENDANCE_PREFIX } },
  });
  await prisma.person.deleteMany({
    where: { id: { startsWith: ATTENDANCE_PREFIX } },
  });
  await prisma.organizationUnit.deleteMany({
    where: { id: { startsWith: ATTENDANCE_PREFIX } },
  });
}

export async function makeUnit(suffix: string): Promise<string> {
  const id = aid(suffix);
  await prisma.organizationUnit.upsert({
    where: { id },
    update: {},
    create: { id, name: suffix, path: `/${suffix}/`, depth: 0 },
  });
  return id;
}

export async function makePerson(suffix: string): Promise<string> {
  const id = aid(suffix);
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
      id: aid(`sp_${suffix}`),
      personId,
      studentNumber: aid(`L_${suffix}`),
    },
    select: { id: true },
  });
  return { personId, studentProfileId: profile.id };
}

export async function makeGroup(suffix: string): Promise<string> {
  const id = aid(suffix);
  await prisma.group.create({ data: { id, name: `Groep ${suffix}` } });
  return id;
}

/**
 * One lesson, inserted directly — a fixture's own row, on the `makeGroup`
 * precedent. `occursOn` is the calendar date at UTC midnight, exactly as the
 * generator stores it; the times bracket an ordinary evening lesson.
 */
export async function makeLesson(
  groupId: string,
  suffix: string,
  options: { isoDate?: string; status?: "SCHEDULED" | "CANCELLED" } = {},
): Promise<string> {
  const iso = options.isoDate ?? "2026-03-10";
  const id = aid(`les_${suffix}`);
  await prisma.scheduledSession.create({
    data: {
      id,
      groupId,
      occursOn: new Date(`${iso}T00:00:00.000Z`),
      startsAt: new Date(`${iso}T17:00:00.000Z`),
      endsAt: new Date(`${iso}T17:45:00.000Z`),
      status: options.status ?? "SCHEDULED",
      ...(options.status === "CANCELLED"
        ? {
            cancelledAt: new Date(`${iso}T12:00:00.000Z`),
            cancellationReason: "fixture",
          }
        : {}),
    },
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

/** An instructor ASSIGNMENT — D-145 rule 1's second live requirement. */
export async function assignInstructorTo(
  groupId: string,
  personId: string,
): Promise<void> {
  await prisma.instructorAssignment.create({
    data: {
      groupId,
      personId,
      fromDate: new Date("2020-01-01T00:00:00Z"),
    },
  });
}

/** A guest roster row — D-179's *inhaalles*, without the service ceremony. */
export async function addGuestRow(
  sessionId: string,
  studentProfileId: string,
): Promise<void> {
  await prisma.sessionRosterEntry.create({
    data: { sessionId, studentProfileId, source: "GUEST", reason: "inhaal" },
  });
}

export async function makeRole(
  suffix: string,
  permissions: readonly string[],
): Promise<string> {
  const roleId = aid(suffix);
  await prisma.role.create({ data: { id: roleId, key: roleId, name: suffix } });
  for (const key of permissions) {
    const permissionId = aid(`perm_${key.replace(/\./g, "_")}`);
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

/** Everything an ORGANIZATION-scoped administrator needs in these suites. */
export const ATTENDANCE_ADMIN_PERMISSIONS = [
  "attendance.read",
  "attendance.record",
  "attendance.amend",
  "groups.read",
  "planning.read",
] as const;

/** What a `GROUP`-scoped instructor holds — reading and recording. */
export const INSTRUCTOR_ATTENDANCE_PERMISSIONS = [
  "attendance.read",
  "attendance.record",
  "attendance.amend",
] as const;
