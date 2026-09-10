/**
 * The per-module scope-escape suite `06-delivery.md` §2.1 requires, for
 * `exams`.
 *
 * Three shapes are pinned by name:
 *
 *   1. A `SESSION`-scoped external examiner (D-052/D-068) can record an exam
 *      result on exactly the lesson slot their grant names, and is denied on
 *      another — the `assessment-scope-escape.test.ts` shape, applied to
 *      `ExamResult.scheduledSessionId`.
 *   2. A `GROUP`-scoped exams manager reaches a candidacy through the
 *      candidate's OWN `groupId` snapshot (D-145 rule 2) — denied for a
 *      candidate registered under a group they do not manage, even though
 *      the student is real and the award type is real.
 *   3. No grant at all is denied outright, for both the write and the read.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PermissionDeniedError } from "@/lib/authorization";
import { recordAssessment } from "@/modules/assessment";
import {
  confirmExamCandidate,
  getExamCandidatesForStudent,
  recordExamResult,
  registerExamCandidate,
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

function actorFor(personId: string) {
  return { principal: { personId }, at: NOW };
}

beforeAll(() => {
  installRealRelations();
});

beforeEach(async () => {
  await resetExamsFixtures();
  adminId = await makePerson("esc_admin");
  await grantTo({
    personId: adminId,
    roleId: await makeRole("esc_role_admin", EXAMS_ADMIN_PERMISSIONS),
    scopeType: "ORGANIZATION",
  });
});

afterAll(async () => {
  await resetExamsFixtures();
});

/** A confirmed candidate, ready for a result — the services test's own helper. */
async function aConfirmedCandidate(suffix: string) {
  const groupId = await makeGroup(`g_${suffix}`);
  const pupil = await makeStudent(`p_${suffix}`);
  await placeInGroup(groupId, pupil.studentProfileId);
  const assessor = await makePerson(`assessor_${suffix}`);
  await makeQualification(assessor, suffix);
  const { awardTypeId, criterionSetId, gradeIds, criterionId } =
    await makeAssessableSet(suffix);
  const sessionId = await makeLesson(groupId, suffix);
  await grantTo({
    personId: assessor,
    roleId: await makeRole(`assessor_role_${suffix}`, [
      "assessment.read",
      "assessment.record",
    ]),
    scopeType: "SESSION",
    scopeId: sessionId,
    validUntil: new Date("2026-12-31T00:00:00Z"),
  });
  await recordAssessment(actorFor(assessor), sessionId, {
    studentProfileId: pupil.studentProfileId,
    criterionSetId,
    clientEventId: exid(`ce_${suffix}`),
    results: [{ criterionId, gradeValueId: gradeIds.voldoende }],
  });
  const { id: candidateId } = await registerExamCandidate(admin(), {
    studentProfileId: pupil.studentProfileId,
    awardTypeId,
    groupId,
  });
  await confirmExamCandidate(admin(), { candidateId });
  return { candidateId, pupil, groupId };
}

describe("a SESSION-scoped external examiner (D-052/D-068)", () => {
  it("records an exam result on exactly the lesson their grant names, and is denied on another", async () => {
    const { candidateId, pupil, groupId } = await aConfirmedCandidate("sess1");
    const lessonA = await makeLesson(groupId, "sess1_a", {
      isoDate: "2026-06-20",
    });
    const lessonB = await makeLesson(groupId, "sess1_b", {
      isoDate: "2026-06-27",
    });

    const examinerId = await makePerson("sess1_examiner");
    // No membership, no standing grant — D-052's own words — only a
    // SESSION-scoped, time-bounded grant over lessonA.
    await grantTo({
      personId: examinerId,
      roleId: await makeRole("sess1_role", ["exams.results.record"]),
      scopeType: "SESSION",
      scopeId: lessonA,
      validUntil: new Date("2026-07-01T00:00:00Z"),
    });

    await expect(
      recordExamResult(actorFor(examinerId), {
        candidateId,
        outcome: "PASS",
        scheduledSessionId: lessonA,
        clientEventId: exid("sess1_ce_a"),
      }),
    ).resolves.toMatchObject({ outcome: "PASS" });

    await expect(
      recordExamResult(actorFor(examinerId), {
        candidateId,
        outcome: "PASS",
        scheduledSessionId: lessonB,
        clientEventId: exid("sess1_ce_b"),
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    void pupil;
  });
});

describe("GROUP-scoped reach follows the candidacy's OWN groupId snapshot (D-145 rule 2)", () => {
  it("an exams manager scoped to a DIFFERENT group is denied, even for a real student and award type", async () => {
    const { candidateId } = await aConfirmedCandidate("grp1");
    const otherGroupId = await makeGroup("grp1_other");

    const managerId = await makePerson("grp1_manager");
    await grantTo({
      personId: managerId,
      roleId: await makeRole("grp1_role", [
        "exams.read",
        "exams.manage",
        "exams.results.record",
      ]),
      scopeType: "GROUP",
      scopeId: otherGroupId,
    });

    await expect(
      recordExamResult(actorFor(managerId), {
        candidateId,
        outcome: "PASS",
        clientEventId: exid("grp1_ce"),
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("an exams manager scoped to the candidacy's OWN group succeeds", async () => {
    const { candidateId, groupId } = await aConfirmedCandidate("grp2");

    const managerId = await makePerson("grp2_manager");
    await assignInstructorTo(groupId, managerId);
    await grantTo({
      personId: managerId,
      roleId: await makeRole("grp2_role", [
        "exams.read",
        "exams.manage",
        "exams.results.record",
      ]),
      scopeType: "GROUP",
      scopeId: groupId,
    });

    await expect(
      recordExamResult(actorFor(managerId), {
        candidateId,
        outcome: "PASS",
        clientEventId: exid("grp2_ce"),
      }),
    ).resolves.toMatchObject({ outcome: "PASS" });
  });

  it("getExamCandidatesForStudent narrows to the reader's own group; the organization sees everything", async () => {
    const groupA = await makeGroup("grp3_a");
    const groupB = await makeGroup("grp3_b");
    const pupil = await makeStudent("grp3_p");
    await placeInGroup(groupA, pupil.studentProfileId);
    await placeInGroup(groupB, pupil.studentProfileId);
    const setA = await makeAssessableSet("grp3a");
    const setB = await makeAssessableSet("grp3b");

    await registerExamCandidate(admin(), {
      studentProfileId: pupil.studentProfileId,
      awardTypeId: setA.awardTypeId,
      groupId: groupA,
    });
    await registerExamCandidate(admin(), {
      studentProfileId: pupil.studentProfileId,
      awardTypeId: setB.awardTypeId,
      groupId: groupB,
    });

    const readerA = await makePerson("grp3_readerA");
    await assignInstructorTo(groupA, readerA);
    await grantTo({
      personId: readerA,
      roleId: await makeRole("grp3_role_readerA", ["exams.read"]),
      scopeType: "GROUP",
      scopeId: groupA,
    });

    const seenByA = await getExamCandidatesForStudent(
      actorFor(readerA),
      pupil.studentProfileId,
    );
    expect(seenByA).toHaveLength(1);
    expect(seenByA[0]!.groupId).toBe(groupA);

    const seenByOrg = await getExamCandidatesForStudent(
      admin(),
      pupil.studentProfileId,
    );
    expect(seenByOrg).toHaveLength(2);
  });
});

describe("no grant at all", () => {
  it("is denied recording a result and reading candidacies outright", async () => {
    const { candidateId, pupil } = await aConfirmedCandidate("noperm1");
    const nobodyId = await makePerson("noperm1_nobody");

    await expect(
      recordExamResult(actorFor(nobodyId), {
        candidateId,
        outcome: "PASS",
        clientEventId: exid("noperm1_ce"),
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    await expect(
      getExamCandidatesForStudent(actorFor(nobodyId), pupil.studentProfileId),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
