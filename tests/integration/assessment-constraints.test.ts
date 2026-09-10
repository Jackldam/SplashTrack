/**
 * The hand-written constraints of `20260909100000_assessment_module` —
 * invisible in `schema.prisma` and easy to lose in a future "regenerate the
 * migrations" tidy-up, which is why they are named and proved here (the
 * `attendance-constraints.test.ts` pattern, one module later).
 *
 *   - `Assessment_no_self_supersede_check` — a row cannot supersede itself.
 *     The service never writes one (it reads the superseded row first); the
 *     CHECK is the backstop against a path nobody has written.
 *   - `Assessment_clientEventId_key` — P-02's idempotency: two rows with one
 *     client id cannot exist, even under a race the service's pre-read
 *     cannot see.
 *   - `AssessmentCriterionResult_assessmentId_criterionId_key` /
 *     `CriterionWaiver_assessmentId_criterionId_key` — one result and one
 *     waiver per criterion per sitting.
 *
 * The cross-row half of D-061/D-062's rule — a correction points at an
 * assessment of the SAME student and criterion set — is a rule no CHECK can
 * state; it is enforced in `recordAssessment` and pinned in
 * `assessment-services.test.ts`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/database";
import { recordAssessment } from "@/modules/assessment";

import {
  addGuestRow,
  asid,
  ASSESSMENT_ADMIN_PERMISSIONS,
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

beforeAll(() => {
  installRealRelations();
});

beforeEach(async () => {
  await resetAssessmentFixtures();
  adminId = await makePerson("con_admin");
  await grantTo({
    personId: adminId,
    roleId: await makeRole("con_role_admin", ASSESSMENT_ADMIN_PERMISSIONS),
    scopeType: "ORGANIZATION",
  });
});

afterAll(async () => {
  await resetAssessmentFixtures();
});

async function aRecordedSitting(suffix: string) {
  const groupId = await makeGroup(`con_${suffix}`);
  const pupil = await makeStudent(`con_p_${suffix}`);
  await placeInGroup(groupId, pupil.studentProfileId);
  const sessionId = await makeLesson(groupId, `con_${suffix}`);
  await addGuestRow(sessionId, pupil.studentProfileId);
  const set = await makeAssessableSet(`con${suffix}`, 1);

  const written = await recordAssessment(admin(), sessionId, {
    studentProfileId: pupil.studentProfileId,
    criterionSetId: set.criterionSetId,
    clientEventId: asid(`ce_con_${suffix}`),
    results: [
      {
        criterionId: set.criterionIds[0]!,
        gradeValueId: set.gradeIds.voldoende,
      },
    ],
  });
  const assessment = await prisma.assessment.findUniqueOrThrow({
    where: { id: written.id },
  });
  return { groupId, sessionId, pupil, set, assessment };
}

describe("Assessment_no_self_supersede_check", () => {
  it("refuses a row that supersedes itself, at the database", async () => {
    const { assessment } = await aRecordedSitting("self");

    const selfId = asid("con_self_row");
    await expect(
      prisma.$executeRaw`
        INSERT INTO "Assessment"
          ("id", "kind", "criterionSetId", "studentProfileId", "assessedAt",
           "scheduledSessionId", "outcome", "outcomeComputedAt",
           "supersedesAssessmentId", "groupId", "clientEventId")
        VALUES
          (${selfId}, 'PRE_EXAM', ${assessment.criterionSetId},
           ${assessment.studentProfileId}, ${NOW}, ${assessment.scheduledSessionId},
           'PASS', ${NOW}, ${selfId}, ${assessment.groupId}, ${asid("ce_con_self_row")})
      `,
    ).rejects.toThrow(/no_self_supersede/i);
  });
});

describe("Assessment_clientEventId_key", () => {
  it("refuses a second row with the same client id — the race the service's pre-read cannot see", async () => {
    const { assessment } = await aRecordedSitting("dup");

    const secondId = asid("con_dup_row");
    await expect(
      prisma.$executeRaw`
        INSERT INTO "Assessment"
          ("id", "kind", "criterionSetId", "studentProfileId", "assessedAt",
           "outcome", "outcomeComputedAt", "groupId", "clientEventId")
        VALUES
          (${secondId}, 'PRE_EXAM', ${assessment.criterionSetId},
           ${assessment.studentProfileId}, ${NOW}, 'PASS', ${NOW},
           ${assessment.groupId}, ${assessment.clientEventId})
      `,
    ).rejects.toThrow(/unique/i);
  });
});

describe("AssessmentCriterionResult_assessmentId_criterionId_key", () => {
  it("refuses a second result for the same (assessment, criterion) pair", async () => {
    const { assessment, set } = await aRecordedSitting("resultdup");

    await expect(
      prisma.assessmentCriterionResult.create({
        data: {
          assessmentId: assessment.id,
          criterionId: set.criterionIds[0]!,
          gradeValueId: set.gradeIds.goed,
        },
      }),
    ).rejects.toThrow(/unique/i);
  });
});

describe("CriterionWaiver_assessmentId_criterionId_key", () => {
  it("refuses a second waiver for the same (assessment, criterion) pair", async () => {
    const { assessment, set } = await aRecordedSitting("waiverdup");

    await prisma.criterionWaiver.create({
      data: {
        assessmentId: assessment.id,
        criterionId: set.criterionIds[0]!,
        reason: "eerste",
      },
    });
    await expect(
      prisma.criterionWaiver.create({
        data: {
          assessmentId: assessment.id,
          criterionId: set.criterionIds[0]!,
          reason: "tweede",
        },
      }),
    ).rejects.toThrow(/unique/i);
  });
});
