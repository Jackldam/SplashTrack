/**
 * `assessment-service.ts` against the real database — recording an aftest,
 * D-080's pass rule, D-086's completeness invariant, D-085's independence
 * check and its override, and the two different remark regimes (decided
 * 2026-09-10, `docs/build/phase-2.3-assessment-report.md` §1.5).
 *
 * The properties worth naming, because each is a design sentence:
 *
 *   - ONE TRANSACTION, ONE AUDIT EVENT per sitting (the D-126/`attendance`
 *     shape), and neither remark's VALUE ever appears in `changedFields`
 *     (only `assessmentRemarkGiven`/`criterionRemarkGiven` booleans).
 *   - D-086: an outcome is NEVER computed over an unset criterion — recording
 *     refuses the whole write (`INCOMPLETE`) rather than partially grading.
 *   - D-080: no `AwardType.kind` anywhere; the pass floor and its per-criterion
 *     override are the only inputs.
 *   - D-085 (the checkable half): an assessor who is the student's own
 *     instructor is refused (`NOT_INDEPENDENT`) unless they hold
 *     `assessment.independence.override`.
 *   - APPEND-ONLY corrections: a re-assessment is a new row carrying
 *     `supersedesAssessmentId`; the original is untouched.
 *   - `Assessment.remark` (sitting-level) is PLAIN, UNPROTECTED TEXT: no
 *     `students.notes.*` gate to set or see it, no audit-on-read.
 *   - `AssessmentCriterionResult.remark` (per-criterion) is STILL STORED
 *     SEALED (never plaintext), requires `students.notes.write` to set and
 *     `students.notes.read` to see, and a read that discloses one is audited
 *     exactly once, never carrying the value itself.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PermissionDeniedError } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import {
  getAssessmentsForStudent,
  getEffectiveAssessmentsForStudent,
  qualifyingAftestFacts,
  recordAssessment,
} from "@/modules/assessment";

import {
  addGuestRow,
  asid,
  ASSESSMENT_ADMIN_PERMISSIONS,
  ASSESSOR_PERMISSIONS,
  assignInstructorTo,
  grantTo,
  installRealRelations,
  makeAssessableSet,
  makeGroup,
  makeLesson,
  makeRole,
  makeStudent,
  makePerson,
  placeInGroup,
  resetAssessmentFixtures,
} from "../support/assessment-fixtures";

const NOW = new Date("2026-06-10T18:00:00.000Z");

let adminId: string;

function admin() {
  return { principal: { personId: adminId }, at: NOW };
}

beforeAll(() => {
  installRealRelations();
});

beforeEach(async () => {
  await resetAssessmentFixtures();
  adminId = await makePerson("svc_admin");
  await grantTo({
    personId: adminId,
    roleId: await makeRole("svc_role_admin", ASSESSMENT_ADMIN_PERMISSIONS),
    scopeType: "ORGANIZATION",
  });
});

afterAll(async () => {
  await resetAssessmentFixtures();
});

/** A pupil, an independent (non-instructor) assessor with a SESSION grant, one lesson. */
async function aSitting(suffix: string) {
  const groupId = await makeGroup(`g_${suffix}`);
  const pupil = await makeStudent(`p_${suffix}`);
  await placeInGroup(groupId, pupil.studentProfileId);
  const sessionId = await makeLesson(groupId, suffix);
  await addGuestRow(sessionId, pupil.studentProfileId);

  const assessorId = await makePerson(`assessor_${suffix}`);
  await grantTo({
    personId: assessorId,
    roleId: await makeRole(`role_assessor_${suffix}`, ASSESSOR_PERMISSIONS),
    scopeType: "SESSION",
    scopeId: sessionId,
    validUntil: new Date("2026-06-20T00:00:00.000Z"),
  });

  const set = await makeAssessableSet(suffix, 2);
  return { groupId, pupil, sessionId, assessorId, ...set };
}

function assessor(personId: string) {
  return { principal: { personId }, at: NOW };
}

describe("recordAssessment — D-080's pass rule, computed for real", () => {
  it("PASSes when every criterion meets the pass floor, writes both results in one transaction, and audits ONCE without the remark", async () => {
    const { sessionId, pupil, criterionSetId, criterionIds, gradeIds } =
      await aSitting("pass");

    const result = await recordAssessment(admin(), sessionId, {
      studentProfileId: pupil.studentProfileId,
      criterionSetId,
      clientEventId: asid("ce_pass"),
      results: criterionIds.map((criterionId) => ({
        criterionId,
        gradeValueId: gradeIds.voldoende,
      })),
    });

    expect(result.outcome).toBe("PASS");

    const stored = await prisma.assessment.findUniqueOrThrow({
      where: { id: result.id },
      include: { criterionResults: true },
    });
    expect(stored.outcome).toBe("PASS");
    expect(stored.criterionResults).toHaveLength(2);

    const events = await prisma.auditEvent.findMany({
      where: {
        eventType: "assessment.recorded",
        targetId: pupil.studentProfileId,
      },
    });
    expect(events).toHaveLength(1);
    const fields = events[0]!.changedFields as Record<string, unknown>;
    expect(fields.outcome).toBe("PASS");
    expect(fields.resultCount).toBe(2);
    expect(Object.keys(fields)).not.toContain("remark");
  });

  it("FAILs when one criterion falls short of the pass floor", async () => {
    const { sessionId, pupil, criterionSetId, criterionIds, gradeIds } =
      await aSitting("fail");

    const result = await recordAssessment(admin(), sessionId, {
      studentProfileId: pupil.studentProfileId,
      criterionSetId,
      clientEventId: asid("ce_fail"),
      results: [
        { criterionId: criterionIds[0]!, gradeValueId: gradeIds.voldoende },
        { criterionId: criterionIds[1]!, gradeValueId: gradeIds.matig },
      ],
    });

    expect(result.outcome).toBe("FAIL");
  });

  it("a waiver satisfies a criterion exactly like a passing result", async () => {
    const { sessionId, pupil, criterionSetId, criterionIds, gradeIds } =
      await aSitting("waiver");

    const result = await recordAssessment(admin(), sessionId, {
      studentProfileId: pupil.studentProfileId,
      criterionSetId,
      clientEventId: asid("ce_waiver"),
      results: [
        { criterionId: criterionIds[0]!, gradeValueId: gradeIds.zeergoed },
      ],
      waivers: [{ criterionId: criterionIds[1]!, reason: "blessure" }],
    });

    expect(result.outcome).toBe("PASS");
    const waivers = await prisma.criterionWaiver.findMany({
      where: { assessmentId: result.id },
    });
    expect(waivers).toHaveLength(1);
    expect(waivers[0]!.reason).toBe("blessure");
  });
});

describe("recordAssessment — D-086: never an outcome over an unset criterion", () => {
  it("refuses the WHOLE write when a criterion has neither a result nor a waiver", async () => {
    const { sessionId, pupil, criterionSetId, criterionIds, gradeIds } =
      await aSitting("incomplete");

    await expect(
      recordAssessment(admin(), sessionId, {
        studentProfileId: pupil.studentProfileId,
        criterionSetId,
        clientEventId: asid("ce_incomplete"),
        results: [
          { criterionId: criterionIds[0]!, gradeValueId: gradeIds.voldoende },
        ],
      }),
    ).rejects.toMatchObject({ reason: "INCOMPLETE" });

    expect(
      await prisma.assessment.count({
        where: { studentProfileId: pupil.studentProfileId },
      }),
    ).toBe(0);
  });

  it("refuses a criterion carrying BOTH a result and a waiver", async () => {
    const { sessionId, pupil, criterionSetId, criterionIds, gradeIds } =
      await aSitting("doubly");

    await expect(
      recordAssessment(admin(), sessionId, {
        studentProfileId: pupil.studentProfileId,
        criterionSetId,
        clientEventId: asid("ce_doubly"),
        results: [
          { criterionId: criterionIds[0]!, gradeValueId: gradeIds.voldoende },
          { criterionId: criterionIds[1]!, gradeValueId: gradeIds.voldoende },
        ],
        waivers: [{ criterionId: criterionIds[1]!, reason: "x" }],
      }),
    ).rejects.toMatchObject({ reason: "DOUBLY_DISPOSED_CRITERION" });
  });
});

describe("recordAssessment — the write guard and the roster/status refusals", () => {
  it("a caller with no grant at all is denied by the guard, not by a domain refusal", async () => {
    const { sessionId, pupil, criterionSetId, criterionIds, gradeIds } =
      await aSitting("nogrant");
    const nobodyId = await makePerson("nobody");

    await expect(
      recordAssessment(assessor(nobodyId), sessionId, {
        studentProfileId: pupil.studentProfileId,
        criterionSetId,
        clientEventId: asid("ce_nogrant"),
        results: criterionIds.map((criterionId) => ({
          criterionId,
          gradeValueId: gradeIds.voldoende,
        })),
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("refuses a student not on the session's roster (NOT_ON_ROSTER)", async () => {
    const { sessionId, criterionSetId, criterionIds, gradeIds } =
      await aSitting("roster");
    const stranger = await makeStudent("stranger_roster");

    await expect(
      recordAssessment(admin(), sessionId, {
        studentProfileId: stranger.studentProfileId,
        criterionSetId,
        clientEventId: asid("ce_roster"),
        results: criterionIds.map((criterionId) => ({
          criterionId,
          gradeValueId: gradeIds.voldoende,
        })),
      }),
    ).rejects.toMatchObject({ reason: "NOT_ON_ROSTER" });
  });

  it("refuses recording against a CANCELLED session", async () => {
    const groupId = await makeGroup("g_cancel");
    const pupil = await makeStudent("p_cancel");
    await placeInGroup(groupId, pupil.studentProfileId);
    const sessionId = await makeLesson(groupId, "cancel", {
      status: "CANCELLED",
    });
    await addGuestRow(sessionId, pupil.studentProfileId);
    const { criterionSetId, criterionIds, gradeIds } = await makeAssessableSet(
      "cancel",
      1,
    );

    await expect(
      recordAssessment(admin(), sessionId, {
        studentProfileId: pupil.studentProfileId,
        criterionSetId,
        clientEventId: asid("ce_cancel"),
        results: [
          { criterionId: criterionIds[0]!, gradeValueId: gradeIds.voldoende },
        ],
      }),
    ).rejects.toMatchObject({ reason: "SESSION_CANCELLED" });
  });

  it("refuses recording against a DRAFT criterion set (D-081)", async () => {
    const { sessionId, pupil, awardTypeId, criterionIds, gradeIds } =
      await aSitting("draft");
    const draftSetId = asid("set_draft_extra");
    await prisma.criterionSet.create({
      data: {
        id: draftSetId,
        awardTypeId,
        version: 2,
        source: "ORG",
        status: "DRAFT",
      },
    });
    const draftCriterionId = asid("crit_draft_extra");
    await prisma.criterion.create({
      data: {
        id: draftCriterionId,
        criterionSetId: draftSetId,
        code: "DRAFT1",
        name: "Draft criterion",
        sequence: 1,
      },
    });

    await expect(
      recordAssessment(admin(), sessionId, {
        studentProfileId: pupil.studentProfileId,
        criterionSetId: draftSetId,
        clientEventId: asid("ce_draft"),
        results: [
          { criterionId: draftCriterionId, gradeValueId: gradeIds.voldoende },
        ],
      }),
    ).rejects.toMatchObject({ reason: "CRITERION_SET_NOT_ACTIVE" });

    // Silence the unused-var lint for criterionIds pulled off aSitting.
    void criterionIds;
  });
});

describe("recordAssessment — P-02 idempotent replay", () => {
  it("a replayed clientEventId returns the original id and outcome, and writes nothing new", async () => {
    const { sessionId, pupil, criterionSetId, criterionIds, gradeIds } =
      await aSitting("replay");
    const clientEventId = asid("ce_replay");
    const input = {
      studentProfileId: pupil.studentProfileId,
      criterionSetId,
      clientEventId,
      results: criterionIds.map((criterionId) => ({
        criterionId,
        gradeValueId: gradeIds.voldoende,
      })),
    };

    const first = await recordAssessment(admin(), sessionId, input);
    const second = await recordAssessment(admin(), sessionId, input);

    expect(second).toEqual(first);
    expect(
      await prisma.assessment.count({
        where: { studentProfileId: pupil.studentProfileId },
      }),
    ).toBe(1);
  });
});

describe("recordAssessment — D-085's independence check and its override", () => {
  it("refuses an assessor who is the student's OWN instructor (NOT_INDEPENDENT)", async () => {
    const {
      groupId,
      sessionId,
      pupil,
      criterionSetId,
      criterionIds,
      gradeIds,
    } = await aSitting("owninstr");

    const ownInstructorId = await makePerson("own_instructor");
    await assignInstructorTo(groupId, ownInstructorId);
    await grantTo({
      personId: ownInstructorId,
      roleId: await makeRole("role_own_instructor", ASSESSOR_PERMISSIONS),
      scopeType: "SESSION",
      scopeId: sessionId,
      validUntil: new Date("2026-06-20T00:00:00.000Z"),
    });

    await expect(
      recordAssessment(assessor(ownInstructorId), sessionId, {
        studentProfileId: pupil.studentProfileId,
        criterionSetId,
        clientEventId: asid("ce_owninstr"),
        results: criterionIds.map((criterionId) => ({
          criterionId,
          gradeValueId: gradeIds.voldoende,
        })),
      }),
    ).rejects.toMatchObject({ reason: "NOT_INDEPENDENT" });

    expect(
      await prisma.assessment.count({
        where: { studentProfileId: pupil.studentProfileId },
      }),
    ).toBe(0);
  });

  it("a genuinely independent assessor (SESSION grant, no InstructorAssignment) succeeds without the override", async () => {
    const {
      sessionId,
      pupil,
      assessorId,
      criterionSetId,
      criterionIds,
      gradeIds,
    } = await aSitting("indep");

    const result = await recordAssessment(assessor(assessorId), sessionId, {
      studentProfileId: pupil.studentProfileId,
      criterionSetId,
      clientEventId: asid("ce_indep"),
      results: criterionIds.map((criterionId) => ({
        criterionId,
        gradeValueId: gradeIds.voldoende,
      })),
    });
    expect(result.outcome).toBe("PASS");

    const events = await prisma.auditEvent.findMany({
      where: {
        eventType: "assessment.recorded",
        targetId: pupil.studentProfileId,
      },
    });
    expect(
      (events[0]!.changedFields as Record<string, unknown>).independentAssessor,
    ).toBe(true);
  });

  it("the override permission lets the own instructor record it anyway, and the audit trail says so", async () => {
    const {
      groupId,
      sessionId,
      pupil,
      criterionSetId,
      criterionIds,
      gradeIds,
    } = await aSitting("override");

    const ownInstructorId = await makePerson("override_instructor");
    await assignInstructorTo(groupId, ownInstructorId);
    await grantTo({
      personId: ownInstructorId,
      roleId: await makeRole("role_override_instructor", [
        ...ASSESSOR_PERMISSIONS,
        "assessment.independence.override",
      ]),
      scopeType: "SESSION",
      scopeId: sessionId,
      validUntil: new Date("2026-06-20T00:00:00.000Z"),
    });

    const result = await recordAssessment(
      assessor(ownInstructorId),
      sessionId,
      {
        studentProfileId: pupil.studentProfileId,
        criterionSetId,
        clientEventId: asid("ce_override"),
        results: criterionIds.map((criterionId) => ({
          criterionId,
          gradeValueId: gradeIds.voldoende,
        })),
      },
    );
    expect(result.outcome).toBe("PASS");

    const events = await prisma.auditEvent.findMany({
      where: {
        eventType: "assessment.recorded",
        targetId: pupil.studentProfileId,
      },
    });
    expect(
      (events[0]!.changedFields as Record<string, unknown>).independentAssessor,
    ).toBe(false);
  });
});

describe("Assessment.remark (sitting-level) — unprotected plain text, decided 2026-09-10", () => {
  it("writes with a remark WITHOUT students.notes.write — the assessor role holds no notes permission at all", async () => {
    const {
      sessionId,
      assessorId,
      pupil,
      criterionSetId,
      criterionIds,
      gradeIds,
    } = await aSitting("plainwr");
    // ASSESSOR_PERMISSIONS is assessment.record/read only — see the fixtures.

    const result = await recordAssessment(assessor(assessorId), sessionId, {
      studentProfileId: pupil.studentProfileId,
      criterionSetId,
      clientEventId: asid("ce_plain_wr"),
      remark: "kind vertoont een schaarslag",
      results: criterionIds.map((criterionId) => ({
        criterionId,
        gradeValueId: gradeIds.voldoende,
      })),
    });

    expect(result.outcome).toBe("PASS");
  });

  it("is stored PLAINTEXT (never sealed) and is readable WITHOUT students.notes.read", async () => {
    const { sessionId, pupil, criterionSetId, criterionIds, gradeIds } =
      await aSitting("plainread");

    const plaintext = "kind vertoont een schaarslag";
    const result = await recordAssessment(admin(), sessionId, {
      studentProfileId: pupil.studentProfileId,
      criterionSetId,
      clientEventId: asid("ce_plain_read"),
      remark: plaintext,
      results: criterionIds.map((criterionId) => ({
        criterionId,
        gradeValueId: gradeIds.voldoende,
      })),
    });

    const stored = await prisma.assessment.findUniqueOrThrow({
      where: { id: result.id },
      select: { remark: true },
    });
    expect(stored.remark).toBe(plaintext);

    const readerId = await makePerson("reader_no_notes_sitting");
    await grantTo({
      personId: readerId,
      roleId: await makeRole("role_reader_no_notes_sitting", [
        "assessment.read",
      ]),
      scopeType: "ORGANIZATION",
    });

    const assessments = await getAssessmentsForStudent(
      { principal: { personId: readerId }, at: NOW },
      pupil.studentProfileId,
    );
    expect(assessments[0]!.remark).toBe(plaintext);

    const revealed = await prisma.auditEvent.count({
      where: {
        eventType: "assessment.remark_revealed",
        targetId: pupil.studentProfileId,
      },
    });
    expect(revealed).toBe(0);
  });
});

describe("AssessmentCriterionResult.remark (per-criterion) — D-087/D-148's protected free-text class, unchanged", () => {
  it("refuses the WHOLE write when a criterion-result remark is given but the caller lacks students.notes.write", async () => {
    const {
      sessionId,
      assessorId,
      pupil,
      criterionSetId,
      criterionIds,
      gradeIds,
    } = await aSitting("notewr");
    // The assessor role holds assessment.record/read but NOT students.notes.write.

    await expect(
      recordAssessment(assessor(assessorId), sessionId, {
        studentProfileId: pupil.studentProfileId,
        criterionSetId,
        clientEventId: asid("ce_notes_denied"),
        results: criterionIds.map((criterionId, i) => ({
          criterionId,
          gradeValueId: gradeIds.voldoende,
          ...(i === 0 ? { remark: "kind vertoont een schaarslag" } : {}),
        })),
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    expect(
      await prisma.assessment.count({
        where: { studentProfileId: pupil.studentProfileId },
      }),
    ).toBe(0);
  });

  it("stores a remark SEALED (never plaintext), and a reader holding students.notes.read sees it decrypted, audited once", async () => {
    const { sessionId, pupil, criterionSetId, criterionIds, gradeIds } =
      await aSitting("notes_ok");

    const plaintext = "kind vertoont een schaarslag";
    const result = await recordAssessment(admin(), sessionId, {
      studentProfileId: pupil.studentProfileId,
      criterionSetId,
      clientEventId: asid("ce_notes_ok"),
      results: criterionIds.map((criterionId, i) => ({
        criterionId,
        gradeValueId: gradeIds.voldoende,
        ...(i === 0 ? { remark: plaintext } : {}),
      })),
    });

    const stored = await prisma.assessmentCriterionResult.findMany({
      where: { assessmentId: result.id, criterionId: criterionIds[0]! },
      select: { remark: true },
    });
    expect(stored[0]!.remark).not.toBeNull();
    expect(stored[0]!.remark).not.toBe(plaintext);
    expect(stored[0]!.remark).toMatch(/^v1:/);

    const assessments = await getAssessmentsForStudent(
      admin(),
      pupil.studentProfileId,
    );
    const revealedResult = assessments[0]!.results.find(
      (r) => r.criterionId === criterionIds[0],
    );
    expect(revealedResult?.remark).toBe(plaintext);

    const revealed = await prisma.auditEvent.findMany({
      where: {
        eventType: "assessment.remark_revealed",
        targetId: pupil.studentProfileId,
      },
    });
    expect(revealed).toHaveLength(1);
    expect(JSON.stringify(revealed[0]!.changedFields)).not.toContain(plaintext);
  });

  it("degrades to null for a reader who lacks students.notes.read — grades survive", async () => {
    const { sessionId, pupil, criterionSetId, criterionIds, gradeIds } =
      await aSitting("notedg");

    await recordAssessment(admin(), sessionId, {
      studentProfileId: pupil.studentProfileId,
      criterionSetId,
      clientEventId: asid("ce_notes_degrade"),
      results: criterionIds.map((criterionId, i) => ({
        criterionId,
        gradeValueId: gradeIds.voldoende,
        ...(i === 0 ? { remark: "vertrouwelijk" } : {}),
      })),
    });

    const readerId = await makePerson("reader_no_notes");
    await grantTo({
      personId: readerId,
      roleId: await makeRole("role_reader_no_notes", ["assessment.read"]),
      scopeType: "ORGANIZATION",
    });

    const assessments = await getAssessmentsForStudent(
      { principal: { personId: readerId }, at: NOW },
      pupil.studentProfileId,
    );
    expect(
      assessments[0]!.results.find((r) => r.criterionId === criterionIds[0]),
    ).toMatchObject({ remark: null });
    expect(assessments[0]!.outcome).toBe("PASS");

    const revealed = await prisma.auditEvent.count({
      where: {
        eventType: "assessment.remark_revealed",
        targetId: pupil.studentProfileId,
      },
    });
    expect(revealed).toBe(0);
  });
});

describe("supersession — D-061/D-062 applied to Assessment", () => {
  it("a correction is a NEW row; the original is byte-for-byte untouched", async () => {
    const { sessionId, pupil, criterionSetId, criterionIds, gradeIds } =
      await aSitting("supersede");

    const original = await recordAssessment(admin(), sessionId, {
      studentProfileId: pupil.studentProfileId,
      criterionSetId,
      clientEventId: asid("ce_supersede_1"),
      results: [
        { criterionId: criterionIds[0]!, gradeValueId: gradeIds.matig },
        { criterionId: criterionIds[1]!, gradeValueId: gradeIds.matig },
      ],
    });
    expect(original.outcome).toBe("FAIL");
    const originalRow = await prisma.assessment.findUniqueOrThrow({
      where: { id: original.id },
    });

    const correction = await recordAssessment(admin(), sessionId, {
      studentProfileId: pupil.studentProfileId,
      criterionSetId,
      clientEventId: asid("ce_supersede_2"),
      supersedesAssessmentId: original.id,
      results: criterionIds.map((criterionId) => ({
        criterionId,
        gradeValueId: gradeIds.voldoende,
      })),
    });
    expect(correction.outcome).toBe("PASS");

    await expect(
      prisma.assessment.findUniqueOrThrow({ where: { id: original.id } }),
    ).resolves.toEqual(originalRow);

    const effective = await getEffectiveAssessmentsForStudent(
      admin(),
      pupil.studentProfileId,
    );
    expect(effective.get(criterionSetId)).toMatchObject({
      assessmentId: correction.id,
      outcome: "PASS",
    });
  });

  it("refuses a supersedesAssessmentId belonging to a DIFFERENT student (SUPERSEDED_ASSESSMENT_MISMATCH)", async () => {
    const a = await aSitting("mismatch_a");
    const b = await aSitting("mismatch_b");

    const originalA = await recordAssessment(admin(), a.sessionId, {
      studentProfileId: a.pupil.studentProfileId,
      criterionSetId: a.criterionSetId,
      clientEventId: asid("ce_mismatch_a"),
      results: a.criterionIds.map((criterionId) => ({
        criterionId,
        gradeValueId: a.gradeIds.voldoende,
      })),
    });

    await expect(
      recordAssessment(admin(), b.sessionId, {
        studentProfileId: b.pupil.studentProfileId,
        criterionSetId: b.criterionSetId,
        clientEventId: asid("ce_mismatch_b"),
        supersedesAssessmentId: originalA.id,
        results: b.criterionIds.map((criterionId) => ({
          criterionId,
          gradeValueId: b.gradeIds.voldoende,
        })),
      }),
    ).rejects.toMatchObject({ reason: "SUPERSEDED_ASSESSMENT_MISMATCH" });
  });
});

describe("qualifyingAftestFacts — the published fact exams will read (D-085)", () => {
  it("answers false, with no assessment, when nobody has sat the aftest", async () => {
    const { awardTypeId, pupil } = await aSitting("facts_none");
    const facts = await qualifyingAftestFacts(
      pupil.studentProfileId,
      awardTypeId,
    );
    expect(facts).toMatchObject({
      hasQualifyingAssessment: false,
      assessmentId: null,
      qualificationVerified: false,
    });
  });

  it("answers true with the qualifying assessment once an independent PASS exists", async () => {
    const {
      sessionId,
      pupil,
      assessorId,
      awardTypeId,
      criterionSetId,
      criterionIds,
      gradeIds,
    } = await aSitting("facts_pass");

    const result = await recordAssessment(assessor(assessorId), sessionId, {
      studentProfileId: pupil.studentProfileId,
      criterionSetId,
      clientEventId: asid("ce_facts_pass"),
      results: criterionIds.map((criterionId) => ({
        criterionId,
        gradeValueId: gradeIds.voldoende,
      })),
    });

    const facts = await qualifyingAftestFacts(
      pupil.studentProfileId,
      awardTypeId,
    );
    expect(facts).toMatchObject({
      hasQualifyingAssessment: true,
      assessmentId: result.id,
      independentOfStudentGroup: true,
      qualificationVerified: false,
    });
  });

  it("a superseded PASS no longer qualifies once corrected to FAIL", async () => {
    const {
      sessionId,
      pupil,
      awardTypeId,
      criterionSetId,
      criterionIds,
      gradeIds,
    } = await aSitting("factssup");

    const original = await recordAssessment(admin(), sessionId, {
      studentProfileId: pupil.studentProfileId,
      criterionSetId,
      clientEventId: asid("ce_facts_superseded_1"),
      results: criterionIds.map((criterionId) => ({
        criterionId,
        gradeValueId: gradeIds.voldoende,
      })),
    });
    await recordAssessment(admin(), sessionId, {
      studentProfileId: pupil.studentProfileId,
      criterionSetId,
      clientEventId: asid("ce_facts_superseded_2"),
      supersedesAssessmentId: original.id,
      results: [
        { criterionId: criterionIds[0]!, gradeValueId: gradeIds.matig },
        { criterionId: criterionIds[1]!, gradeValueId: gradeIds.matig },
      ],
    });

    const facts = await qualifyingAftestFacts(
      pupil.studentProfileId,
      awardTypeId,
    );
    expect(facts.hasQualifyingAssessment).toBe(false);
  });
});
