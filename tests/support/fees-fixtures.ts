/**
 * Fixtures for the `fees` suites — the `tests/support/exams-fixtures.ts`
 * pattern, one module later.
 *
 * `fees` owns no `ScopeRelations` of its own (it asks nobody for anything —
 * `{ person }`/`{ student }`/`{ organization }` coverage is resolved entirely
 * from relations `people`/`groups` already own), so {@link installRealRelations}
 * registers the REAL relations of both, on the `exams-fixtures.ts` precedent —
 * needed here for the same reason: a GROUP-scoped scope-escape case needs a
 * real `isActiveGroupMember`, and a UNIT-scoped one needs a real
 * `homeUnitOfStudent`/`unitOfPerson`.
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

import { retentionClient } from "./database-roles";

export const FEES_PREFIX = "feesfx_";

export function feid(suffix: string): string {
  return `${FEES_PREFIX}${suffix}`;
}

export function installRealRelations(): void {
  resetScopeRelations();
  resetRelationshipSources();
  resetGroupsRegistrations();
  resetPeopleRegistrations();
  ensureGroupsRegistrations();
  ensurePeopleRegistrations();
}

/**
 * Drops everything these suites create.
 *
 * `Payment`/`Charge` are deleted through the RETENTION role, never the
 * ordinary `prisma` (runtime) client: `feesGrantStatements` gives the
 * runtime role no `DELETE` on either table (the append-only carve-out this
 * module's own suites exist to prove), and — unlike `exams`'s tables —
 * neither cascades from `StudentProfile`, because `Charge.studentProfileId`/
 * `payerPersonId` are deliberately `SetNull` rather than `Cascade` (D-092's
 * pseudonymisation depends on the row surviving). A retention-role delete is
 * therefore the only cleanup path, and it is also the module's real one
 * (`docs/build/phase-3.3-fees-report.md` — the future prune this file's own
 * comment anticipates).
 */
export async function resetFeesFixtures(): Promise<void> {
  const retention = retentionClient();
  await retention.payment.deleteMany({
    where: { charge: { clientEventId: { startsWith: FEES_PREFIX } } },
  });
  await retention.charge.deleteMany({
    where: { clientEventId: { startsWith: FEES_PREFIX } },
  });
  await retention.$disconnect();

  await prisma.feeType.deleteMany({
    where: { code: { startsWith: FEES_PREFIX } },
  });

  await prisma.groupMembership.deleteMany({
    where: { groupId: { startsWith: FEES_PREFIX } },
  });
  await prisma.instructorAssignment.deleteMany({
    where: { groupId: { startsWith: FEES_PREFIX } },
  });
  await prisma.group.deleteMany({ where: { id: { startsWith: FEES_PREFIX } } });

  await prisma.studentLifecycleEvent.deleteMany({
    where: { studentProfile: { personId: { startsWith: FEES_PREFIX } } },
  });
  await prisma.studentProfile.deleteMany({
    where: { personId: { startsWith: FEES_PREFIX } },
  });
  await prisma.membershipPeriod.deleteMany({
    where: { membership: { personId: { startsWith: FEES_PREFIX } } },
  });
  await prisma.membership.deleteMany({
    where: { personId: { startsWith: FEES_PREFIX } },
  });

  await prisma.roleAssignment.deleteMany({
    where: { personId: { startsWith: FEES_PREFIX } },
  });
  await prisma.rolePermission.deleteMany({
    where: { roleId: { startsWith: FEES_PREFIX } },
  });
  await prisma.role.deleteMany({ where: { id: { startsWith: FEES_PREFIX } } });
  await prisma.permission.deleteMany({
    where: { id: { startsWith: FEES_PREFIX } },
  });
  await prisma.person.deleteMany({
    where: { id: { startsWith: FEES_PREFIX } },
  });
  await prisma.organizationUnit.deleteMany({
    where: { id: { startsWith: FEES_PREFIX } },
  });
}

export async function makeUnit(suffix: string): Promise<string> {
  const id = feid(suffix);
  await prisma.organizationUnit.upsert({
    where: { id },
    update: {},
    create: { id, name: suffix, path: `/${suffix}/`, depth: 0 },
  });
  return id;
}

export interface MakePersonOptions {
  /** Give them a membership in this unit, with an open period. */
  memberOfUnit?: string | null;
}

export async function makePerson(
  suffix: string,
  options: MakePersonOptions = {},
): Promise<string> {
  const id = feid(suffix);
  await prisma.person.create({
    data: { id, givenName: "Fixture", familyName: suffix },
  });

  if (options.memberOfUnit !== undefined) {
    await prisma.membership.create({
      data: {
        personId: id,
        memberNumber: feid(`mem_${suffix}`),
        unitId: options.memberOfUnit,
        periods: { create: { startedAt: new Date("2020-01-01T00:00:00Z") } },
      },
    });
  }

  return id;
}

export async function makeStudent(
  suffix: string,
  options: { unitId?: string | null } = {},
): Promise<{ personId: string; studentProfileId: string }> {
  const personId = await makePerson(suffix);
  const profile = await prisma.studentProfile.create({
    data: {
      id: feid(`sp_${suffix}`),
      personId,
      studentNumber: feid(`L_${suffix}`),
      unitId: options.unitId ?? null,
    },
    select: { id: true },
  });
  return { personId, studentProfileId: profile.id };
}

export async function makeGroup(suffix: string): Promise<string> {
  const id = feid(suffix);
  await prisma.group.create({ data: { id, name: `Groep ${suffix}` } });
  return id;
}

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

export async function assignInstructorTo(
  groupId: string,
  personId: string,
): Promise<void> {
  await prisma.instructorAssignment.create({
    data: { groupId, personId, fromDate: new Date("2020-01-01T00:00:00Z") },
  });
}

export async function makeFeeType(
  suffix: string,
  options: {
    amount?: number;
    recurrence?: "PERIODIC" | "ONE_OFF";
    active?: boolean;
  } = {},
): Promise<string> {
  const id = feid(suffix);
  await prisma.feeType.create({
    data: {
      id,
      code: feid(`code_${suffix}`),
      name: `Fee ${suffix}`,
      amount: options.amount ?? 1000,
      recurrence: options.recurrence ?? "ONE_OFF",
      active: options.active ?? true,
    },
  });
  return id;
}

export async function makeRole(
  suffix: string,
  permissions: readonly string[],
): Promise<string> {
  const roleId = feid(suffix);
  await prisma.role.create({ data: { id: roleId, key: roleId, name: suffix } });
  for (const key of permissions) {
    // Reuse an already-seeded permission by KEY where one exists (the real
    // catalogue), on the `exams-fixtures.ts` `makeRole` precedent — avoids
    // colliding with `Permission.key`'s unique constraint.
    const existing = await prisma.permission.findUnique({
      where: { key },
      select: { id: true },
    });
    const permissionId =
      existing?.id ??
      (
        await prisma.permission.create({
          data: { id: feid(`perm_${key.replace(/\./g, "_")}`), key },
          select: { id: true },
        })
      ).id;
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

/** Everything an ORGANIZATION-scoped fees administrator needs in these
 * suites. */
export const FEES_ADMIN_PERMISSIONS = [
  "fees.read",
  "fees.manage",
  "fees.export",
] as const;
