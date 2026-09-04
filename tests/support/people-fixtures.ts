/**
 * Fixtures for the `people` module's suites.
 *
 * DIFFERENT FROM `authorization-fixtures.ts` IN ONE IMPORTANT WAY. That file
 * had to fake every domain relation, because no domain module existed. Here the
 * three relations this module OWNS are real — `unitOfPerson` reads a real
 * `Membership.unitId`, `homeUnitOfStudent` a real `StudentProfile.unitId` — and
 * only the relations belonging to `groups`, `sessions` and `courses` are still
 * fakes.
 *
 * `installRelations` gets that ordering right, and it is the ordering that
 * matters: `configureScopeRelations` MERGES, so the people module must register
 * LAST or the fake's answers would shadow the real ones and the suite would be
 * testing the fixture.
 */
import {
  configureScopeRelations,
  resetScopeRelations,
} from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { resetRelationshipSources } from "@/lib/retention/last-relationship";
import {
  ensurePeopleRegistrations,
  resetPeopleRegistrations,
} from "@/modules/people";

import { relationsFor, type FakeWorld } from "./authorization-fixtures";

/** Everything these suites write carries the prefix, so cleanup is exact. */
export const PEOPLE_PREFIX = "peoplefx_";

export function pid(suffix: string): string {
  return `${PEOPLE_PREFIX}${suffix}`;
}

/**
 * Registers the fake relations for the modules that do not exist, then the REAL
 * ones this module owns. Order is the point — see the file header.
 */
export function installRelations(world: FakeWorld): void {
  resetScopeRelations();
  resetRelationshipSources();
  resetPeopleRegistrations();
  configureScopeRelations(relationsFor(world));
  ensurePeopleRegistrations();
}

/** Drops everything the people suites create, in dependency order. */
export async function resetPeopleFixtures(): Promise<void> {
  await prisma.personRelationship.deleteMany({
    where: {
      OR: [
        { fromPersonId: { startsWith: PEOPLE_PREFIX } },
        { toPersonId: { startsWith: PEOPLE_PREFIX } },
      ],
    },
  });
  await prisma.studentLifecycleEvent.deleteMany({
    where: { studentProfile: { personId: { startsWith: PEOPLE_PREFIX } } },
  });
  await prisma.studentProfile.deleteMany({
    where: { personId: { startsWith: PEOPLE_PREFIX } },
  });
  await prisma.membershipPeriod.deleteMany({
    where: { membership: { personId: { startsWith: PEOPLE_PREFIX } } },
  });
  await prisma.membership.deleteMany({
    where: { personId: { startsWith: PEOPLE_PREFIX } },
  });
  await prisma.roleAssignment.deleteMany({
    where: { personId: { startsWith: PEOPLE_PREFIX } },
  });
  await prisma.rolePermission.deleteMany({
    where: { roleId: { startsWith: PEOPLE_PREFIX } },
  });
  await prisma.role.deleteMany({
    where: { id: { startsWith: PEOPLE_PREFIX } },
  });
  await prisma.permission.deleteMany({
    where: { id: { startsWith: PEOPLE_PREFIX } },
  });
  await prisma.person.deleteMany({
    where: { id: { startsWith: PEOPLE_PREFIX } },
  });
  await prisma.organizationUnit.deleteMany({
    where: { id: { startsWith: PEOPLE_PREFIX } },
  });
}

export async function makeUnit(suffix: string): Promise<string> {
  const id = pid(suffix);
  await prisma.organizationUnit.upsert({
    where: { id },
    update: {},
    create: { id, name: suffix, path: `/${suffix}/`, depth: 0 },
  });
  return id;
}

export interface MakePersonOptions {
  dateOfBirth?: Date | null;
  /** Give them a membership in this unit, with an open period. */
  memberOfUnit?: string | null;
  /** Give them a pupil record whose HOME unit is this. */
  studentOfUnit?: string | null;
}

/** A `Person`, optionally with a membership and/or a pupil record. */
export async function makePerson(
  suffix: string,
  options: MakePersonOptions = {},
): Promise<string> {
  const id = pid(suffix);
  await prisma.person.create({
    data: {
      id,
      givenName: "Fixture",
      familyName: suffix,
      dateOfBirth: options.dateOfBirth ?? null,
    },
  });

  if (options.memberOfUnit !== undefined) {
    await prisma.membership.create({
      data: {
        personId: id,
        memberNumber: `${PEOPLE_PREFIX}${suffix}`,
        unitId: options.memberOfUnit,
        periods: { create: { startedAt: new Date("2020-01-01T00:00:00Z") } },
      },
    });
  }

  if (options.studentOfUnit !== undefined) {
    await prisma.studentProfile.create({
      data: {
        personId: id,
        studentNumber: `${PEOPLE_PREFIX}s_${suffix}`,
        unitId: options.studentOfUnit,
      },
    });
  }

  return id;
}

/** A role carrying real catalogue permissions, prefixed so cleanup is exact. */
export async function makeRole(
  suffix: string,
  permissions: readonly string[],
): Promise<string> {
  const roleId = pid(suffix);
  await prisma.role.create({
    data: { id: roleId, key: roleId, name: suffix },
  });
  for (const key of permissions) {
    const permissionId = pid(`perm_${key.replace(/\./g, "_")}`);
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

/** Every permission this module's services check, for an administrator role. */
export const PEOPLE_ADMIN_PERMISSIONS = [
  "people.read",
  "people.create",
  "people.update",
  "students.create",
  "students.update",
] as const;
