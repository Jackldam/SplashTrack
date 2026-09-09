/**
 * Fixtures for the `assessment` suites — the `tests/support/attendance-fixtures.ts`
 * pattern, combined with the `skills-fixtures.ts` catalogue helpers this
 * module's writes are pinned against (D-081).
 *
 * `assessment` owns no `ScopeRelations` and no `RelationshipSource` of its own
 * (it asks `groups`, `sessions`, `skills` and `people` for everything it
 * needs — see `src/modules/assessment/index.ts`), so
 * {@link installRealRelations} registers the REAL relations of all four,
 * exactly as `attendance-fixtures.ts` does for its own dependency set.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CLEANUP ORDER IS LOAD-BEARING — THE ATTENDANCE/SKILLS PRECEDENT, TWICE OVER
 *
 * The runtime role holds NO `DELETE` on `Assessment`, `AssessmentCriterionResult`
 * or `CriterionWaiver` (`assessmentGrantStatements` — the property this
 * module's own append-only suite exists to prove). So this file never calls
 * any of those three `deleteMany`. Instead it deletes the fixture
 * `StudentProfile`s FIRST: `Assessment.studentProfileId` is `onDelete: Cascade`,
 * which runs with the OWNER's privileges and takes the assessment rows —
 * and `AssessmentCriterionResult`/`CriterionWaiver` cascade from `Assessment`
 * in turn. Only then can `CriterionSet`/`Criterion` (`Restrict` targets) and
 * `Group`/`ScheduledSession` go.
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

export const ASSESSMENT_PREFIX = "assessfx_";

export function asid(suffix: string): string {
  return `${ASSESSMENT_PREFIX}${suffix}`;
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
export async function resetAssessmentFixtures(): Promise<void> {
  await prisma.studentLifecycleEvent.deleteMany({
    where: { studentProfile: { personId: { startsWith: ASSESSMENT_PREFIX } } },
  });
  await prisma.studentProfile.deleteMany({
    where: { personId: { startsWith: ASSESSMENT_PREFIX } },
  });

  await prisma.criterion.deleteMany({
    where: {
      criterionSet: { awardType: { code: { startsWith: ASSESSMENT_PREFIX } } },
    },
  });
  await prisma.criterionSet.deleteMany({
    where: { awardType: { code: { startsWith: ASSESSMENT_PREFIX } } },
  });
  await prisma.gradeValue.deleteMany({
    where: { id: { startsWith: ASSESSMENT_PREFIX } },
  });
  await prisma.gradeScale.deleteMany({
    where: { id: { startsWith: ASSESSMENT_PREFIX } },
  });
  await prisma.awardType.deleteMany({
    where: { code: { startsWith: ASSESSMENT_PREFIX } },
  });

  await prisma.sessionRosterEntry.deleteMany({
    where: { session: { groupId: { startsWith: ASSESSMENT_PREFIX } } },
  });
  await prisma.scheduledSession.deleteMany({
    where: { groupId: { startsWith: ASSESSMENT_PREFIX } },
  });
  await prisma.groupMembership.deleteMany({
    where: { groupId: { startsWith: ASSESSMENT_PREFIX } },
  });
  await prisma.instructorAssignment.deleteMany({
    where: { groupId: { startsWith: ASSESSMENT_PREFIX } },
  });
  await prisma.group.deleteMany({
    where: { id: { startsWith: ASSESSMENT_PREFIX } },
  });

  await prisma.roleAssignment.deleteMany({
    where: { personId: { startsWith: ASSESSMENT_PREFIX } },
  });
  await prisma.rolePermission.deleteMany({
    where: { roleId: { startsWith: ASSESSMENT_PREFIX } },
  });
  await prisma.role.deleteMany({
    where: { id: { startsWith: ASSESSMENT_PREFIX } },
  });
  await prisma.permission.deleteMany({
    where: { id: { startsWith: ASSESSMENT_PREFIX } },
  });
  await prisma.person.deleteMany({
    where: { id: { startsWith: ASSESSMENT_PREFIX } },
  });
  await prisma.organizationUnit.deleteMany({
    where: { id: { startsWith: ASSESSMENT_PREFIX } },
  });
}

export async function makePerson(suffix: string): Promise<string> {
  const id = asid(suffix);
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
      id: asid(`sp_${suffix}`),
      personId,
      studentNumber: asid(`L_${suffix}`),
    },
    select: { id: true },
  });
  return { personId, studentProfileId: profile.id };
}

export async function makeGroup(suffix: string): Promise<string> {
  const id = asid(suffix);
  await prisma.group.create({ data: { id, name: `Groep ${suffix}` } });
  return id;
}

/** One lesson, inserted directly — the `attendance-fixtures.ts` precedent. */
export async function makeLesson(
  groupId: string,
  suffix: string,
  options: { isoDate?: string; status?: "SCHEDULED" | "CANCELLED" } = {},
): Promise<string> {
  const iso = options.isoDate ?? "2026-06-10";
  const id = asid(`les_${suffix}`);
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

/** An instructor ASSIGNMENT — what D-085's independence check reads. */
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

/** A guest roster row — how a candidate from another group reaches a session. */
export async function addGuestRow(
  sessionId: string,
  studentProfileId: string,
): Promise<void> {
  await prisma.sessionRosterEntry.create({
    data: { sessionId, studentProfileId, source: "GUEST", reason: "aftest" },
  });
}

export async function makeAwardType(suffix: string): Promise<string> {
  const id = asid(suffix);
  await prisma.awardType.create({
    data: {
      id,
      code: asid(`code_${suffix}`),
      name: `Diploma ${suffix}`,
      kind: "DIPLOMA",
      issuingBody: "NRZ",
    },
  });
  return id;
}

export async function makeGradeScale(suffix: string): Promise<string> {
  const id = asid(`scale_${suffix}`);
  await prisma.gradeScale.create({
    data: { id, code: asid(`scalecode_${suffix}`), name: `Schaal ${suffix}` },
  });
  return id;
}

export async function makeGradeValue(
  scaleId: string,
  suffix: string,
  rank: number,
): Promise<string> {
  const id = asid(`grade_${suffix}`);
  await prisma.gradeValue.create({
    data: { id, scaleId, code: suffix.toUpperCase(), rank, label: suffix },
  });
  return id;
}

/** A five-point scale — `onvoldoende`..`zeergoed` — for a single suite's use. */
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
    status?: "DRAFT" | "ACTIVE" | "RETIRED";
    passFloorGradeId?: string | null;
    effectiveFrom?: Date | null;
  } = {},
): Promise<string> {
  const id = asid(`set_${suffix}`);
  await prisma.criterionSet.create({
    data: {
      id,
      awardTypeId,
      version: options.version ?? 1,
      source: "ORG",
      status: options.status ?? "ACTIVE",
      passFloorGradeId: options.passFloorGradeId ?? null,
      effectiveFrom:
        options.status === "DRAFT"
          ? null
          : (options.effectiveFrom ?? new Date("2026-01-01T00:00:00Z")),
    },
  });
  return id;
}

export async function makeCriterion(
  criterionSetId: string,
  suffix: string,
  options: { sequence?: number; minimumGradeId?: string | null } = {},
): Promise<string> {
  const id = asid(`crit_${suffix}`);
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

/**
 * An ACTIVE criterion set with `count` criteria, all falling back to the
 * set's own pass floor (no per-criterion override) — the common case most
 * tests build against.
 */
export async function makeAssessableSet(
  suffix: string,
  count = 2,
): Promise<{
  awardTypeId: string;
  criterionSetId: string;
  gradeIds: Record<string, string>;
  criterionIds: string[];
}> {
  const awardTypeId = await makeAwardType(suffix);
  const { gradeIds } = await makeFiveGradeScale(suffix);
  const criterionSetId = await makeCriterionSet(awardTypeId, suffix, {
    passFloorGradeId: gradeIds.voldoende,
  });
  const criterionIds: string[] = [];
  for (let i = 0; i < count; i++) {
    criterionIds.push(
      await makeCriterion(criterionSetId, `${suffix}_${i}`, {
        sequence: i + 1,
      }),
    );
  }
  return { awardTypeId, criterionSetId, gradeIds, criterionIds };
}

export async function makeRole(
  suffix: string,
  permissions: readonly string[],
): Promise<string> {
  const roleId = asid(suffix);
  await prisma.role.create({ data: { id: roleId, key: roleId, name: suffix } });
  for (const key of permissions) {
    const permissionId = asid(`perm_${key.replace(/\./g, "_")}`);
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
export const ASSESSMENT_ADMIN_PERMISSIONS = [
  "assessment.read",
  "assessment.record",
  "assessment.independence.override",
  "students.notes.read",
  "students.notes.write",
  "groups.read",
] as const;

/** A SESSION-scoped independent assessor: record and read, nothing else. */
export const ASSESSOR_PERMISSIONS = [
  "assessment.read",
  "assessment.record",
] as const;
