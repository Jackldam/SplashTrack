/**
 * `ExamResult` and `Award` carry the P-07 append-only carve-out
 * (`examsGrantStatements`, phase 2.4) — the `attendance-append-only.test.ts`
 * pattern, one module later, proved as the REAL runtime role rather than
 * asserted in code.
 *
 * `ExamResult` is the EXACT `Assessment`/`AttendanceEvent` shape: `SELECT,
 * INSERT` and nothing else.
 *
 * `Award` is DIFFERENT, and that difference is what this file exists to
 * prove precisely: the runtime role may `UPDATE` `revokedAt`/`revokeReason`
 * — and ONLY those two columns — while every other column (`number`,
 * `issuedAt`, `resultId`, `awardTypeId`) is exactly as immutable as an
 * ordinary append-only table's. See the model's own comment in
 * `prisma/schema.prisma` for why this departs from the literal D-061/D-062
 * shape.
 *
 * `PersonQualification` and `ExamCandidate` are NOT here — they are ordinary
 * mutable tables (the `MembershipPeriod`/`WaitlistEntry` shape) and carry no
 * carve-out; their own services prove their mutations directly
 * (`exams-services.test.ts`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/database";
import { roleNameFrom } from "@/lib/database/role-model";
import { recordAssessment } from "@/modules/assessment";
import {
  confirmExamCandidate,
  issueAward,
  recordExamResult,
  registerExamCandidate,
} from "@/modules/exams";

import {
  EXAMS_ADMIN_PERMISSIONS,
  exid,
  grantTo,
  installRealRelations,
  makeAssessableSet,
  makeGroup,
  makeLesson,
  makePerson,
  makeQualification,
  makeRole,
  makeStudent,
  placeInGroup,
  resetExamsFixtures,
} from "../support/exams-fixtures";

const NOW = new Date("2026-06-10T18:00:00.000Z");
const APP_ROLE = roleNameFrom(process.env.DATABASE_URL as string);

let adminId: string;

function admin() {
  return { principal: { personId: adminId }, at: NOW };
}

beforeAll(() => {
  installRealRelations();
});

beforeEach(async () => {
  await resetExamsFixtures();
  adminId = await makePerson("ao_admin");
  await grantTo({
    personId: adminId,
    roleId: await makeRole("ao_role_admin", EXAMS_ADMIN_PERMISSIONS),
    scopeType: "ORGANIZATION",
  });
});

afterAll(async () => {
  await resetExamsFixtures();
});

async function aConfirmedCandidate(suffix: string) {
  const groupId = await makeGroup(`ao_g_${suffix}`);
  const pupil = await makeStudent(`ao_p_${suffix}`);
  await placeInGroup(groupId, pupil.studentProfileId);
  const assessor = await makePerson(`ao_assessor_${suffix}`);
  await makeQualification(assessor, suffix);
  const { awardTypeId, criterionSetId, gradeIds, criterionId } =
    await makeAssessableSet(`ao${suffix}`);
  const sessionId = await makeLesson(groupId, `ao_${suffix}`);
  await grantTo({
    personId: assessor,
    roleId: await makeRole(`ao_assessor_role_${suffix}`, [
      "assessment.read",
      "assessment.record",
    ]),
    scopeType: "SESSION",
    scopeId: sessionId,
    validUntil: new Date("2026-12-31T00:00:00Z"),
  });
  await recordAssessment(
    { principal: { personId: assessor }, at: NOW },
    sessionId,
    {
      studentProfileId: pupil.studentProfileId,
      criterionSetId,
      clientEventId: exid(`ce_ao_${suffix}`),
      results: [{ criterionId, gradeValueId: gradeIds.voldoende }],
    },
  );
  const { id: candidateId } = await registerExamCandidate(admin(), {
    studentProfileId: pupil.studentProfileId,
    awardTypeId,
    groupId,
  });
  await confirmExamCandidate(admin(), { candidateId });
  return { candidateId };
}

describe("ExamResult carries the carve-out from day one", () => {
  it("the runtime role holds SELECT and INSERT, and nothing else", async () => {
    const privileges = await prisma.$queryRaw<{ privilege_type: string }[]>`
      SELECT privilege_type
        FROM information_schema.role_table_grants
       WHERE table_name = 'ExamResult'
         AND grantee = ${APP_ROLE}
       ORDER BY privilege_type
    `;
    expect(privileges.map((row) => row.privilege_type)).toEqual([
      "INSERT",
      "SELECT",
    ]);
  });

  it("an UPDATE and a DELETE against a real ExamResult row are REFUSED by the database", async () => {
    const { candidateId } = await aConfirmedCandidate("upd1");
    const written = await recordExamResult(admin(), {
      candidateId,
      outcome: "PASS",
      clientEventId: exid("ce_ao_upd1"),
    });
    const row = await prisma.examResult.findUniqueOrThrow({
      where: { id: written.id },
    });

    await expect(
      prisma.examResult.update({
        where: { id: row.id },
        data: { outcome: "FAIL" },
      }),
    ).rejects.toThrow(/permission denied|denied by|not permitted/i);
    await expect(
      prisma.examResult.delete({ where: { id: row.id } }),
    ).rejects.toThrow(/permission denied|denied by|not permitted/i);

    await expect(
      prisma.examResult.findUniqueOrThrow({ where: { id: row.id } }),
    ).resolves.toEqual(row);
  });

  it("erasing the STUDENT still takes the rows: the cascade runs as the owner, not as the runtime role", async () => {
    const { candidateId } = await aConfirmedCandidate("erase1");
    const written = await recordExamResult(admin(), {
      candidateId,
      outcome: "PASS",
      clientEventId: exid("ce_ao_erase1"),
    });
    const candidate = await prisma.examCandidate.findUniqueOrThrow({
      where: { id: candidateId },
    });

    await prisma.studentProfile.delete({
      where: { id: candidate.studentProfileId },
    });

    await expect(
      prisma.examResult.count({ where: { id: written.id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.examCandidate.count({ where: { id: candidateId } }),
    ).resolves.toBe(0);
  });
});

describe("Award — SELECT/INSERT plus a column-restricted UPDATE, and nothing else", () => {
  async function aPassResult(suffix: string) {
    const { candidateId } = await aConfirmedCandidate(suffix);
    const { id: resultId } = await recordExamResult(admin(), {
      candidateId,
      outcome: "PASS",
      clientEventId: exid(`ce_ao_${suffix}`),
    });
    return resultId;
  }

  it("the runtime role holds SELECT, INSERT and a column-restricted UPDATE — never DELETE", async () => {
    const privileges = await prisma.$queryRaw<
      { privilege_type: string; column_name: string | null }[]
    >`
      SELECT privilege_type, column_name
        FROM information_schema.role_column_grants
       WHERE table_name = 'Award'
         AND grantee = ${APP_ROLE}
       ORDER BY privilege_type, column_name
    `;
    const kinds = [...new Set(privileges.map((p) => p.privilege_type))].sort();
    expect(kinds).toEqual(["INSERT", "SELECT", "UPDATE"]);

    const updateColumns = privileges
      .filter((p) => p.privilege_type === "UPDATE")
      .map((p) => p.column_name)
      .sort();
    expect(updateColumns).toEqual(["revokeReason", "revokedAt"]);
  });

  it("UPDATEs revokedAt/revokeReason together, at the database, as the real runtime role", async () => {
    const resultId = await aPassResult("colok");
    const { id: awardId } = await issueAward(admin(), {
      resultId,
      number: exid("num_colok"),
    });

    await prisma.award.update({
      where: { id: awardId },
      data: { revokedAt: NOW, revokeReason: "reden" },
    });

    const row = await prisma.award.findUniqueOrThrow({
      where: { id: awardId },
    });
    expect(row.revokedAt).toEqual(NOW);
    expect(row.revokeReason).toBe("reden");
  });

  it("REFUSES an UPDATE touching number, at the database, even alongside an allowed column", async () => {
    const resultId = await aPassResult("colbad1");
    const { id: awardId } = await issueAward(admin(), {
      resultId,
      number: exid("num_colbad1"),
    });

    await expect(
      prisma.award.update({
        where: { id: awardId },
        data: { revokedAt: NOW, number: exid("num_colbad1_changed") },
      }),
    ).rejects.toThrow(/permission denied|denied by|not permitted/i);
  });

  it("REFUSES an UPDATE touching issuedAt, at the database", async () => {
    const resultId = await aPassResult("colbad2");
    const { id: awardId } = await issueAward(admin(), {
      resultId,
      number: exid("num_colbad2"),
    });

    await expect(
      prisma.award.update({
        where: { id: awardId },
        data: { issuedAt: new Date("2020-01-01T00:00:00Z") },
      }),
    ).rejects.toThrow(/permission denied|denied by|not permitted/i);
  });

  it("REFUSES a DELETE against a real Award row", async () => {
    const resultId = await aPassResult("del1");
    const { id: awardId } = await issueAward(admin(), {
      resultId,
      number: exid("num_del1"),
    });

    await expect(
      prisma.award.delete({ where: { id: awardId } }),
    ).rejects.toThrow(/permission denied|denied by|not permitted/i);
  });

  it("erasing the STUDENT still takes the award: the cascade (Award -> ExamResult -> ExamCandidate -> StudentProfile) runs as the owner", async () => {
    const resultId = await aPassResult("erase2");
    const { id: awardId } = await issueAward(admin(), {
      resultId,
      number: exid("num_erase2"),
    });
    const result = await prisma.examResult.findUniqueOrThrow({
      where: { id: resultId },
    });
    const candidate = await prisma.examCandidate.findUniqueOrThrow({
      where: { id: result.candidateId },
    });

    await prisma.studentProfile.delete({
      where: { id: candidate.studentProfileId },
    });

    await expect(prisma.award.count({ where: { id: awardId } })).resolves.toBe(
      0,
    );
  });
});
