/**
 * The hand-written constraints of `20260910090000_exams_module` — invisible
 * in `schema.prisma` and easy to lose in a future "regenerate the
 * migrations" tidy-up, which is why they are named and proved here (the
 * `assessment-constraints.test.ts` pattern, one module later).
 *
 *   - `ExamResult_no_self_supersede_check` — a row cannot supersede itself.
 *   - `ExamResult_clientEventId_key` — P-02's idempotency, even under a race
 *     the service's pre-read cannot see.
 *   - `ExamCandidate_override_reason_check` — `overrideUsed` and
 *     `overrideReason` are set together, never separately.
 *   - `ExamCandidate_confirmed_fields_check` — `status = CONFIRMED` always
 *     carries `confirmedAt` and `confirmedByPersonId`.
 *   - `ExamCandidate_withdrawn_fields_check` — `status = WITHDRAWN` always
 *     carries `withdrawnAt` and `withdrawnReason`.
 *   - `Award_revocation_reason_check` — `revokedAt` and `revokeReason` are
 *     set together, never separately (the ONE mutation this module's
 *     append-only shape permits — see the model's own comment).
 *
 * The cross-row half of D-062's rule — a correction points at a result of
 * the SAME candidate — is a rule no CHECK can state; it is enforced in
 * `recordExamResult` and pinned in `exams-services.test.ts`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/database";
import { recordAssessment } from "@/modules/assessment";
import {
  confirmExamCandidate,
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

let adminId: string;

function admin() {
  return { principal: { personId: adminId }, at: NOW };
}

beforeAll(() => {
  installRealRelations();
});

beforeEach(async () => {
  await resetExamsFixtures();
  adminId = await makePerson("con_admin");
  await grantTo({
    personId: adminId,
    roleId: await makeRole("con_role_admin", EXAMS_ADMIN_PERMISSIONS),
    scopeType: "ORGANIZATION",
  });
});

afterAll(async () => {
  await resetExamsFixtures();
});

async function aConfirmedCandidate(suffix: string) {
  const groupId = await makeGroup(`con_g_${suffix}`);
  const pupil = await makeStudent(`con_p_${suffix}`);
  await placeInGroup(groupId, pupil.studentProfileId);
  const assessor = await makePerson(`con_assessor_${suffix}`);
  await makeQualification(assessor, suffix);
  const { awardTypeId, criterionSetId, gradeIds, criterionId } =
    await makeAssessableSet(`con${suffix}`);
  const sessionId = await makeLesson(groupId, `con_${suffix}`);
  await grantTo({
    personId: assessor,
    roleId: await makeRole(`con_assessor_role_${suffix}`, [
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
      clientEventId: exid(`ce_con_${suffix}`),
      results: [{ criterionId, gradeValueId: gradeIds.voldoende }],
    },
  );
  const { id: candidateId } = await registerExamCandidate(admin(), {
    studentProfileId: pupil.studentProfileId,
    awardTypeId,
    groupId,
  });
  await confirmExamCandidate(admin(), { candidateId });
  return { candidateId, groupId };
}

describe("ExamResult_no_self_supersede_check", () => {
  it("refuses a row that supersedes itself, at the database", async () => {
    const { candidateId } = await aConfirmedCandidate("self");
    const selfId = exid("con_self_row");
    await expect(
      prisma.$executeRaw`
        INSERT INTO "ExamResult"
          ("id", "candidateId", "outcome", "recordedAt", "supersedesResultId", "clientEventId")
        VALUES
          (${selfId}, ${candidateId}, 'PASS', ${NOW}, ${selfId}, ${exid("ce_con_self_row")})
      `,
    ).rejects.toThrow(/no_self_supersede/i);
  });
});

describe("ExamResult_clientEventId_key", () => {
  it("refuses a second row with the same client id", async () => {
    const { candidateId } = await aConfirmedCandidate("dup");
    const { id } = await recordExamResult(admin(), {
      candidateId,
      outcome: "PASS",
      clientEventId: exid("ce_con_dup"),
    });
    const secondId = exid("con_dup_row");
    await expect(
      prisma.$executeRaw`
        INSERT INTO "ExamResult"
          ("id", "candidateId", "outcome", "recordedAt", "clientEventId")
        VALUES
          (${secondId}, ${candidateId}, 'PASS', ${NOW}, ${exid("ce_con_dup")})
      `,
    ).rejects.toThrow(/unique/i);
    expect(id).not.toBe(secondId);
  });
});

describe("ExamCandidate_override_reason_check", () => {
  it("refuses overrideUsed = true with a null overrideReason", async () => {
    const groupId = await makeGroup("con_ovr_g");
    const pupil = await makeStudent("con_ovr_p");
    await placeInGroup(groupId, pupil.studentProfileId);
    const { awardTypeId } = await makeAssessableSet("conovr");
    const { id: candidateId } = await registerExamCandidate(admin(), {
      studentProfileId: pupil.studentProfileId,
      awardTypeId,
      groupId,
    });

    await expect(
      prisma.$executeRaw`
        UPDATE "ExamCandidate" SET "overrideUsed" = true, "overrideReason" = NULL
        WHERE "id" = ${candidateId}
      `,
    ).rejects.toThrow(/override_reason/i);
  });

  it("refuses overrideUsed = false with a non-null overrideReason", async () => {
    const groupId = await makeGroup("con_ovr2_g");
    const pupil = await makeStudent("con_ovr2_p");
    await placeInGroup(groupId, pupil.studentProfileId);
    const { awardTypeId } = await makeAssessableSet("conovr2");
    const { id: candidateId } = await registerExamCandidate(admin(), {
      studentProfileId: pupil.studentProfileId,
      awardTypeId,
      groupId,
    });

    await expect(
      prisma.$executeRaw`
        UPDATE "ExamCandidate" SET "overrideUsed" = false, "overrideReason" = 'reden'
        WHERE "id" = ${candidateId}
      `,
    ).rejects.toThrow(/override_reason/i);
  });
});

describe("ExamCandidate_confirmed_fields_check", () => {
  it("ALLOWS status = CONFIRMED with a null confirmedByPersonId — SEVER_AND_RETAIN must stay severable", async () => {
    // `confirmedByPersonId` is SEVER_AND_RETAIN (onDelete: SetNull, the
    // Assessment.assessorPersonId pattern): erasing the confirming person
    // nulls this pointer while the candidacy itself survives. A CHECK that
    // required both fields together would make that erasure impossible —
    // caught for real by the phase 2.4 browser verification, when erasing
    // the browser-test administrator after they had confirmed a candidacy
    // hit exactly this constraint. See the model's own comment.
    const groupId = await makeGroup("con_conf_g");
    const pupil = await makeStudent("con_conf_p");
    await placeInGroup(groupId, pupil.studentProfileId);
    const { awardTypeId } = await makeAssessableSet("conconf");
    const { id: candidateId } = await registerExamCandidate(admin(), {
      studentProfileId: pupil.studentProfileId,
      awardTypeId,
      groupId,
    });

    await prisma.$executeRaw`
      UPDATE "ExamCandidate"
      SET "status" = 'CONFIRMED', "confirmedAt" = ${NOW}, "confirmedByPersonId" = NULL
      WHERE "id" = ${candidateId}
    `;

    const row = await prisma.examCandidate.findUniqueOrThrow({
      where: { id: candidateId },
    });
    expect(row.status).toBe("CONFIRMED");
    expect(row.confirmedByPersonId).toBeNull();
  });

  it("erasing the person who confirmed a candidacy severs the pointer without disturbing the candidacy", async () => {
    const groupId = await makeGroup("con_sever_g");
    const pupil = await makeStudent("con_sever_p");
    await placeInGroup(groupId, pupil.studentProfileId);
    const { awardTypeId } = await makeAssessableSet("consever");
    const confirmer = await makePerson("con_sever_confirmer");
    const { id: candidateId } = await registerExamCandidate(admin(), {
      studentProfileId: pupil.studentProfileId,
      awardTypeId,
      groupId,
    });
    await prisma.$executeRaw`
      UPDATE "ExamCandidate"
      SET "status" = 'CONFIRMED', "confirmedAt" = ${NOW}, "confirmedByPersonId" = ${confirmer}
      WHERE "id" = ${candidateId}
    `;

    await prisma.person.delete({ where: { id: confirmer } });

    const row = await prisma.examCandidate.findUniqueOrThrow({
      where: { id: candidateId },
    });
    expect(row.status).toBe("CONFIRMED");
    expect(row.confirmedByPersonId).toBeNull();
    expect(row.confirmedAt).not.toBeNull();
  });

  it("refuses status = CONFIRMED with a null confirmedAt", async () => {
    const groupId = await makeGroup("con_conf2_g");
    const pupil = await makeStudent("con_conf2_p");
    await placeInGroup(groupId, pupil.studentProfileId);
    const { awardTypeId } = await makeAssessableSet("conconf2");
    const { id: candidateId } = await registerExamCandidate(admin(), {
      studentProfileId: pupil.studentProfileId,
      awardTypeId,
      groupId,
    });

    await expect(
      prisma.$executeRaw`
        UPDATE "ExamCandidate"
        SET "status" = 'CONFIRMED', "confirmedAt" = NULL, "confirmedByPersonId" = ${adminId}
        WHERE "id" = ${candidateId}
      `,
    ).rejects.toThrow(/confirmed_fields/i);
  });
});

describe("ExamCandidate_withdrawn_fields_check", () => {
  it("refuses status = WITHDRAWN with a null withdrawnReason", async () => {
    const groupId = await makeGroup("con_wd_g");
    const pupil = await makeStudent("con_wd_p");
    await placeInGroup(groupId, pupil.studentProfileId);
    const { awardTypeId } = await makeAssessableSet("conwd");
    const { id: candidateId } = await registerExamCandidate(admin(), {
      studentProfileId: pupil.studentProfileId,
      awardTypeId,
      groupId,
    });

    await expect(
      prisma.$executeRaw`
        UPDATE "ExamCandidate"
        SET "status" = 'WITHDRAWN', "withdrawnAt" = ${NOW}, "withdrawnReason" = NULL
        WHERE "id" = ${candidateId}
      `,
    ).rejects.toThrow(/withdrawn_fields/i);
  });
});

describe("Award_revocation_reason_check", () => {
  async function anIssuedAward(suffix: string) {
    const { candidateId } = await aConfirmedCandidate(suffix);
    const { id: resultId } = await recordExamResult(admin(), {
      candidateId,
      outcome: "PASS",
      clientEventId: exid(`ce_con_award_${suffix}`),
    });
    const award = await prisma.award.create({
      data: {
        resultId,
        awardTypeId: (
          await prisma.examCandidate.findUniqueOrThrow({
            where: { id: candidateId },
            select: { awardTypeId: true },
          })
        ).awardTypeId,
        number: exid(`num_con_${suffix}`),
        issuedAt: NOW,
      },
    });
    return award.id;
  }

  it("refuses a non-null revokedAt with a null revokeReason", async () => {
    const awardId = await anIssuedAward("award1");
    await expect(
      prisma.$executeRaw`
        UPDATE "Award" SET "revokedAt" = ${NOW}, "revokeReason" = NULL
        WHERE "id" = ${awardId}
      `,
    ).rejects.toThrow(/revocation_reason/i);
  });

  it("refuses a null revokedAt with a non-null revokeReason", async () => {
    const awardId = await anIssuedAward("award2");
    await expect(
      prisma.$executeRaw`
        UPDATE "Award" SET "revokedAt" = NULL, "revokeReason" = 'reden'
        WHERE "id" = ${awardId}
      `,
    ).rejects.toThrow(/revocation_reason/i);
  });

  it("accepts both set together", async () => {
    const awardId = await anIssuedAward("award3");
    await prisma.$executeRaw`
      UPDATE "Award" SET "revokedAt" = ${NOW}, "revokeReason" = 'reden'
      WHERE "id" = ${awardId}
    `;
    const row = await prisma.award.findUniqueOrThrow({
      where: { id: awardId },
    });
    expect(row.revokedAt).not.toBeNull();
    expect(row.revokeReason).toBe("reden");
  });
});
