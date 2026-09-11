import { describe, expect, it } from "vitest";

import {
  firstUnmetClause,
  hasAnyValidQualificationAt,
  isQualificationValidAt,
  type ConfirmationChecks,
} from "@/modules/exams/domain/exam-candidate";
import { effectiveResultsByCandidate } from "@/modules/exams/domain/exam-result";

describe("firstUnmetClause — D-085's full formula, as a matrix", () => {
  const allMet: ConfirmationChecks = {
    hasQualifyingAssessment: true,
    independentOfStudentGroup: true,
    assessorHoldsValidQualification: true,
  };

  it("returns null when every clause holds", () => {
    expect(firstUnmetClause(allMet)).toBeNull();
  });

  it("refuses NO_QUALIFYING_ASSESSMENT first, before either other clause", () => {
    expect(
      firstUnmetClause({
        ...allMet,
        hasQualifyingAssessment: false,
        independentOfStudentGroup: false,
        assessorHoldsValidQualification: false,
      }),
    ).toBe("NO_QUALIFYING_ASSESSMENT");
  });

  it("refuses NOT_INDEPENDENT when the assessment qualifies but independence does not hold", () => {
    expect(
      firstUnmetClause({ ...allMet, independentOfStudentGroup: false }),
    ).toBe("NOT_INDEPENDENT");
  });

  it("treats a null independence answer (no PASS at all) as NOT_INDEPENDENT too", () => {
    // qualifyingAftestFacts returns independentOfStudentGroup: null when there
    // is no non-superseded PASS — but then hasQualifyingAssessment is also
    // false and wins first. This case is what happens if a caller ever
    // constructs the checks inconsistently; the function still denies safely.
    expect(
      firstUnmetClause({
        hasQualifyingAssessment: true,
        independentOfStudentGroup: null,
        assessorHoldsValidQualification: true,
      }),
    ).toBe("NOT_INDEPENDENT");
  });

  it("refuses ASSESSOR_NOT_QUALIFIED only when the first two clauses hold", () => {
    expect(
      firstUnmetClause({ ...allMet, assessorHoldsValidQualification: false }),
    ).toBe("ASSESSOR_NOT_QUALIFIED");
  });

  it("checks clauses in the design's own order — independence before qualification", () => {
    // Both fail; the design lists independence before qualification.
    expect(
      firstUnmetClause({
        ...allMet,
        independentOfStudentGroup: false,
        assessorHoldsValidQualification: false,
      }),
    ).toBe("NOT_INDEPENDENT");
  });
});

describe("isQualificationValidAt / hasAnyValidQualificationAt", () => {
  const from = new Date("2024-01-01T00:00:00Z");
  const to = new Date("2026-01-01T00:00:00Z");

  it("is valid from validFrom (inclusive)", () => {
    expect(
      isQualificationValidAt({ validFrom: from, validTo: null }, from),
    ).toBe(true);
  });

  it("is invalid strictly before validFrom", () => {
    const before = new Date("2023-12-31T23:59:59Z");
    expect(
      isQualificationValidAt({ validFrom: from, validTo: null }, before),
    ).toBe(false);
  });

  it("is valid up to but not including validTo", () => {
    expect(isQualificationValidAt({ validFrom: from, validTo: to }, to)).toBe(
      false,
    );
    const justBefore = new Date(to.getTime() - 1);
    expect(
      isQualificationValidAt({ validFrom: from, validTo: to }, justBefore),
    ).toBe(true);
  });

  it("null validTo means currently valid, forever", () => {
    const farFuture = new Date("2099-01-01T00:00:00Z");
    expect(
      isQualificationValidAt({ validFrom: from, validTo: null }, farFuture),
    ).toBe(true);
  });

  it("hasAnyValidQualificationAt is true if ANY row covers the instant", () => {
    const at = new Date("2025-06-01T00:00:00Z");
    expect(
      hasAnyValidQualificationAt(
        [
          {
            validFrom: new Date("2020-01-01T00:00:00Z"),
            validTo: new Date("2021-01-01T00:00:00Z"),
          },
          { validFrom: from, validTo: to },
        ],
        at,
      ),
    ).toBe(true);
  });

  it("hasAnyValidQualificationAt is false when every row misses the instant", () => {
    const at = new Date("2030-01-01T00:00:00Z");
    expect(
      hasAnyValidQualificationAt([{ validFrom: from, validTo: to }], at),
    ).toBe(false);
  });

  it("hasAnyValidQualificationAt is false over an empty list", () => {
    expect(hasAnyValidQualificationAt([], new Date())).toBe(false);
  });
});

describe("effectiveResultsByCandidate — D-062", () => {
  it("returns the only result when a candidate has exactly one", () => {
    const map = effectiveResultsByCandidate([
      {
        id: "r1",
        candidateId: "c1",
        outcome: "PASS",
        recordedAt: new Date("2026-01-01"),
        supersedesResultId: null,
      },
    ]);
    expect(map.get("c1")?.resultId).toBe("r1");
    expect(map.get("c1")?.outcome).toBe("PASS");
  });

  it("a superseded result is never the effective one, even if it is the newest row physically inserted last in the array", () => {
    const map = effectiveResultsByCandidate([
      {
        id: "r1",
        candidateId: "c1",
        outcome: "FAIL",
        recordedAt: new Date("2026-01-01"),
        supersedesResultId: null,
      },
      {
        id: "r2",
        candidateId: "c1",
        outcome: "PASS",
        recordedAt: new Date("2026-02-01"),
        supersedesResultId: "r1",
      },
    ]);
    expect(map.get("c1")?.resultId).toBe("r2");
    expect(map.get("c1")?.outcome).toBe("PASS");
  });

  it("exactly one effective result exists per candidate even with a long correction chain", () => {
    const map = effectiveResultsByCandidate([
      {
        id: "r1",
        candidateId: "c1",
        outcome: "FAIL",
        recordedAt: new Date("2026-01-01"),
        supersedesResultId: null,
      },
      {
        id: "r2",
        candidateId: "c1",
        outcome: "FAIL",
        recordedAt: new Date("2026-02-01"),
        supersedesResultId: "r1",
      },
      {
        id: "r3",
        candidateId: "c1",
        outcome: "PASS",
        recordedAt: new Date("2026-03-01"),
        supersedesResultId: "r2",
      },
    ]);
    expect(map.size).toBe(1);
    expect(map.get("c1")?.resultId).toBe("r3");
  });

  it("keeps separate candidates' results separate", () => {
    const map = effectiveResultsByCandidate([
      {
        id: "r1",
        candidateId: "c1",
        outcome: "PASS",
        recordedAt: new Date("2026-01-01"),
        supersedesResultId: null,
      },
      {
        id: "r2",
        candidateId: "c2",
        outcome: "FAIL",
        recordedAt: new Date("2026-01-01"),
        supersedesResultId: null,
      },
    ]);
    expect(map.get("c1")?.resultId).toBe("r1");
    expect(map.get("c2")?.resultId).toBe("r2");
  });
});
