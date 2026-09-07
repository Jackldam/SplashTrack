/**
 * The constraints the Prisma DSL cannot express, each named and each proved —
 * on the `courses-constraints.test.ts` pattern.
 *
 * They live in
 * `prisma/migrations/20260907140000_skills_module/migration.sql` as
 * hand-written SQL, invisible in `schema.prisma`, and that migration's own
 * comment names this file as the one that has to hold them.
 *
 * EVERY ASSERTION WRITES THROUGH RAW PRISMA, bypassing the services — the
 * services refuse these cases too (`skills-domain.test.ts`,
 * `skills-services.test.ts`), but a CHECK constraint's job is to hold for the
 * path nobody has written yet.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/database";

import {
  makeAwardType,
  makeCriterion,
  makeCriterionSet,
  makeFiveGradeScale,
  resetSkillsFixtures,
} from "../support/skills-fixtures";

let awardTypeId: string;
let gradeIds: Record<string, string>;

beforeEach(async () => {
  await resetSkillsFixtures();
  awardTypeId = await makeAwardType("c_award");
  ({ gradeIds } = await makeFiveGradeScale("c_award"));
});

afterAll(async () => {
  await resetSkillsFixtures();
});

describe("CriterionSet", () => {
  it("CriterionSet_one_active_per_award_type_key — refuses a second ACTIVE version", async () => {
    await makeCriterionSet(awardTypeId, "c_active_a", {
      version: 1,
      status: "ACTIVE",
      passFloorGradeId: gradeIds.voldoende,
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    });

    await expect(
      makeCriterionSet(awardTypeId, "c_active_b", {
        version: 2,
        status: "ACTIVE",
        passFloorGradeId: gradeIds.voldoende,
        effectiveFrom: new Date("2026-02-01T00:00:00Z"),
      }),
    ).rejects.toThrow(/CriterionSet_one_active_per_award_type_key/);
  });

  it("permits an ACTIVE version for a DIFFERENT award type at the same time", async () => {
    await makeCriterionSet(awardTypeId, "c_active_other_a", {
      version: 1,
      status: "ACTIVE",
      passFloorGradeId: gradeIds.voldoende,
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    });
    const otherAwardTypeId = await makeAwardType("c_award_other");
    await expect(
      makeCriterionSet(otherAwardTypeId, "c_active_other_b", {
        version: 1,
        status: "ACTIVE",
        passFloorGradeId: gradeIds.voldoende,
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      }),
    ).resolves.toBeTruthy();
  });

  it("permits two RETIRED and any number of DRAFT versions — the constraint is ACTIVE-only", async () => {
    await makeCriterionSet(awardTypeId, "c_retired_a", {
      version: 1,
      status: "RETIRED",
      passFloorGradeId: gradeIds.voldoende,
      effectiveFrom: new Date("2025-01-01T00:00:00Z"),
      effectiveTo: new Date("2025-06-01T00:00:00Z"),
    });
    await makeCriterionSet(awardTypeId, "c_retired_b", {
      version: 2,
      status: "RETIRED",
      passFloorGradeId: gradeIds.voldoende,
      effectiveFrom: new Date("2025-06-01T00:00:00Z"),
      effectiveTo: new Date("2026-01-01T00:00:00Z"),
    });
    await expect(
      makeCriterionSet(awardTypeId, "c_draft_a", {
        version: 3,
        status: "DRAFT",
      }),
    ).resolves.toBeTruthy();
    await expect(
      makeCriterionSet(awardTypeId, "c_draft_b", {
        version: 4,
        status: "DRAFT",
      }),
    ).resolves.toBeTruthy();
  });

  it("CriterionSet_effective_from_with_status_check — a DRAFT never carries effectiveFrom, a published one always does", async () => {
    await expect(
      prisma.criterionSet.create({
        data: {
          awardTypeId,
          version: 1,
          source: "ORG",
          status: "DRAFT",
          effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        },
      }),
    ).rejects.toThrow(/CriterionSet_effective_from_with_status_check/);

    await expect(
      prisma.criterionSet.create({
        data: {
          awardTypeId,
          version: 1,
          source: "ORG",
          status: "ACTIVE",
          effectiveFrom: null,
        },
      }),
    ).rejects.toThrow(/CriterionSet_effective_from_with_status_check/);
  });
});

describe("Criterion", () => {
  it("Criterion_sequence_positive_check — refuses zero and negative positions", async () => {
    const setId = await makeCriterionSet(awardTypeId, "c_crit_seq");
    await expect(
      prisma.criterion.create({
        data: {
          criterionSetId: setId,
          code: "A0",
          name: "Nul",
          sequence: 0,
        },
      }),
    ).rejects.toThrow(/Criterion_sequence_positive_check/);

    await expect(
      prisma.criterion.create({
        data: {
          criterionSetId: setId,
          code: "AN",
          name: "Negatief",
          sequence: -1,
        },
      }),
    ).rejects.toThrow(/Criterion_sequence_positive_check/);
  });

  it("Criterion_criterionSetId_code_key — refuses a duplicate code within one set", async () => {
    const setId = await makeCriterionSet(awardTypeId, "c_crit_code");
    await makeCriterion(setId, "c_crit_code_a", { sequence: 1 });
    await expect(
      prisma.criterion.create({
        data: {
          criterionSetId: setId,
          code: "C_CRIT_CODE_A",
          name: "Dubbele code",
          sequence: 2,
        },
      }),
    ).rejects.toThrow(/Criterion_criterionSetId_code_key/);
  });
});

describe("GradeValue", () => {
  it("GradeValue_rank_positive_check — refuses zero and negative ranks", async () => {
    const { scaleId } = await makeFiveGradeScale("c_grade_rank");
    await expect(
      prisma.gradeValue.create({
        data: { scaleId, code: "NUL", rank: 0, label: "Nul" },
      }),
    ).rejects.toThrow(/GradeValue_rank_positive_check/);
  });

  it("GradeValue_scaleId_rank_key — refuses two values at the same rank on one scale", async () => {
    const { scaleId } = await makeFiveGradeScale("c_grade_dup");
    await expect(
      prisma.gradeValue.create({
        data: { scaleId, code: "EXTRA", rank: 3, label: "Extra" },
      }),
    ).rejects.toThrow(/GradeValue_scaleId_rank_key/);
  });
});
