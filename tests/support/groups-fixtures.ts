/**
 * Fixtures for the `groups` and `sessions` suites.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING IS FAKED ANY MORE, AND THAT IS THE POINT OF THIS FILE
 *
 * `authorization-fixtures.ts` had to fake every domain relation, because no
 * domain module existed: it proved the MECHANISM honours a lapsed relation, and
 * said so. `people-fixtures.ts` made three of them real.
 *
 * These two modules own the six that D-145 rule 1 and D-179 actually turn into
 * access decisions — `activeInstructorGroupIds`, `isActiveGroupMember`,
 * `unitOfGroup`, `groupOfSession`, `isOnSessionRoster`, `sessionDate` — so this
 * file registers the REAL implementations, against real rows, in a real
 * Postgres. The only relations still on the throwing default are the four the
 * `courses` module will own, and a test that needed one would be testing a
 * module nobody has built.
 *
 * That matters for what the suite can claim. "An instructor whose assignment has
 * ended can no longer read that group's pupils" is now a statement about the
 * query that will run in production, not about a stand-in.
 *
 * REGISTRATION ORDER IS LOAD-BEARING. `configureScopeRelations` MERGES, so the
 * modules must register after any fake or the fake's answers shadow the real
 * ones and the suite tests the fixture. {@link installRealRelations} resets
 * first and registers nothing else.
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

/** Everything these suites write carries the prefix, so cleanup is exact. */
export const GROUPS_PREFIX = "groupsfx_";

export function gid(suffix: string): string {
  return `${GROUPS_PREFIX}${suffix}`;
}

/**
 * Registers the REAL relations of all three modules. No fakes.
 *
 * `people` last is harmless here (the three modules own disjoint relations), but
 * the reset first is not optional: without it a previous suite's fake survives
 * in the merged registry and shadows the real implementation.
 */
export function installRealRelations(): void {
  resetScopeRelations();
  resetRelationshipSources();
  resetPeopleRegistrations();
  resetGroupsRegistrations();
  resetSessionsRegistrations();
  ensureGroupsRegistrations();
  ensureSessionsRegistrations();
  ensurePeopleRegistrations();
}

/** Drops everything these suites create, in dependency order. */
export async function resetGroupsFixtures(): Promise<void> {
  await prisma.sessionRosterEntry.deleteMany({
    where: { session: { group: { id: { startsWith: GROUPS_PREFIX } } } },
  });
  await prisma.sessionLane.deleteMany({
    where: { session: { group: { id: { startsWith: GROUPS_PREFIX } } } },
  });
  await prisma.scheduledSession.deleteMany({
    where: { groupId: { startsWith: GROUPS_PREFIX } },
  });
  await prisma.sessionRecurrence.deleteMany({
    where: { groupId: { startsWith: GROUPS_PREFIX } },
  });
  await prisma.scheduleException.deleteMany({
    where: {
      OR: [
        { groupId: { startsWith: GROUPS_PREFIX } },
        { reason: { startsWith: GROUPS_PREFIX } },
      ],
    },
  });
  await prisma.groupMove.deleteMany({
    where: { toGroupId: { startsWith: GROUPS_PREFIX } },
  });
  await prisma.groupMembership.deleteMany({
    where: { groupId: { startsWith: GROUPS_PREFIX } },
  });
  await prisma.instructorAssignment.deleteMany({
    where: { groupId: { startsWith: GROUPS_PREFIX } },
  });
  await prisma.lane.deleteMany({
    where: { poolId: { startsWith: GROUPS_PREFIX } },
  });
  await prisma.pool.deleteMany({
    where: { id: { startsWith: GROUPS_PREFIX } },
  });
  await prisma.group.deleteMany({
    where: { id: { startsWith: GROUPS_PREFIX } },
  });
  await prisma.studentLifecycleEvent.deleteMany({
    where: { studentProfile: { personId: { startsWith: GROUPS_PREFIX } } },
  });
  await prisma.studentProfile.deleteMany({
    where: { personId: { startsWith: GROUPS_PREFIX } },
  });
  await prisma.roleAssignment.deleteMany({
    where: { personId: { startsWith: GROUPS_PREFIX } },
  });
  await prisma.rolePermission.deleteMany({
    where: { roleId: { startsWith: GROUPS_PREFIX } },
  });
  await prisma.role.deleteMany({
    where: { id: { startsWith: GROUPS_PREFIX } },
  });
  await prisma.permission.deleteMany({
    where: { id: { startsWith: GROUPS_PREFIX } },
  });
  await prisma.person.deleteMany({
    where: { id: { startsWith: GROUPS_PREFIX } },
  });
  await prisma.organizationUnit.deleteMany({
    where: { id: { startsWith: GROUPS_PREFIX } },
  });
}

export async function makeUnit(suffix: string): Promise<string> {
  const id = gid(suffix);
  await prisma.organizationUnit.upsert({
    where: { id },
    update: {},
    create: { id, name: suffix, path: `/${suffix}/`, depth: 0 },
  });
  return id;
}

/** A `Person`, with no membership and no pupil record. Staff, typically. */
export async function makePerson(suffix: string): Promise<string> {
  const id = gid(suffix);
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
      id: gid(`sp_${suffix}`),
      personId,
      studentNumber: gid(`L_${suffix}`),
      unitId: options.homeUnitId ?? null,
    },
    select: { id: true },
  });
  return { personId, studentProfileId: profile.id };
}

export async function makeGroup(
  suffix: string,
  options: { capacity?: number | null; unitId?: string | null } = {},
): Promise<string> {
  const id = gid(suffix);
  await prisma.group.create({
    data: {
      id,
      name: `Groep ${suffix}`,
      capacity: options.capacity ?? null,
      unitId: options.unitId ?? null,
    },
  });
  return id;
}

export async function makePool(suffix: string): Promise<string> {
  const id = gid(suffix);
  await prisma.pool.create({
    data: { id, name: `Bad ${suffix}`, lengthMetres: 25 },
  });
  return id;
}

/** A role carrying real catalogue permissions, prefixed so cleanup is exact. */
export async function makeRole(
  suffix: string,
  permissions: readonly string[],
): Promise<string> {
  const roleId = gid(suffix);
  await prisma.role.create({
    data: { id: roleId, key: roleId, name: suffix },
  });
  for (const key of permissions) {
    const permissionId = gid(`perm_${key.replace(/\./g, "_")}`);
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

/**
 * Everything an administrator needs across both modules.
 *
 * `planning.*` and not a `sessions.*` key: §2.5's catalogue has no permission
 * for scheduled sessions, and inventing one in a fixture would be worse than
 * inventing one in the module — it would make the suite pass against a
 * permission production does not have.
 */
export const GROUPS_ADMIN_PERMISSIONS = [
  "groups.read",
  "groups.manage",
  "groups.assign_members",
  "planning.read",
  "planning.manage",
] as const;

/** What a `GROUP`-scoped instructor holds. Never `groups.manage`. */
export const INSTRUCTOR_PERMISSIONS = [
  "groups.read",
  "groups.assign_members",
  "planning.read",
] as const;

/** A calendar date at UTC midnight, as every `@db.Date` column stores one. */
export function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
