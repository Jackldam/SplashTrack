import { describe, expect, it } from "vitest";

import {
  assertSequenceIsFree,
  CriterionError,
  inSequence,
  nextSequence,
} from "@/modules/skills/domain/criterion";
import {
  assertCanPublish,
  CriterionSetError,
  nextVersion,
} from "@/modules/skills/domain/criterion-set";
import {
  effectiveStateByCriterion,
  permissionFor,
} from "@/modules/skills/domain/skill-progress";

describe("criterion sequencing", () => {
  it("nextSequence is 1 for an empty set", () => {
    expect(nextSequence([])).toBe(1);
  });

  it("nextSequence is MAX + 1, never COUNT + 1", () => {
    expect(nextSequence([{ sequence: 1 }, { sequence: 5 }])).toBe(6);
  });

  it("inSequence orders by sequence", () => {
    const ordered = inSequence([
      { id: "b", sequence: 2 },
      { id: "a", sequence: 1 },
    ]);
    expect(ordered.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("assertSequenceIsFree refuses a clash", () => {
    const criteria = [{ id: "a", sequence: 1 }];
    expect(() => assertSequenceIsFree(criteria, 1, null)).toThrowError(
      CriterionError,
    );
  });

  it("assertSequenceIsFree allows a criterion to keep its own position", () => {
    const criteria = [{ id: "a", sequence: 1 }];
    expect(() => assertSequenceIsFree(criteria, 1, "a")).not.toThrow();
  });

  it("assertSequenceIsFree allows a free position", () => {
    const criteria = [{ id: "a", sequence: 1 }];
    expect(() => assertSequenceIsFree(criteria, 2, null)).not.toThrow();
  });
});

describe("criterion set versioning", () => {
  it("nextVersion is 1 for a brand-new award type", () => {
    expect(nextVersion([])).toBe(1);
  });

  it("nextVersion is MAX + 1", () => {
    expect(nextVersion([{ version: 1 }, { version: 2 }])).toBe(3);
  });

  it("assertCanPublish refuses a set that is not DRAFT", () => {
    expect(() =>
      assertCanPublish({
        status: "ACTIVE",
        passFloorGradeId: "g1",
        criterionCount: 1,
      }),
    ).toThrowError(CriterionSetError);
  });

  it("assertCanPublish refuses a set with no pass floor", () => {
    expect(() =>
      assertCanPublish({
        status: "DRAFT",
        passFloorGradeId: null,
        criterionCount: 1,
      }),
    ).toThrowError(CriterionSetError);
  });

  it("assertCanPublish refuses an empty set", () => {
    expect(() =>
      assertCanPublish({
        status: "DRAFT",
        passFloorGradeId: "g1",
        criterionCount: 0,
      }),
    ).toThrowError(CriterionSetError);
  });

  it("assertCanPublish accepts a DRAFT with a floor and at least one criterion", () => {
    expect(() =>
      assertCanPublish({
        status: "DRAFT",
        passFloorGradeId: "g1",
        criterionCount: 1,
      }),
    ).not.toThrow();
  });
});

describe("skill progress — append-only derivation", () => {
  it("permissionFor routes REVOKED to skills.revoke and everything else to skills.assess", () => {
    expect(permissionFor("REVOKED")).toBe("skills.revoke");
    expect(permissionFor("INTRODUCED")).toBe("skills.assess");
    expect(permissionFor("PRACTISING")).toBe("skills.assess");
    expect(permissionFor("ACHIEVED")).toBe("skills.assess");
  });

  it("effectiveStateByCriterion takes the LATEST row per criterion", () => {
    const effective = effectiveStateByCriterion([
      {
        criterionId: "c1",
        assessedAt: new Date("2026-01-01T00:00:00Z"),
        state: "INTRODUCED",
      },
      {
        criterionId: "c1",
        assessedAt: new Date("2026-02-01T00:00:00Z"),
        state: "ACHIEVED",
      },
      {
        criterionId: "c2",
        assessedAt: new Date("2026-01-15T00:00:00Z"),
        state: "PRACTISING",
      },
    ]);
    expect(effective.get("c1")).toBe("ACHIEVED");
    expect(effective.get("c2")).toBe("PRACTISING");
  });

  it("a REVOKED row is a state like any other — it overrides an earlier ACHIEVED", () => {
    const effective = effectiveStateByCriterion([
      {
        criterionId: "c1",
        assessedAt: new Date("2026-01-01T00:00:00Z"),
        state: "ACHIEVED",
      },
      {
        criterionId: "c1",
        assessedAt: new Date("2026-03-01T00:00:00Z"),
        state: "REVOKED",
      },
    ]);
    expect(effective.get("c1")).toBe("REVOKED");
  });
});
