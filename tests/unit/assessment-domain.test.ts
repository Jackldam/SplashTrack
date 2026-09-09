import { describe, expect, it } from "vitest";

import {
  effectiveAssessmentsByCriterionSet,
  type AssessmentEntry,
} from "@/modules/assessment/domain/assessment";
import {
  computeOutcome,
  doublyDisposedCriterionIds,
  unsettledCriterionIds,
} from "@/modules/assessment/domain/pass-rule";

const RANKS = new Map([
  ["onvoldoende", 1],
  ["matig", 2],
  ["voldoende", 3],
  ["goed", 4],
  ["zeergoed", 5],
]);

describe("D-080's pass rule (computeOutcome)", () => {
  const criteria = [
    { criterionId: "c1", minimumGradeId: null },
    { criterionId: "c2", minimumGradeId: null },
  ];

  it("PASSes when every criterion meets the set's own pass floor", () => {
    const outcome = computeOutcome({
      criteria,
      results: [
        { criterionId: "c1", gradeValueId: "voldoende" },
        { criterionId: "c2", gradeValueId: "goed" },
      ],
      waivers: [],
      passFloorGradeId: "voldoende",
      rankOf: RANKS,
    });
    expect(outcome).toBe("PASS");
  });

  it("FAILs when one criterion falls short of the pass floor", () => {
    const outcome = computeOutcome({
      criteria,
      results: [
        { criterionId: "c1", gradeValueId: "voldoende" },
        { criterionId: "c2", gradeValueId: "matig" },
      ],
      waivers: [],
      passFloorGradeId: "voldoende",
      rankOf: RANKS,
    });
    expect(outcome).toBe("FAIL");
  });

  it("a per-criterion minimumGradeId OVERRIDES the set's pass floor, weaker or stronger", () => {
    const strongerCriteria = [
      { criterionId: "c1", minimumGradeId: "zeergoed" },
    ];
    expect(
      computeOutcome({
        criteria: strongerCriteria,
        results: [{ criterionId: "c1", gradeValueId: "goed" }],
        waivers: [],
        passFloorGradeId: "voldoende",
        rankOf: RANKS,
      }),
    ).toBe("FAIL");

    const weakerCriteria = [{ criterionId: "c1", minimumGradeId: "matig" }];
    expect(
      computeOutcome({
        criteria: weakerCriteria,
        results: [{ criterionId: "c1", gradeValueId: "matig" }],
        waivers: [],
        passFloorGradeId: "voldoende",
        rankOf: RANKS,
      }),
    ).toBe("PASS");
  });

  it("a waiver satisfies a criterion exactly like a passing result — D-080's `∃ r ... ∨ ∃ w`", () => {
    const outcome = computeOutcome({
      criteria,
      results: [{ criterionId: "c1", gradeValueId: "zeergoed" }],
      waivers: [{ criterionId: "c2" }],
      passFloorGradeId: "voldoende",
      rankOf: RANKS,
    });
    expect(outcome).toBe("PASS");
  });

  it("never branches on AwardType.kind — the function receives no such field at all", () => {
    // Structural pin: PassRuleCriterion/PassRuleResult carry no `kind`. A
    // future change adding one back would be visible in this test's own
    // fixtures, not silently reintroduced.
    const criterion: { criterionId: string; minimumGradeId: string | null } =
      criteria[0]!;
    expect(Object.keys(criterion).sort()).toEqual([
      "criterionId",
      "minimumGradeId",
    ]);
  });
});

describe("D-086 completeness — unsettledCriterionIds", () => {
  const criteria = [
    { criterionId: "c1", minimumGradeId: null },
    { criterionId: "c2", minimumGradeId: null },
    { criterionId: "c3", minimumGradeId: null },
  ];

  it("lists every criterion with NEITHER a result NOR a waiver", () => {
    const unsettled = unsettledCriterionIds({
      criteria,
      results: [{ criterionId: "c1", gradeValueId: "voldoende" }],
      waivers: [{ criterionId: "c2" }],
    });
    expect(unsettled).toEqual(["c3"]);
  });

  it("is empty once every criterion has a result or a waiver — never before", () => {
    expect(
      unsettledCriterionIds({
        criteria,
        results: [
          { criterionId: "c1", gradeValueId: "voldoende" },
          { criterionId: "c3", gradeValueId: "goed" },
        ],
        waivers: [{ criterionId: "c2" }],
      }),
    ).toEqual([]);
  });
});

describe("doublyDisposedCriterionIds — a criterion graded AND waived in one sitting", () => {
  it("names a criterion carrying both", () => {
    const doubly = doublyDisposedCriterionIds({
      results: [
        { criterionId: "c1", gradeValueId: "voldoende" },
        { criterionId: "c2", gradeValueId: "goed" },
      ],
      waivers: [{ criterionId: "c2" }],
    });
    expect(doubly).toEqual(["c2"]);
  });

  it("is empty when every criterion has exactly one disposition", () => {
    expect(
      doublyDisposedCriterionIds({
        results: [{ criterionId: "c1", gradeValueId: "voldoende" }],
        waivers: [{ criterionId: "c2" }],
      }),
    ).toEqual([]);
  });
});

describe("effectiveAssessmentsByCriterionSet — D-061/D-062 supersession, applied to Assessment", () => {
  it("a superseded sitting is out of the running no matter how recent it is", () => {
    const entries: AssessmentEntry[] = [
      {
        id: "a1",
        criterionSetId: "set1",
        outcome: "FAIL",
        assessedAt: new Date("2026-01-01T00:00:00Z"),
        supersedesAssessmentId: null,
      },
      {
        id: "a2",
        criterionSetId: "set1",
        outcome: "PASS",
        assessedAt: new Date("2026-01-02T00:00:00Z"),
        supersedesAssessmentId: "a1",
      },
    ];
    const effective = effectiveAssessmentsByCriterionSet(entries);
    expect(effective.get("set1")).toMatchObject({
      assessmentId: "a2",
      outcome: "PASS",
    });
  });

  it("among non-superseded rows, the latest by assessedAt wins", () => {
    const entries: AssessmentEntry[] = [
      {
        id: "a1",
        criterionSetId: "set1",
        outcome: "FAIL",
        assessedAt: new Date("2026-01-01T00:00:00Z"),
        supersedesAssessmentId: null,
      },
      {
        id: "a2",
        criterionSetId: "set1",
        outcome: "PASS",
        assessedAt: new Date("2026-02-01T00:00:00Z"),
        supersedesAssessmentId: null,
      },
    ];
    expect(
      effectiveAssessmentsByCriterionSet(entries).get("set1"),
    ).toMatchObject({ assessmentId: "a2" });
  });

  it("groups by criterionSetId — two award types' sittings never merge", () => {
    const entries: AssessmentEntry[] = [
      {
        id: "a1",
        criterionSetId: "setA",
        outcome: "PASS",
        assessedAt: new Date("2026-01-01T00:00:00Z"),
        supersedesAssessmentId: null,
      },
      {
        id: "a2",
        criterionSetId: "setB",
        outcome: "FAIL",
        assessedAt: new Date("2026-01-01T00:00:00Z"),
        supersedesAssessmentId: null,
      },
    ];
    const effective = effectiveAssessmentsByCriterionSet(entries);
    expect(effective.size).toBe(2);
    expect(effective.get("setA")?.outcome).toBe("PASS");
    expect(effective.get("setB")?.outcome).toBe("FAIL");
  });
});
