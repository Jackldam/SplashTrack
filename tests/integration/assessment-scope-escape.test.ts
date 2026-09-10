/**
 * The per-module scope-escape suite `06-delivery.md` §2.1 requires, for
 * `assessment`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WRITES GUARD `{ session }` — THE ATTENDANCE/D-179 SHAPE, AND FOUR-EYES IS A
 * LAYERED DOMAIN CHECK, DISTINGUISHABLE FROM THE GUARD'S OWN DENIAL
 *
 * Three shapes are pinned by name:
 *
 *   1. A `SESSION`-scoped independent assessor can record on exactly that
 *      lesson and nothing else (D-068/D-179's weekly machinery).
 *   2. A `GROUP`-scoped instructor recording their OWN pupil's aftest is
 *      refused `NOT_INDEPENDENT` — a domain refusal AFTER the guard passes
 *      (they DO hold `{ session }` reach, via their group's own lesson) —
 *      and the override permission lets them through anyway.
 *   3. `getAssessmentsForStudent`'s `GROUP` narrowing: a pupil assessed
 *      through two different groups yields one row to each group's own
 *      reader and both to the organization (D-145 rule 2, the
 *      `SkillProgress`/`AttendanceEvent` precedent, applied a third time).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PermissionDeniedError } from "@/lib/authorization";
import {
  getAssessmentsForStudent,
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
  makePerson,
  makeRole,
  makeStudent,
  placeInGroup,
  resetAssessmentFixtures,
} from "../support/assessment-fixtures";

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
  await resetAssessmentFixtures();
  adminId = await makePerson("esc_admin");
  await grantTo({
    personId: adminId,
    roleId: await makeRole("esc_role_admin", ASSESSMENT_ADMIN_PERMISSIONS),
    scopeType: "ORGANIZATION",
  });
});

afterAll(async () => {
  await resetAssessmentFixtures();
});

describe("a SESSION-scoped independent assessor", () => {
  it("records on exactly that lesson, and is denied the next one", async () => {
    const groupId = await makeGroup("esc_g1");
    const pupil = await makeStudent("esc_p1");
    await placeInGroup(groupId, pupil.studentProfileId);
    const lessonA = await makeLesson(groupId, "esc_la", {
      isoDate: "2026-06-10",
    });
    const lessonB = await makeLesson(groupId, "esc_lb", {
      isoDate: "2026-06-17",
    });
    await addGuestRow(lessonA, pupil.studentProfileId);
    await addGuestRow(lessonB, pupil.studentProfileId);

    const assessorId = await makePerson("esc_assessor1");
    await grantTo({
      personId: assessorId,
      roleId: await makeRole("esc_role_a1", ASSESSOR_PERMISSIONS),
      scopeType: "SESSION",
      scopeId: lessonA,
      validUntil: new Date("2026-06-20T00:00:00.000Z"),
    });

    const set = await makeAssessableSet("esc1", 1);

    await expect(
      recordAssessment(actorFor(assessorId), lessonA, {
        studentProfileId: pupil.studentProfileId,
        criterionSetId: set.criterionSetId,
        clientEventId: asid("esc_ce_a"),
        results: [
          {
            criterionId: set.criterionIds[0]!,
            gradeValueId: set.gradeIds.voldoende,
          },
        ],
      }),
    ).resolves.toMatchObject({ outcome: "PASS" });

    await expect(
      recordAssessment(actorFor(assessorId), lessonB, {
        studentProfileId: pupil.studentProfileId,
        criterionSetId: set.criterionSetId,
        clientEventId: asid("esc_ce_b"),
        results: [
          {
            criterionId: set.criterionIds[0]!,
            gradeValueId: set.gradeIds.voldoende,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("a GROUP-scoped instructor recording their OWN pupil", () => {
  it("is denied by the GUARD for a lesson outside their group", async () => {
    const groupA = await makeGroup("esc_ga2");
    const groupB = await makeGroup("esc_gb2");
    const pupilB = await makeStudent("esc_pb2");
    await placeInGroup(groupB, pupilB.studentProfileId);
    const lessonB = await makeLesson(groupB, "esc_lb2");
    await addGuestRow(lessonB, pupilB.studentProfileId);

    const instructorId = await makePerson("esc_instr2");
    await assignInstructorTo(groupA, instructorId);
    await grantTo({
      personId: instructorId,
      roleId: await makeRole("esc_role_instr2", ASSESSOR_PERMISSIONS),
      scopeType: "GROUP",
      scopeId: groupA,
    });

    const set = await makeAssessableSet("esc2", 1);

    await expect(
      recordAssessment(actorFor(instructorId), lessonB, {
        studentProfileId: pupilB.studentProfileId,
        criterionSetId: set.criterionSetId,
        clientEventId: asid("esc_ce2"),
        results: [
          {
            criterionId: set.criterionIds[0]!,
            gradeValueId: set.gradeIds.voldoende,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("passes the GUARD for their own group's lesson, but is refused NOT_INDEPENDENT by the layered domain check — and the override lets them through", async () => {
    const groupA = await makeGroup("esc_ga3");
    const pupilA = await makeStudent("esc_pa3");
    await placeInGroup(groupA, pupilA.studentProfileId);
    const lessonA = await makeLesson(groupA, "esc_la3");

    const instructorId = await makePerson("esc_instr3");
    await assignInstructorTo(groupA, instructorId);
    await grantTo({
      personId: instructorId,
      roleId: await makeRole("esc_role_instr3", ASSESSOR_PERMISSIONS),
      scopeType: "GROUP",
      scopeId: groupA,
    });

    const set = await makeAssessableSet("esc3", 1);

    // The guard itself passes — GROUP coverage includes the group's own
    // sessions — so the refusal below is the LAYERED domain check, not
    // PermissionDeniedError.
    await expect(
      recordAssessment(actorFor(instructorId), lessonA, {
        studentProfileId: pupilA.studentProfileId,
        criterionSetId: set.criterionSetId,
        clientEventId: asid("esc_ce3a"),
        results: [
          {
            criterionId: set.criterionIds[0]!,
            gradeValueId: set.gradeIds.voldoende,
          },
        ],
      }),
    ).rejects.toMatchObject({
      name: "AssessmentError",
      reason: "NOT_INDEPENDENT",
    });

    await grantTo({
      personId: instructorId,
      roleId: await makeRole("esc_role_override3", [
        ...ASSESSOR_PERMISSIONS,
        "assessment.independence.override",
      ]),
      scopeType: "GROUP",
      scopeId: groupA,
    });

    await expect(
      recordAssessment(actorFor(instructorId), lessonA, {
        studentProfileId: pupilA.studentProfileId,
        criterionSetId: set.criterionSetId,
        clientEventId: asid("esc_ce3b"),
        results: [
          {
            criterionId: set.criterionIds[0]!,
            gradeValueId: set.gradeIds.voldoende,
          },
        ],
      }),
    ).resolves.toMatchObject({ outcome: "PASS" });
  });
});

describe("no grant at all", () => {
  it("is denied recording and reading outright", async () => {
    const groupId = await makeGroup("esc_g4");
    const pupil = await makeStudent("esc_p4");
    await placeInGroup(groupId, pupil.studentProfileId);
    const lessonId = await makeLesson(groupId, "esc_l4");
    await addGuestRow(lessonId, pupil.studentProfileId);
    const set = await makeAssessableSet("esc4", 1);
    const nobodyId = await makePerson("esc_nobody4");

    await expect(
      recordAssessment(actorFor(nobodyId), lessonId, {
        studentProfileId: pupil.studentProfileId,
        criterionSetId: set.criterionSetId,
        clientEventId: asid("esc_ce4"),
        results: [
          {
            criterionId: set.criterionIds[0]!,
            gradeValueId: set.gradeIds.voldoende,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    await expect(
      getAssessmentsForStudent(actorFor(nobodyId), pupil.studentProfileId),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("getAssessmentsForStudent — only GROUP narrows (D-145 rule 2)", () => {
  it("a pupil assessed through two groups yields one row to each group's own reader, both to the organization", async () => {
    const groupA = await makeGroup("esc_ga5");
    const groupB = await makeGroup("esc_gb5");
    const pupil = await makeStudent("esc_p5");
    await placeInGroup(groupA, pupil.studentProfileId);
    await placeInGroup(groupB, pupil.studentProfileId);
    const lessonA = await makeLesson(groupA, "esc_la5", {
      isoDate: "2026-06-10",
    });
    const lessonB = await makeLesson(groupB, "esc_lb5", {
      isoDate: "2026-06-11",
    });
    await addGuestRow(lessonA, pupil.studentProfileId);
    await addGuestRow(lessonB, pupil.studentProfileId);

    const setA = await makeAssessableSet("esc5a", 1);
    const setB = await makeAssessableSet("esc5b", 1);

    await recordAssessment(admin(), lessonA, {
      studentProfileId: pupil.studentProfileId,
      criterionSetId: setA.criterionSetId,
      clientEventId: asid("esc_ce5a"),
      results: [
        {
          criterionId: setA.criterionIds[0]!,
          gradeValueId: setA.gradeIds.voldoende,
        },
      ],
    });
    await recordAssessment(admin(), lessonB, {
      studentProfileId: pupil.studentProfileId,
      criterionSetId: setB.criterionSetId,
      clientEventId: asid("esc_ce5b"),
      results: [
        {
          criterionId: setB.criterionIds[0]!,
          gradeValueId: setB.gradeIds.voldoende,
        },
      ],
    });

    const readerA = await makePerson("esc_readerA5");
    await assignInstructorTo(groupA, readerA);
    await grantTo({
      personId: readerA,
      roleId: await makeRole("esc_role_readerA5", ["assessment.read"]),
      scopeType: "GROUP",
      scopeId: groupA,
    });

    const seenByA = await getAssessmentsForStudent(
      actorFor(readerA),
      pupil.studentProfileId,
    );
    expect(seenByA).toHaveLength(1);
    expect(seenByA[0]!.criterionSetId).toBe(setA.criterionSetId);

    const seenByOrg = await getAssessmentsForStudent(
      admin(),
      pupil.studentProfileId,
    );
    expect(seenByOrg).toHaveLength(2);
  });
});
