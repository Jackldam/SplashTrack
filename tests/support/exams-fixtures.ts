/**
 * Fixtures for the `exams` suites — the `tests/support/assessment-fixtures.ts`
 * pattern, one module later.
 *
 * `exams` owns no `ScopeRelations` of its own (it asks `groups`, `sessions`,
 * `people` and `assessment` for everything it needs — see
 * `src/modules/exams/index.ts`), so {@link installRealRelations} registers
 * the REAL relations of all four, on the `assessment-fixtures.ts` precedent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CLEANUP ORDER — SIMPLER THAN ASSESSMENT'S, BECAUSE THE CASCADE CHAIN DOES
 * MOST OF IT
 *
 * `ExamCandidate.studentProfileId` is `onDelete: Cascade`;
 * `ExamResult.candidateId` cascades from `ExamCandidate`; `Award.resultId`
 * cascades from `ExamResult` (a DELIBERATE departure from `Restrict` — see
 * the schema's own model comment). So deleting the fixture `StudentProfile`s
 * takes the whole exam-candidacy chain with it, running with the owner's
 * privileges regardless of what the runtime role's own grants permit
 * (`examsGrantStatements` holds no `DELETE` on `ExamResult`/`Award` for the
 * runtime role — the property this module's own append-only suite exists to
 * prove). `PersonQualification.personId` is `Restrict`, so it is deleted
 * explicitly, before the fixture `Person` rows go.
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

export const EXAMS_PREFIX = "examsfx_";

export function exid(suffix: string): string {
  return `${EXAMS_PREFIX}${suffix}`;
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
export async function resetExamsFixtures(): Promise<void> {
  await prisma.personQualification.deleteMany({
    where: { personId: { startsWith: EXAMS_PREFIX } },
  });

  await prisma.studentLifecycleEvent.deleteMany({
    where: { studentProfile: { personId: { startsWith: EXAMS_PREFIX } } },
  });
  await prisma.studentProfile.deleteMany({
    where: { personId: { startsWith: EXAMS_PREFIX } },
  });

  await prisma.criterion.deleteMany({
    where: {
      criterionSet: { awardType: { code: { startsWith: EXAMS_PREFIX } } },
    },
  });
  await prisma.criterionSet.deleteMany({
    where: { awardType: { code: { startsWith: EXAMS_PREFIX } } },
  });
  await prisma.gradeValue.deleteMany({
    where: { id: { startsWith: EXAMS_PREFIX } },
  });
  await prisma.gradeScale.deleteMany({
    where: { id: { startsWith: EXAMS_PREFIX } },
  });
  await prisma.awardType.deleteMany({
    where: { code: { startsWith: EXAMS_PREFIX } },
  });

  await prisma.sessionRosterEntry.deleteMany({
    where: { session: { groupId: { startsWith: EXAMS_PREFIX } } },
  });
  await prisma.scheduledSession.deleteMany({
    where: { groupId: { startsWith: EXAMS_PREFIX } },
  });
  await prisma.groupMembership.deleteMany({
    where: { groupId: { startsWith: EXAMS_PREFIX } },
  });
  await prisma.instructorAssignment.deleteMany({
    where: { groupId: { startsWith: EXAMS_PREFIX } },
  });
  await prisma.group.deleteMany({
    where: { id: { startsWith: EXAMS_PREFIX } },
  });

  await prisma.roleAssignment.deleteMany({
    where: { personId: { startsWith: EXAMS_PREFIX } },
  });
  await prisma.rolePermission.deleteMany({
    where: { roleId: { startsWith: EXAMS_PREFIX } },
  });
  await prisma.role.deleteMany({ where: { id: { startsWith: EXAMS_PREFIX } } });
  await prisma.permission.deleteMany({
    where: { id: { startsWith: EXAMS_PREFIX } },
  });
  await prisma.person.deleteMany({
    where: { id: { startsWith: EXAMS_PREFIX } },
  });
  await prisma.organizationUnit.deleteMany({
    where: { id: { startsWith: EXAMS_PREFIX } },
  });
}

export async function makePerson(suffix: string): Promise<string> {
  const id = exid(suffix);
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
      id: exid(`sp_${suffix}`),
      personId,
      studentNumber: exid(`L_${suffix}`),
    },
    select: { id: true },
  });
  return { personId, studentProfileId: profile.id };
}

export async function makeGroup(suffix: string): Promise<string> {
  const id = exid(suffix);
  await prisma.group.create({ data: { id, name: `Groep ${suffix}` } });
  return id;
}

export async function makeLesson(
  groupId: string,
  suffix: string,
  options: { isoDate?: string; status?: "SCHEDULED" | "CANCELLED" } = {},
): Promise<string> {
  const iso = options.isoDate ?? "2026-06-10";
  const id = exid(`les_${suffix}`);
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
    data: { groupId, personId, fromDate: new Date("2020-01-01T00:00:00Z") },
  });
}

export async function makeAwardType(suffix: string): Promise<string> {
  const id = exid(suffix);
  await prisma.awardType.create({
    data: {
      id,
      code: exid(`code_${suffix}`),
      name: `Diploma ${suffix}`,
      kind: "DIPLOMA",
      issuingBody: "NRZ",
    },
  });
  return id;
}

export async function makeGradeScale(suffix: string): Promise<string> {
  const id = exid(`scale_${suffix}`);
  await prisma.gradeScale.create({
    data: { id, code: exid(`scalecode_${suffix}`), name: `Schaal ${suffix}` },
  });
  return id;
}

export async function makeGradeValue(
  scaleId: string,
  suffix: string,
  rank: number,
): Promise<string> {
  const id = exid(`grade_${suffix}`);
  await prisma.gradeValue.create({
    data: { id, scaleId, code: suffix.toUpperCase(), rank, label: suffix },
  });
  return id;
}

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
  options: { passFloorGradeId?: string | null } = {},
): Promise<string> {
  const id = exid(`set_${suffix}`);
  await prisma.criterionSet.create({
    data: {
      id,
      awardTypeId,
      version: 1,
      source: "ORG",
      status: "ACTIVE",
      passFloorGradeId: options.passFloorGradeId ?? null,
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    },
  });
  return id;
}

export async function makeCriterion(
  criterionSetId: string,
  suffix: string,
  options: { sequence?: number } = {},
): Promise<string> {
  const id = exid(`crit_${suffix}`);
  await prisma.criterion.create({
    data: {
      id,
      criterionSetId,
      code: suffix.toUpperCase(),
      name: `Eis ${suffix}`,
      sequence: options.sequence ?? 1,
    },
  });
  return id;
}

/** An ACTIVE, one-criterion, assessable set — enough to record a PASS aftest. */
export async function makeAssessableSet(suffix: string): Promise<{
  awardTypeId: string;
  criterionSetId: string;
  gradeIds: Record<string, string>;
  criterionId: string;
}> {
  const awardTypeId = await makeAwardType(suffix);
  const { gradeIds } = await makeFiveGradeScale(suffix);
  const criterionSetId = await makeCriterionSet(awardTypeId, suffix, {
    passFloorGradeId: gradeIds.voldoende,
  });
  const criterionId = await makeCriterion(criterionSetId, suffix);
  return { awardTypeId, criterionSetId, gradeIds, criterionId };
}

export async function makeQualification(
  personId: string,
  suffix: string,
  options: { validFrom?: Date; validTo?: Date | null; type?: string } = {},
): Promise<string> {
  const row = await prisma.personQualification.create({
    data: {
      personId,
      type: options.type ?? "AFTEST_ASSESSOR",
      validFrom: options.validFrom ?? new Date("2020-01-01T00:00:00Z"),
      validTo: options.validTo ?? null,
    },
    select: { id: true },
  });
  void suffix;
  return row.id;
}

export async function makeRole(
  suffix: string,
  permissions: readonly string[],
): Promise<string> {
  const roleId = exid(suffix);
  await prisma.role.create({ data: { id: roleId, key: roleId, name: suffix } });
  for (const key of permissions) {
    // Reuse a permission already seeded under this KEY (the real catalogue,
    // e.g. against a dev database) rather than upserting by id and colliding
    // with `Permission.key`'s own unique constraint — the
    // `mfa-enrolment.test.ts` `createPendingAdministrator` precedent.
    const existing = await prisma.permission.findUnique({
      where: { key },
      select: { id: true },
    });
    const permissionId =
      existing?.id ??
      (
        await prisma.permission.create({
          data: { id: exid(`perm_${key.replace(/\./g, "_")}`), key },
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

/** Everything an ORGANIZATION-scoped exams manager needs in these suites. */
export const EXAMS_ADMIN_PERMISSIONS = [
  "exams.read",
  "exams.manage",
  "exams.results.record",
  "exams.candidacy.override",
  "certificates.issue",
  "certificates.revoke",
  "assessment.read",
  "assessment.record",
  "assessment.independence.override",
  "groups.read",
] as const;
