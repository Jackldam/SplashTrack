/**
 * The `exams` services against the real database — D-085's full formula at
 * the write it was always meant to gate (`ExamCandidate -> CONFIRMED`), its
 * override, D-062's append-only `ExamResult`, and `Award` issuance/revocation.
 *
 * The properties worth naming:
 *
 *   - D-085, ALL THREE CLAUSES: a candidacy confirms only with a qualifying
 *     PASS aftest, an INDEPENDENT assessor (re-verified HERE, live, not
 *     trusted from assessment's write-time decision), AND a valid
 *     `PersonQualification` held by that assessor at `assessedAt`.
 *   - The override (`exams.candidacy.override`) bypasses any unmet clause,
 *     records `overrideUsed`/`overrideReason`, and refuses without a reason.
 *   - `ExamResult` is APPEND-ONLY: a correction is a new row carrying
 *     `supersedesResultId`; nothing here can UPDATE or DELETE one (proved at
 *     the database in `exams-append-only.test.ts`).
 *   - Exactly one EFFECTIVE result exists per candidate at a time (D-062).
 *   - `Award` issues only against a PASS, unsuperseded result, and revocation
 *     sets `revokedAt`/`revokeReason` without touching `number`/`issuedAt`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PermissionDeniedError } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { recordAssessment } from "@/modules/assessment";
import {
  confirmExamCandidate,
  endQualification,
  ExamCandidateError,
  getExamCandidatesForStudent,
  getExamResultsForCandidate,
  grantQualification,
  issueAward,
  recordExamResult,
  registerExamCandidate,
  revokeAward,
  withdrawExamCandidate,
} from "@/modules/exams";

import {
  assignInstructorTo,
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
  adminId = await makePerson("svc_admin");
  await grantTo({
    personId: adminId,
    roleId: await makeRole("svc_role_admin", EXAMS_ADMIN_PERMISSIONS),
    scopeType: "ORGANIZATION",
  });
});

afterAll(async () => {
  await resetExamsFixtures();
});

/**
 * A pupil, an INDEPENDENT assessor (not the pupil's own instructor) who holds
 * a valid `PersonQualification`, one recorded PASS aftest — every clause of
 * D-085 satisfied. Returns the ids a test needs to register and confirm a
 * candidacy.
 */
async function aQualifyingScenario(suffix: string) {
  const groupId = await makeGroup(`g_${suffix}`);
  const pupil = await makeStudent(`p_${suffix}`);
  await placeInGroup(groupId, pupil.studentProfileId);
  const ownInstructor = await makePerson(`instr_${suffix}`);
  await assignInstructorTo(groupId, ownInstructor);

  const assessor = await makePerson(`assessor_${suffix}`);
  await makeQualification(assessor, suffix);

  const { awardTypeId, criterionSetId, gradeIds, criterionId } =
    await makeAssessableSet(suffix);
  const sessionId = await makeLesson(groupId, suffix);

  // The assessor needs a SESSION grant to record the aftest, on the real
  // `assessment` module's own guard shape.
  const assessorRoleId = await makeRole(`assessor_role_${suffix}`, [
    "assessment.read",
    "assessment.record",
  ]);
  await grantTo({
    personId: assessor,
    roleId: assessorRoleId,
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
      clientEventId: exid(`ce_${suffix}`),
      results: [{ criterionId, gradeValueId: gradeIds.voldoende }],
    },
  );

  return { groupId, pupil, ownInstructor, assessor, awardTypeId };
}

describe("registerExamCandidate", () => {
  it("registers a PENDING candidacy for a student currently in the given group", async () => {
    const { groupId, pupil, awardTypeId } = await aQualifyingScenario("reg1");
    const { id } = await registerExamCandidate(admin(), {
      studentProfileId: pupil.studentProfileId,
      awardTypeId,
      groupId,
    });
    const list = await getExamCandidatesForStudent(
      admin(),
      pupil.studentProfileId,
    );
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(id);
    expect(list[0]!.status).toBe("PENDING");
  });

  it("refuses a student who is not an active member of the given group", async () => {
    const { pupil, awardTypeId } = await aQualifyingScenario("reg2");
    const otherGroupId = await makeGroup("g_reg2_other");
    await expect(
      registerExamCandidate(admin(), {
        studentProfileId: pupil.studentProfileId,
        awardTypeId,
        groupId: otherGroupId,
      }),
    ).rejects.toThrow(ExamCandidateError);
  });
});

describe("confirmExamCandidate — D-085's full formula", () => {
  it("confirms when every clause holds: qualifying PASS aftest, independent assessor, valid PersonQualification", async () => {
    const { groupId, pupil, awardTypeId } = await aQualifyingScenario("ok1");
    const { id: candidateId } = await registerExamCandidate(admin(), {
      studentProfileId: pupil.studentProfileId,
      awardTypeId,
      groupId,
    });

    const result = await confirmExamCandidate(admin(), { candidateId });
    expect(result.overrideUsed).toBe(false);

    const [candidate] = await getExamCandidatesForStudent(
      admin(),
      pupil.studentProfileId,
    );
    expect(candidate!.status).toBe("CONFIRMED");
    expect(candidate!.confirmedByPersonId).toBe(adminId);
    expect(candidate!.qualifyingAssessmentId).not.toBeNull();
    expect(candidate!.overrideUsed).toBe(false);
  });

  it("refuses NO_QUALIFYING_ASSESSMENT when there is no aftest at all", async () => {
    const groupId = await makeGroup("g_noaft");
    const pupil = await makeStudent("p_noaft");
    await placeInGroup(groupId, pupil.studentProfileId);
    const { awardTypeId } = await makeAssessableSet("noaft").then(
      async (set) => set,
    );
    const { id: candidateId } = await registerExamCandidate(admin(), {
      studentProfileId: pupil.studentProfileId,
      awardTypeId,
      groupId,
    });

    await expect(
      confirmExamCandidate(admin(), { candidateId }),
    ).rejects.toMatchObject({ reason: "NO_QUALIFYING_ASSESSMENT" });
  });

  it("refuses NOT_INDEPENDENT — re-verified LIVE at confirmation time, not trusted from assessment's write", async () => {
    // The aftest was recorded by an INDEPENDENT assessor (valid at write
    // time). Between the aftest and the confirmation attempt, that same
    // assessor is ALSO assigned as the pupil's own instructor — the fact
    // this module's live re-check must catch, on the file comment's own
    // reasoning.
    const { groupId, pupil, assessor, awardTypeId } =
      await aQualifyingScenario("live1");
    const { id: candidateId } = await registerExamCandidate(admin(), {
      studentProfileId: pupil.studentProfileId,
      awardTypeId,
      groupId,
    });

    await assignInstructorTo(groupId, assessor);

    await expect(
      confirmExamCandidate(admin(), { candidateId }),
    ).rejects.toMatchObject({ reason: "NOT_INDEPENDENT" });
  });

  it("refuses ASSESSOR_NOT_QUALIFIED when the independent assessor holds no PersonQualification", async () => {
    const groupId = await makeGroup("g_noqual");
    const pupil = await makeStudent("p_noqual");
    await placeInGroup(groupId, pupil.studentProfileId);
    const assessor = await makePerson("assessor_noqual");
    // Deliberately NO makeQualification() call.
    const { awardTypeId, criterionSetId, gradeIds, criterionId } =
      await makeAssessableSet("noqual");
    const sessionId = await makeLesson(groupId, "noqual");
    const assessorRoleId = await makeRole("assessor_role_noqual", [
      "assessment.read",
      "assessment.record",
    ]);
    await grantTo({
      personId: assessor,
      roleId: assessorRoleId,
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
        clientEventId: exid("ce_noqual"),
        results: [{ criterionId, gradeValueId: gradeIds.voldoende }],
      },
    );

    const { id: candidateId } = await registerExamCandidate(admin(), {
      studentProfileId: pupil.studentProfileId,
      awardTypeId,
      groupId,
    });

    await expect(
      confirmExamCandidate(admin(), { candidateId }),
    ).rejects.toMatchObject({ reason: "ASSESSOR_NOT_QUALIFIED" });
  });

  it("refuses ASSESSOR_NOT_QUALIFIED when the qualification had already lapsed at assessedAt", async () => {
    const groupId = await makeGroup("g_lapsed");
    const pupil = await makeStudent("p_lapsed");
    await placeInGroup(groupId, pupil.studentProfileId);
    const assessor = await makePerson("assessor_lapsed");
    await makeQualification(assessor, "lapsed", {
      validFrom: new Date("2020-01-01T00:00:00Z"),
      validTo: new Date("2025-01-01T00:00:00Z"), // lapsed before NOW
    });
    const { awardTypeId, criterionSetId, gradeIds, criterionId } =
      await makeAssessableSet("lapsed");
    const sessionId = await makeLesson(groupId, "lapsed");
    const assessorRoleId = await makeRole("assessor_role_lapsed", [
      "assessment.read",
      "assessment.record",
    ]);
    await grantTo({
      personId: assessor,
      roleId: assessorRoleId,
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
        clientEventId: exid("ce_lapsed"),
        results: [{ criterionId, gradeValueId: gradeIds.voldoende }],
      },
    );

    const { id: candidateId } = await registerExamCandidate(admin(), {
      studentProfileId: pupil.studentProfileId,
      awardTypeId,
      groupId,
    });

    await expect(
      confirmExamCandidate(admin(), { candidateId }),
    ).rejects.toMatchObject({ reason: "ASSESSOR_NOT_QUALIFIED" });
  });

  it("the override bypasses any unmet clause, records overrideUsed and the reason, and is refused without a reason", async () => {
    const groupId = await makeGroup("g_ovr");
    const pupil = await makeStudent("p_ovr");
    await placeInGroup(groupId, pupil.studentProfileId);
    const { awardTypeId } = await makeAssessableSet("ovr");
    const { id: candidateId } = await registerExamCandidate(admin(), {
      studentProfileId: pupil.studentProfileId,
      awardTypeId,
      groupId,
    });

    // No aftest at all — NO_QUALIFYING_ASSESSMENT — refused without a reason.
    await expect(
      confirmExamCandidate(admin(), { candidateId }),
    ).rejects.toMatchObject({ reason: "NO_QUALIFYING_ASSESSMENT" });

    const result = await confirmExamCandidate(admin(), {
      candidateId,
      overrideReason:
        "Geen andere bevoegde beoordelaar deze maand beschikbaar.",
    });
    expect(result.overrideUsed).toBe(true);

    const [candidate] = await getExamCandidatesForStudent(
      admin(),
      pupil.studentProfileId,
    );
    expect(candidate!.status).toBe("CONFIRMED");
    expect(candidate!.overrideUsed).toBe(true);
    expect(candidate!.overrideReason).toContain("beoordelaar");
  });

  it("the override permission itself is required — a reason alone is not enough", async () => {
    const groupId = await makeGroup("g_ovrperm");
    const pupil = await makeStudent("p_ovrperm");
    await placeInGroup(groupId, pupil.studentProfileId);
    const { awardTypeId } = await makeAssessableSet("ovrperm");
    const { id: candidateId } = await registerExamCandidate(admin(), {
      studentProfileId: pupil.studentProfileId,
      awardTypeId,
      groupId,
    });

    const noOverrideId = await makePerson("noOverride_ovrperm");
    await grantTo({
      personId: noOverrideId,
      roleId: await makeRole("role_noOverride_ovrperm", [
        "exams.read",
        "exams.manage",
      ]),
      scopeType: "ORGANIZATION",
    });

    await expect(
      confirmExamCandidate(
        { principal: { personId: noOverrideId }, at: NOW },
        { candidateId, overrideReason: "reden" },
      ),
    ).rejects.toMatchObject({ reason: "NO_QUALIFYING_ASSESSMENT" });
  });

  it("refuses ALREADY_CONFIRMED on a second confirmation attempt", async () => {
    const { groupId, pupil, awardTypeId } = await aQualifyingScenario("dup1");
    const { id: candidateId } = await registerExamCandidate(admin(), {
      studentProfileId: pupil.studentProfileId,
      awardTypeId,
      groupId,
    });
    await confirmExamCandidate(admin(), { candidateId });
    await expect(
      confirmExamCandidate(admin(), { candidateId }),
    ).rejects.toMatchObject({ reason: "ALREADY_CONFIRMED" });
  });

  it("requires exams.manage — a caller without any grant is denied outright", async () => {
    const { groupId, pupil, awardTypeId } =
      await aQualifyingScenario("noperm1");
    const { id: candidateId } = await registerExamCandidate(admin(), {
      studentProfileId: pupil.studentProfileId,
      awardTypeId,
      groupId,
    });
    const nobody = await makePerson("nobody_noperm1");
    await expect(
      confirmExamCandidate(
        { principal: { personId: nobody }, at: NOW },
        { candidateId },
      ),
    ).rejects.toThrow(PermissionDeniedError);
  });
});

describe("withdrawExamCandidate", () => {
  it("withdraws a PENDING candidacy with a reason", async () => {
    const groupId = await makeGroup("g_wd1");
    const pupil = await makeStudent("p_wd1");
    await placeInGroup(groupId, pupil.studentProfileId);
    const { awardTypeId } = await makeAssessableSet("wd1");
    const { id: candidateId } = await registerExamCandidate(admin(), {
      studentProfileId: pupil.studentProfileId,
      awardTypeId,
      groupId,
    });

    await withdrawExamCandidate(admin(), {
      candidateId,
      reason: "Leerling is verhuisd.",
    });

    const [candidate] = await getExamCandidatesForStudent(
      admin(),
      pupil.studentProfileId,
    );
    expect(candidate!.status).toBe("WITHDRAWN");
    expect(candidate!.withdrawnReason).toBe("Leerling is verhuisd.");
  });

  it("refuses ALREADY_WITHDRAWN on a second attempt", async () => {
    const groupId = await makeGroup("g_wd2");
    const pupil = await makeStudent("p_wd2");
    await placeInGroup(groupId, pupil.studentProfileId);
    const { awardTypeId } = await makeAssessableSet("wd2");
    const { id: candidateId } = await registerExamCandidate(admin(), {
      studentProfileId: pupil.studentProfileId,
      awardTypeId,
      groupId,
    });
    await withdrawExamCandidate(admin(), { candidateId, reason: "reden" });
    await expect(
      withdrawExamCandidate(admin(), { candidateId, reason: "reden 2" }),
    ).rejects.toMatchObject({ reason: "ALREADY_WITHDRAWN" });
  });
});

describe("recordExamResult / getExamResultsForCandidate — D-062", () => {
  async function aConfirmedCandidate(suffix: string) {
    const { groupId, pupil, awardTypeId } = await aQualifyingScenario(suffix);
    const { id: candidateId } = await registerExamCandidate(admin(), {
      studentProfileId: pupil.studentProfileId,
      awardTypeId,
      groupId,
    });
    await confirmExamCandidate(admin(), { candidateId });
    return { candidateId, pupil, groupId };
  }

  it("refuses recording a result for a candidate that is not CONFIRMED", async () => {
    const groupId = await makeGroup("g_notconf");
    const pupil = await makeStudent("p_notconf");
    await placeInGroup(groupId, pupil.studentProfileId);
    const { awardTypeId } = await makeAssessableSet("notconf");
    const { id: candidateId } = await registerExamCandidate(admin(), {
      studentProfileId: pupil.studentProfileId,
      awardTypeId,
      groupId,
    });

    await expect(
      recordExamResult(admin(), {
        candidateId,
        outcome: "PASS",
        clientEventId: exid("ce_notconf"),
      }),
    ).rejects.toMatchObject({ reason: "CANDIDATE_NOT_CONFIRMED" });
  });

  it("records a PASS result for a CONFIRMED candidate", async () => {
    const { candidateId } = await aConfirmedCandidate("res1");
    const { id } = await recordExamResult(admin(), {
      candidateId,
      outcome: "PASS",
      clientEventId: exid("ce_res1"),
    });
    const { results, effectiveResultId } = await getExamResultsForCandidate(
      admin(),
      candidateId,
    );
    expect(results).toHaveLength(1);
    expect(effectiveResultId).toBe(id);
  });

  it("P-02: replaying the same clientEventId returns the original write, not a second row", async () => {
    const { candidateId } = await aConfirmedCandidate("res2");
    const clientEventId = exid("ce_res2");
    const first = await recordExamResult(admin(), {
      candidateId,
      outcome: "PASS",
      clientEventId,
    });
    const second = await recordExamResult(admin(), {
      candidateId,
      outcome: "PASS",
      clientEventId,
    });
    expect(second.id).toBe(first.id);
    const { results } = await getExamResultsForCandidate(admin(), candidateId);
    expect(results).toHaveLength(1);
  });

  it("a correction requires a reason", async () => {
    const { candidateId } = await aConfirmedCandidate("res3");
    const { id: firstId } = await recordExamResult(admin(), {
      candidateId,
      outcome: "FAIL",
      clientEventId: exid("ce_res3a"),
    });
    await expect(
      recordExamResult(admin(), {
        candidateId,
        outcome: "PASS",
        supersedesResultId: firstId,
        clientEventId: exid("ce_res3b"),
      }),
    ).rejects.toMatchObject({ reason: "CORRECTION_REASON_REQUIRED" });
  });

  it("a correction supersedes the original; exactly one effective result remains, and the original row is unchanged", async () => {
    const { candidateId } = await aConfirmedCandidate("res4");
    const { id: firstId } = await recordExamResult(admin(), {
      candidateId,
      outcome: "FAIL",
      clientEventId: exid("ce_res4a"),
    });
    const { id: secondId } = await recordExamResult(admin(), {
      candidateId,
      outcome: "PASS",
      supersedesResultId: firstId,
      reason: "Herbeoordeeld na bezwaar.",
      clientEventId: exid("ce_res4b"),
    });

    const { results, effectiveResultId } = await getExamResultsForCandidate(
      admin(),
      candidateId,
    );
    expect(results).toHaveLength(2);
    expect(effectiveResultId).toBe(secondId);
    const original = results.find((r) => r.id === firstId)!;
    expect(original.outcome).toBe("FAIL");
    expect(original.supersedesResultId).toBeNull();
  });

  it("refuses a correction that supersedes a result belonging to a different candidate", async () => {
    const a = await aConfirmedCandidate("res5a");
    const b = await aConfirmedCandidate("res5b");
    const { id: resultA } = await recordExamResult(admin(), {
      candidateId: a.candidateId,
      outcome: "FAIL",
      clientEventId: exid("ce_res5a"),
    });
    await expect(
      recordExamResult(admin(), {
        candidateId: b.candidateId,
        outcome: "PASS",
        supersedesResultId: resultA,
        reason: "reden",
        clientEventId: exid("ce_res5b"),
      }),
    ).rejects.toMatchObject({ reason: "SUPERSEDED_RESULT_MISMATCH" });
  });
});

describe("issueAward / revokeAward", () => {
  async function aPassResult(suffix: string) {
    const { groupId, pupil, awardTypeId } = await aQualifyingScenario(suffix);
    const { id: candidateId } = await registerExamCandidate(admin(), {
      studentProfileId: pupil.studentProfileId,
      awardTypeId,
      groupId,
    });
    await confirmExamCandidate(admin(), { candidateId });
    const { id: resultId } = await recordExamResult(admin(), {
      candidateId,
      outcome: "PASS",
      clientEventId: exid(`ce_${suffix}`),
    });
    return { resultId, candidateId };
  }

  it("issues an award against a PASS result", async () => {
    const { resultId } = await aPassResult("award1");
    const { id: awardId } = await issueAward(admin(), {
      resultId,
      number: exid("num_award1"),
    });
    const award = await prisma.award.findUnique({ where: { id: awardId } });
    expect(award).not.toBeNull();
    expect(award!.revokedAt).toBeNull();
  });

  it("refuses issuing against a FAIL result", async () => {
    const { candidateId } = await aPassResult("award2");
    const { id: failResultId } = await recordExamResult(admin(), {
      candidateId,
      outcome: "FAIL",
      clientEventId: exid("ce_award2_fail"),
      recordedAt: "2026-06-11",
    });
    await expect(
      issueAward(admin(), {
        resultId: failResultId,
        number: exid("num_award2"),
      }),
    ).rejects.toMatchObject({ reason: "RESULT_NOT_PASS" });
  });

  it("refuses a second award against a result that already has one", async () => {
    const { resultId } = await aPassResult("award3");
    await issueAward(admin(), { resultId, number: exid("num_award3a") });
    await expect(
      issueAward(admin(), { resultId, number: exid("num_award3b") }),
    ).rejects.toMatchObject({ reason: "RESULT_ALREADY_HAS_AWARD" });
  });

  it("revokes an award, setting revokedAt/revokeReason and leaving number/issuedAt untouched", async () => {
    const { resultId } = await aPassResult("award4");
    const { id: awardId } = await issueAward(admin(), {
      resultId,
      number: exid("num_award4"),
    });
    const before = await prisma.award.findUnique({ where: { id: awardId } });

    await revokeAward(admin(), {
      awardId,
      reason: "Diploma per abuis uitgereikt.",
    });

    const after = await prisma.award.findUnique({ where: { id: awardId } });
    expect(after!.revokedAt).not.toBeNull();
    expect(after!.revokeReason).toBe("Diploma per abuis uitgereikt.");
    expect(after!.number).toBe(before!.number);
    expect(after!.issuedAt).toEqual(before!.issuedAt);
  });

  it("refuses revoking an already-revoked award", async () => {
    const { resultId } = await aPassResult("award5");
    const { id: awardId } = await issueAward(admin(), {
      resultId,
      number: exid("num_award5"),
    });
    await revokeAward(admin(), { awardId, reason: "eerste keer" });
    await expect(
      revokeAward(admin(), { awardId, reason: "tweede keer" }),
    ).rejects.toMatchObject({ reason: "AWARD_ALREADY_REVOKED" });
  });
});

describe("PersonQualification — grant / end", () => {
  it("grants a qualification, valid from the stated date onward", async () => {
    const holder = await makePerson("qual_holder1");
    const { id } = await grantQualification(admin(), {
      personId: holder,
      type: "AFTEST_ASSESSOR",
    });
    const row = await prisma.personQualification.findUnique({ where: { id } });
    expect(row).not.toBeNull();
    expect(row!.grantedByPersonId).toBe(adminId);
    expect(row!.validTo).toBeNull();
  });

  it("refuses an end date before the start date", async () => {
    const holder = await makePerson("qual_holder2");
    await expect(
      grantQualification(admin(), {
        personId: holder,
        type: "AFTEST_ASSESSOR",
        validFrom: "2026-01-01",
        validTo: "2025-01-01",
      }),
    ).rejects.toMatchObject({ reason: "INVALID_WINDOW" });
  });

  it("ends a qualification early — an ordinary mutation of validTo, never a delete", async () => {
    const holder = await makePerson("qual_holder3");
    const { id } = await grantQualification(admin(), {
      personId: holder,
      type: "AFTEST_ASSESSOR",
      validFrom: "2020-01-01",
    });

    const validTo = "2026-06-10";
    await endQualification(admin(), { qualificationId: id, validTo });

    const row = await prisma.personQualification.findUnique({ where: { id } });
    expect(row).not.toBeNull();
    expect(row!.validTo).toEqual(new Date("2026-06-10T00:00:00.000Z"));
  });
});
