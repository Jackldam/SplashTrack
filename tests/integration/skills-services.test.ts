/**
 * Functional coverage for the `skills` module's application services —
 * `award-type-service.ts`, `criterion-set-service.ts`, `criterion-service.ts`,
 * `skill-progress-service.ts` — against a real Postgres. On the
 * `courses-services.test.ts` pattern.
 *
 * WHAT THIS FILE PINS THAT THE SCOPE-ESCAPE SUITE DOES NOT:
 *   - ordinary create/update/publish flows and their validation errors;
 *   - D-081's versioning transition (publish flips DRAFT -> ACTIVE and
 *     RETIRES the previous ACTIVE version, in one transaction);
 *   - the domain refusals (SEQUENCE_TAKEN, SET_NOT_DRAFT, NOT_DRAFT,
 *     EMPTY_SET, NO_PASS_FLOOR, NOT_A_GROUP_MEMBER, CRITERION_NOT_ACTIVE)
 *     surfacing through the service, not only through the pure functions;
 *   - the append-only invariant: SkillProgress rows are never updated, a
 *     REVOKED observation is a new row.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PermissionDeniedError } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { ApiError } from "@/lib/errors";
import {
  createAwardType,
  createCriterion,
  createCriterionSet,
  CriterionError,
  CriterionSetError,
  getAwardTypeForPrincipal,
  getCriterionSetForPrincipal,
  getSkillProgressForStudent,
  listAwardTypesForPrincipal,
  listGradeScalesForPrincipal,
  publishCriterionSet,
  recordSkillProgress,
  SkillProgressError,
  updateAwardType,
  updateCriterion,
  updateCriterionSet,
} from "@/modules/skills";

import {
  SKILLS_ADMIN_PERMISSIONS,
  grantTo,
  installRealRelations,
  makeAwardType,
  makeCourse,
  makeCourseLevel,
  makeCriterion,
  makeCriterionSet,
  makeFiveGradeScale,
  makeGroupAtLevel,
  makePerson,
  makeRole,
  makeStudent,
  placeInGroup,
  resetSkillsFixtures,
} from "../support/skills-fixtures";

const NOW = new Date("2026-06-01T12:00:00.000Z");

let adminId: string;

function admin() {
  return { principal: { personId: adminId }, at: NOW };
}

beforeAll(() => {
  installRealRelations();
});

beforeEach(async () => {
  await resetSkillsFixtures();
  adminId = await makePerson("svc_admin");
  const adminRoleId = await makeRole(
    "svc_role_admin",
    SKILLS_ADMIN_PERMISSIONS,
  );
  await grantTo({
    personId: adminId,
    roleId: adminRoleId,
    scopeType: "ORGANIZATION",
  });
});

afterAll(async () => {
  await resetSkillsFixtures();
});

describe("createAwardType / updateAwardType", () => {
  it("creates an award type with the supplied fields", async () => {
    const { id } = await createAwardType(admin(), {
      code: "skillsfx_svc_a",
      name: "Zwemdiploma A",
      kind: "DIPLOMA",
      issuingBody: "NRZ",
    });
    const row = await prisma.awardType.findUniqueOrThrow({ where: { id } });
    expect(row.code).toBe("skillsfx_svc_a");
    expect(row.kind).toBe("DIPLOMA");
    expect(row.issuingBody).toBe("NRZ");
  });

  it("refuses a blank name (ApiError VALIDATION_ERROR)", async () => {
    await expect(
      createAwardType(admin(), {
        code: "skillsfx_svc_blank",
        name: "   ",
        kind: "DIPLOMA",
        issuingBody: "NRZ",
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("requires skills.manage_catalogue — a reader is denied", async () => {
    const readerId = await makePerson("svc_reader");
    const readerRoleId = await makeRole("svc_role_reader", ["skills.read"]);
    await grantTo({
      personId: readerId,
      roleId: readerRoleId,
      scopeType: "ORGANIZATION",
    });

    await expect(
      createAwardType(
        { principal: { personId: readerId }, at: NOW },
        {
          code: "skillsfx_svc_denied",
          name: "X",
          kind: "DIPLOMA",
          issuingBody: "ORG",
        },
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("updateAwardType changes name and issuingBody, never code or kind", async () => {
    const { id } = await createAwardType(admin(), {
      code: "skillsfx_svc_upd",
      name: "Origineel",
      kind: "DIPLOMA",
      issuingBody: "NRZ",
    });
    await updateAwardType(admin(), id, { name: "Herzien", issuingBody: "ORG" });
    const row = await prisma.awardType.findUniqueOrThrow({ where: { id } });
    expect(row.name).toBe("Herzien");
    expect(row.issuingBody).toBe("ORG");
    expect(row.code).toBe("skillsfx_svc_upd");
    expect(row.kind).toBe("DIPLOMA");
  });
});

describe("listAwardTypesForPrincipal / getAwardTypeForPrincipal", () => {
  it("reports whether an award type has an ACTIVE criterion set", async () => {
    const awardTypeId = await makeAwardType("svc_list_active");
    const list1 = await listAwardTypesForPrincipal(admin());
    expect(list1.find((a) => a.id === awardTypeId)?.hasActiveCriterionSet).toBe(
      false,
    );

    const { gradeIds } = await makeFiveGradeScale("svc_list_active");
    const setId = await makeCriterionSet(awardTypeId, "svc_list_active", {
      status: "DRAFT",
      passFloorGradeId: gradeIds.voldoende,
    });
    await makeCriterion(setId, "svc_list_active", { sequence: 1 });
    await publishCriterionSet(admin(), setId);

    const list2 = await listAwardTypesForPrincipal(admin());
    expect(list2.find((a) => a.id === awardTypeId)?.hasActiveCriterionSet).toBe(
      true,
    );
  });

  it("getAwardTypeForPrincipal returns null for a non-existent id, not a throw", async () => {
    expect(
      await getAwardTypeForPrincipal(admin(), "does-not-exist"),
    ).toBeNull();
  });
});

describe("createCriterionSet — D-164's 'never seeded', and one open draft at a time", () => {
  it("version 1 for a brand-new award type", async () => {
    const awardTypeId = await makeAwardType("svc_set_v1");
    const { id } = await createCriterionSet(admin(), awardTypeId, {
      source: "ORG",
    });
    const row = await prisma.criterionSet.findUniqueOrThrow({ where: { id } });
    expect(row.version).toBe(1);
    expect(row.status).toBe("DRAFT");
  });

  it("refuses a second open DRAFT for the same award type", async () => {
    const awardTypeId = await makeAwardType("svc_set_second_draft");
    await createCriterionSet(admin(), awardTypeId, { source: "ORG" });
    await expect(
      createCriterionSet(admin(), awardTypeId, { source: "ORG" }),
    ).rejects.toBeInstanceOf(CriterionSetError);
  });

  it("the next version after a RETIRED one is version + 1, not 1 again", async () => {
    const awardTypeId = await makeAwardType("svc_set_v2");
    await makeCriterionSet(awardTypeId, "svc_set_v2_old", {
      version: 1,
      status: "RETIRED",
      effectiveFrom: new Date("2025-01-01T00:00:00Z"),
      effectiveTo: new Date("2026-01-01T00:00:00Z"),
    });
    const { id } = await createCriterionSet(admin(), awardTypeId, {
      source: "ORG",
    });
    expect(
      (await prisma.criterionSet.findUniqueOrThrow({ where: { id } })).version,
    ).toBe(2);
  });
});

describe("publishCriterionSet — D-081's DRAFT -> ACTIVE transition", () => {
  it("refuses an empty set (EMPTY_SET)", async () => {
    const awardTypeId = await makeAwardType("svc_publish_empty");
    const { gradeIds } = await makeFiveGradeScale("svc_publish_empty");
    const setId = await makeCriterionSet(awardTypeId, "svc_publish_empty", {
      passFloorGradeId: gradeIds.voldoende,
    });
    await expect(publishCriterionSet(admin(), setId)).rejects.toBeInstanceOf(
      CriterionSetError,
    );
  });

  it("refuses a set with no pass floor (NO_PASS_FLOOR)", async () => {
    const awardTypeId = await makeAwardType("svc_publish_nofloor");
    const setId = await makeCriterionSet(awardTypeId, "svc_publish_nofloor");
    await makeCriterion(setId, "svc_publish_nofloor", { sequence: 1 });
    await expect(publishCriterionSet(admin(), setId)).rejects.toBeInstanceOf(
      CriterionSetError,
    );
  });

  it("publishes: this version ACTIVE with effectiveFrom set, and retires the previous ACTIVE version", async () => {
    const awardTypeId = await makeAwardType("svc_publish_transition");
    const { gradeIds } = await makeFiveGradeScale("svc_publish_transition");
    const oldSetId = await makeCriterionSet(awardTypeId, "svc_publish_old", {
      version: 1,
      status: "ACTIVE",
      passFloorGradeId: gradeIds.voldoende,
      effectiveFrom: new Date("2025-01-01T00:00:00Z"),
    });
    await makeCriterion(oldSetId, "svc_publish_old", { sequence: 1 });

    const newSetId = await makeCriterionSet(awardTypeId, "svc_publish_new", {
      version: 2,
      status: "DRAFT",
      passFloorGradeId: gradeIds.voldoende,
    });
    await makeCriterion(newSetId, "svc_publish_new", { sequence: 1 });

    await publishCriterionSet(admin(), newSetId);

    const [oldRow, newRow] = await Promise.all([
      prisma.criterionSet.findUniqueOrThrow({ where: { id: oldSetId } }),
      prisma.criterionSet.findUniqueOrThrow({ where: { id: newSetId } }),
    ]);
    expect(oldRow.status).toBe("RETIRED");
    expect(oldRow.effectiveTo).not.toBeNull();
    expect(newRow.status).toBe("ACTIVE");
    expect(newRow.effectiveFrom).not.toBeNull();

    // Exactly one ACTIVE version exists for this award type afterwards.
    const activeCount = await prisma.criterionSet.count({
      where: { awardTypeId, status: "ACTIVE" },
    });
    expect(activeCount).toBe(1);
  });

  it("refuses to publish (or edit) a set that is not DRAFT", async () => {
    const awardTypeId = await makeAwardType("svc_publish_notdraft");
    const { gradeIds } = await makeFiveGradeScale("svc_publish_notdraft");
    const setId = await makeCriterionSet(awardTypeId, "svc_publish_notdraft", {
      status: "ACTIVE",
      passFloorGradeId: gradeIds.voldoende,
      effectiveFrom: new Date("2025-01-01T00:00:00Z"),
    });
    await makeCriterion(setId, "svc_publish_notdraft", { sequence: 1 });

    await expect(publishCriterionSet(admin(), setId)).rejects.toBeInstanceOf(
      CriterionSetError,
    );
    await expect(
      updateCriterionSet(admin(), setId, {
        source: "ORG",
        passFloorGradeId: gradeIds.goed,
      }),
    ).rejects.toBeInstanceOf(CriterionSetError);
  });
});

describe("createCriterion / updateCriterion — DRAFT-only, sequence uniqueness", () => {
  it("allocates the next free sequence when none is supplied", async () => {
    const awardTypeId = await makeAwardType("svc_crit_seq");
    const setId = await createCriterionSet(admin(), awardTypeId, {
      source: "ORG",
    }).then((s) => s.id);
    await createCriterion(admin(), setId, { code: "A1", name: "Eerste" });
    const { id } = await createCriterion(admin(), setId, {
      code: "A2",
      name: "Tweede",
    });
    expect(
      (await prisma.criterion.findUniqueOrThrow({ where: { id } })).sequence,
    ).toBe(2);
  });

  it("refuses a clashing sequence (SEQUENCE_TAKEN)", async () => {
    const awardTypeId = await makeAwardType("svc_crit_clash");
    const setId = await createCriterionSet(admin(), awardTypeId, {
      source: "ORG",
    }).then((s) => s.id);
    await createCriterion(admin(), setId, {
      code: "A1",
      name: "Eerste",
      sequence: 1,
    });
    await expect(
      createCriterion(admin(), setId, {
        code: "A2",
        name: "Tweede",
        sequence: 1,
      }),
    ).rejects.toBeInstanceOf(CriterionError);
  });

  it("refuses creating a criterion on a set that is not DRAFT", async () => {
    const awardTypeId = await makeAwardType("svc_crit_notdraft");
    const { gradeIds } = await makeFiveGradeScale("svc_crit_notdraft");
    const setId = await makeCriterionSet(awardTypeId, "svc_crit_notdraft", {
      status: "ACTIVE",
      passFloorGradeId: gradeIds.voldoende,
      effectiveFrom: new Date("2025-01-01T00:00:00Z"),
    });
    await expect(
      createCriterion(admin(), setId, { code: "A1", name: "Eerste" }),
    ).rejects.toBeInstanceOf(CriterionError);
  });

  it("updateCriterion corrects name/code/sequence/minimumGrade in place", async () => {
    const awardTypeId = await makeAwardType("svc_crit_update");
    const { gradeIds } = await makeFiveGradeScale("svc_crit_update");
    const setId = await createCriterionSet(admin(), awardTypeId, {
      source: "ORG",
    }).then((s) => s.id);
    const { id } = await createCriterion(admin(), setId, {
      code: "A1",
      name: "Origineel",
      sequence: 1,
    });
    await updateCriterion(admin(), id, {
      code: "A1",
      name: "Herzien",
      sequence: 1,
      minimumGradeId: gradeIds.goed,
    });
    const row = await prisma.criterion.findUniqueOrThrow({ where: { id } });
    expect(row.name).toBe("Herzien");
    expect(row.minimumGradeId).toBe(gradeIds.goed);
  });

  it("an absent criterion id is neither a denial nor an error", async () => {
    await expect(
      updateCriterion(admin(), "does-not-exist", {
        code: "A1",
        name: "X",
        sequence: 1,
      }),
    ).resolves.toBeUndefined();
  });

  it("createCriterion stores the standard ('normering') when given, null when not", async () => {
    const awardTypeId = await makeAwardType("svc_crit_standard_create");
    const setId = await createCriterionSet(admin(), awardTypeId, {
      source: "ORG",
    }).then((s) => s.id);

    const withStandard = await createCriterion(admin(), setId, {
      code: "A1",
      name: "Eerste",
      standard: "Zwemt 25 meter borstcrawl zonder hulpmiddelen te gebruiken.",
    });
    const rowWithStandard = await prisma.criterion.findUniqueOrThrow({
      where: { id: withStandard.id },
    });
    expect(rowWithStandard.standard).toBe(
      "Zwemt 25 meter borstcrawl zonder hulpmiddelen te gebruiken.",
    );

    const withoutStandard = await createCriterion(admin(), setId, {
      code: "A2",
      name: "Tweede",
    });
    const rowWithoutStandard = await prisma.criterion.findUniqueOrThrow({
      where: { id: withoutStandard.id },
    });
    expect(rowWithoutStandard.standard).toBeNull();
  });

  it("updateCriterion corrects the standard in place, and leaves it unchanged when the field is omitted", async () => {
    const awardTypeId = await makeAwardType("svc_crit_standard_update");
    const setId = await createCriterionSet(admin(), awardTypeId, {
      source: "ORG",
    }).then((s) => s.id);
    const { id } = await createCriterion(admin(), setId, {
      code: "A1",
      name: "Origineel",
      standard: "Oude normering.",
    });

    await updateCriterion(admin(), id, {
      code: "A1",
      name: "Origineel",
      sequence: 1,
      standard: "Nieuwe normering: volledige ademhalingstechniek.",
    });
    expect(
      (await prisma.criterion.findUniqueOrThrow({ where: { id } })).standard,
    ).toBe("Nieuwe normering: volledige ademhalingstechniek.");

    // `standard` omitted entirely (not even an empty string) leaves the
    // stored value alone — the same "undefined means unchanged" reading
    // `minimumGradeId` already gets in this function.
    await updateCriterion(admin(), id, {
      code: "A1",
      name: "Andere naam",
      sequence: 1,
    });
    expect(
      (await prisma.criterion.findUniqueOrThrow({ where: { id } })).standard,
    ).toBe("Nieuwe normering: volledige ademhalingstechniek.");

    // An explicit empty string clears it back to null (`optionalText`).
    await updateCriterion(admin(), id, {
      code: "A1",
      name: "Andere naam",
      sequence: 1,
      standard: "",
    });
    expect(
      (await prisma.criterion.findUniqueOrThrow({ where: { id } })).standard,
    ).toBeNull();
  });
});

describe("recordSkillProgress — append-only, and the two permissions", () => {
  async function scaffold(suffix: string) {
    const awardTypeId = await makeAwardType(suffix);
    const { gradeIds } = await makeFiveGradeScale(suffix);
    const setId = await makeCriterionSet(awardTypeId, suffix, {
      status: "ACTIVE",
      passFloorGradeId: gradeIds.voldoende,
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    });
    const criterionId = await makeCriterion(setId, suffix, { sequence: 1 });
    const courseId = await makeCourse(`${suffix}_course`);
    const levelId = await makeCourseLevel(courseId, `${suffix}_level`, {
      awardTypeId,
    });
    const groupId = await makeGroupAtLevel(`${suffix}_group`, levelId);
    const { studentProfileId } = await makeStudent(`${suffix}_student`);
    await placeInGroup(groupId, studentProfileId);
    return { criterionId, groupId, studentProfileId };
  }

  it("REVOKED never mutates the earlier row — it is a new one", async () => {
    const { criterionId, groupId, studentProfileId } = await scaffold(
      "svc_progress_revoke",
    );

    const first = await recordSkillProgress(admin(), groupId, {
      studentProfileId,
      criterionId,
      state: "ACHIEVED",
    });
    const second = await recordSkillProgress(admin(), groupId, {
      studentProfileId,
      criterionId,
      state: "REVOKED",
      note: "opnieuw beoordeeld",
    });

    expect(second.id).not.toBe(first.id);
    const rows = await prisma.skillProgress.findMany({
      where: { id: { in: [first.id, second.id] } },
    });
    expect(rows.find((r) => r.id === first.id)?.state).toBe("ACHIEVED");
    expect(rows.find((r) => r.id === second.id)?.state).toBe("REVOKED");
    expect(rows).toHaveLength(2);
  });

  it("refuses a criterion whose set is not ACTIVE (CRITERION_NOT_ACTIVE)", async () => {
    const awardTypeId = await makeAwardType("svc_pna");
    const setId = await makeCriterionSet(awardTypeId, "svc_pna", {
      status: "DRAFT",
    });
    const criterionId = await makeCriterion(setId, "svc_pna", {
      sequence: 1,
    });
    const courseId = await makeCourse("svc_pna_course");
    const levelId = await makeCourseLevel(courseId, "svc_pna_level", {
      awardTypeId,
    });
    const groupId = await makeGroupAtLevel("svc_pna_group", levelId);
    const { studentProfileId } = await makeStudent("svc_pna_student");
    await placeInGroup(groupId, studentProfileId);

    await expect(
      recordSkillProgress(admin(), groupId, {
        studentProfileId,
        criterionId,
        state: "INTRODUCED",
      }),
    ).rejects.toBeInstanceOf(SkillProgressError);
  });

  it("getSkillProgressForStudent returns rows most-recent-first, with criterion/award-type names joined", async () => {
    const { criterionId, groupId, studentProfileId } =
      await scaffold("svc_progress_read");
    await recordSkillProgress(admin(), groupId, {
      studentProfileId,
      criterionId,
      state: "INTRODUCED",
      assessedAt: "2026-01-01",
    });
    await recordSkillProgress(admin(), groupId, {
      studentProfileId,
      criterionId,
      state: "ACHIEVED",
      assessedAt: "2026-03-01",
    });

    const entries = await getSkillProgressForStudent(admin(), studentProfileId);
    expect(entries.map((e) => e.state)).toEqual(["ACHIEVED", "INTRODUCED"]);
    expect(entries[0]!.criterionName).toContain("Eis");
    expect(entries[0]!.awardTypeName).toContain("Diploma");
  });
});

describe("listGradeScalesForPrincipal", () => {
  it("returns the seeded scale's values in rank order", async () => {
    const { scaleId } = await makeFiveGradeScale("svc_scale_order");
    const scales = await listGradeScalesForPrincipal(admin());
    const scale = scales.find((s) => s.id === scaleId);
    expect(scale?.values.map((v) => v.rank)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("getCriterionSetForPrincipal", () => {
  it("returns criteria in sequence order, joined with the award type's name", async () => {
    const awardTypeId = await makeAwardType("svc_getset");
    const setId = await makeCriterionSet(awardTypeId, "svc_getset");
    await makeCriterion(setId, "svc_getset_b", { sequence: 2 });
    await makeCriterion(setId, "svc_getset_a", { sequence: 1 });

    const detail = await getCriterionSetForPrincipal(admin(), setId);
    expect(detail!.awardTypeName).toContain("Diploma");
    expect(detail!.criteria.map((c) => c.sequence)).toEqual([1, 2]);
  });
});
