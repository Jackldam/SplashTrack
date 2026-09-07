/**
 * Pure-function tests for the `courses` domain layer — `course-level.ts`'s
 * sequence invariants and `enrolment.ts`'s interval rules. No I/O, on the
 * `groups-move-symmetry.test.ts` pattern of testing the module's own shape and
 * rules directly rather than only through a database round-trip.
 */
import { describe, expect, it } from "vitest";

import {
  assertSequenceIsFree,
  CourseLevelError,
  inSequence,
  nextSequence,
} from "@/modules/courses/domain/course-level";
import {
  assertCanEndEnrolment,
  assertCanEnrol,
  EnrolmentError,
  isEnrolledAt,
  lastEnrolmentEnd,
  openEnrolment,
} from "@/modules/courses/domain/enrolment";

describe("nextSequence", () => {
  it("is 1 for a course with no levels yet", () => {
    expect(nextSequence([])).toBe(1);
  });

  it("is MAX + 1, not COUNT + 1", () => {
    // A level removed from the middle must not free its position for reuse —
    // MAX + 1 never collides with an existing row, COUNT + 1 would.
    expect(nextSequence([{ sequence: 1 }, { sequence: 5 }])).toBe(6);
  });

  it("is stable under an out-of-order input", () => {
    expect(
      nextSequence([{ sequence: 3 }, { sequence: 1 }, { sequence: 2 }]),
    ).toBe(4);
  });
});

describe("inSequence", () => {
  it("orders by sequence, ascending", () => {
    const levels = [
      { id: "c", sequence: 3 },
      { id: "a", sequence: 1 },
      { id: "b", sequence: 2 },
    ];
    expect(inSequence(levels).map((level) => level.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("does not mutate its input", () => {
    const levels = [
      { id: "b", sequence: 2 },
      { id: "a", sequence: 1 },
    ];
    const copy = [...levels];
    inSequence(levels);
    expect(levels).toEqual(copy);
  });
});

describe("assertSequenceIsFree", () => {
  const siblings = [
    { id: "lvl_a", sequence: 1 },
    { id: "lvl_b", sequence: 2 },
  ];

  it("refuses a position another level already holds", () => {
    expect(() => assertSequenceIsFree(siblings, 2, null)).toThrow(
      CourseLevelError,
    );
    try {
      assertSequenceIsFree(siblings, 2, null);
    } catch (error) {
      expect((error as CourseLevelError).reason).toBe("SEQUENCE_TAKEN");
    }
  });

  it("permits a free position", () => {
    expect(() => assertSequenceIsFree(siblings, 3, null)).not.toThrow();
  });

  it("excludes the level being corrected from the clash check", () => {
    // Renaming/repositioning `lvl_a` and leaving it at 1 is not a clash with
    // itself.
    expect(() => assertSequenceIsFree(siblings, 1, "lvl_a")).not.toThrow();
    // But moving `lvl_a` onto `lvl_b`'s position is still refused.
    expect(() => assertSequenceIsFree(siblings, 2, "lvl_a")).toThrow(
      CourseLevelError,
    );
  });
});

describe("isEnrolledAt — half-open [startedAt, endedAt)", () => {
  const started = new Date("2026-01-06T00:00:00Z");
  const ended = new Date("2026-03-03T00:00:00Z");

  it("is running from the start instant, inclusive", () => {
    expect(isEnrolledAt({ startedAt: started, endedAt: null }, started)).toBe(
      true,
    );
  });

  it("is running with no end at all", () => {
    expect(
      isEnrolledAt(
        { startedAt: started, endedAt: null },
        new Date("2099-01-01T00:00:00Z"),
      ),
    ).toBe(true);
  });

  it("is NOT running at the end instant — end exclusive", () => {
    // A pupil moving from one course to another must not be "in both" for
    // twenty-four hours — that ambiguity is an ACCESS decision here
    // (`isEnrolledInCourse`), not just a display nicety.
    expect(isEnrolledAt({ startedAt: started, endedAt: ended }, ended)).toBe(
      false,
    );
  });

  it("is running the instant before the end", () => {
    expect(
      isEnrolledAt(
        { startedAt: started, endedAt: ended },
        new Date(ended.getTime() - 1),
      ),
    ).toBe(true);
  });

  it("is not running before it started", () => {
    expect(
      isEnrolledAt(
        { startedAt: started, endedAt: null },
        new Date(started.getTime() - 1),
      ),
    ).toBe(false);
  });
});

describe("openEnrolment", () => {
  it("finds the one row with a null endedAt", () => {
    const rows = [
      { startedAt: new Date("2026-01-01"), endedAt: new Date("2026-02-01") },
      { startedAt: new Date("2026-02-01"), endedAt: null },
    ];
    expect(openEnrolment(rows)).toBe(rows[1]);
  });

  it("is null when every row is closed", () => {
    const rows = [
      { startedAt: new Date("2026-01-01"), endedAt: new Date("2026-02-01") },
    ];
    expect(openEnrolment(rows)).toBeNull();
  });

  it("is null for an empty history", () => {
    expect(openEnrolment([])).toBeNull();
  });
});

describe("lastEnrolmentEnd — the three-valued retention answer", () => {
  it("is undefined when this course never held the pupil", () => {
    // Distinct from `null`: this source has never held them at all, and must
    // not contribute an ending date of its own to `resolveLastRelationshipEnd`.
    expect(lastEnrolmentEnd([])).toBeUndefined();
  });

  it("is null while one enrolment is still open — the clock has not started", () => {
    expect(
      lastEnrolmentEnd([{ startedAt: new Date("2026-01-01"), endedAt: null }]),
    ).toBeNull();
  });

  it("is the LATEST ending across every closed row", () => {
    expect(
      lastEnrolmentEnd([
        { startedAt: new Date("2026-01-01"), endedAt: new Date("2026-02-01") },
        { startedAt: new Date("2026-03-01"), endedAt: new Date("2026-04-01") },
      ]),
    ).toEqual(new Date("2026-04-01"));
  });
});

describe("assertCanEnrol", () => {
  it("permits opening the first enrolment", () => {
    expect(() => assertCanEnrol([])).not.toThrow();
  });

  it("permits opening a new one once the last is closed", () => {
    expect(() =>
      assertCanEnrol([
        { startedAt: new Date("2026-01-01"), endedAt: new Date("2026-02-01") },
      ]),
    ).not.toThrow();
  });

  it("refuses a second open enrolment — ALREADY_ENROLLED", () => {
    expect(() =>
      assertCanEnrol([{ startedAt: new Date("2026-01-01"), endedAt: null }]),
    ).toThrow(EnrolmentError);
    try {
      assertCanEnrol([{ startedAt: new Date("2026-01-01"), endedAt: null }]);
    } catch (error) {
      expect((error as EnrolmentError).reason).toBe("ALREADY_ENROLLED");
    }
  });
});

describe("assertCanEndEnrolment", () => {
  it("returns the open enrolment it will close", () => {
    const open = { id: "e1", startedAt: new Date("2026-01-01"), endedAt: null };
    const rows = [
      {
        id: "e0",
        startedAt: new Date("2025-01-01"),
        endedAt: new Date("2025-06-01"),
      },
      open,
    ];
    expect(assertCanEndEnrolment(rows, new Date("2026-03-01"))).toBe(open);
  });

  it("refuses when there is nothing open — NOT_ENROLLED", () => {
    expect(() =>
      assertCanEndEnrolment(
        [
          {
            startedAt: new Date("2025-01-01"),
            endedAt: new Date("2025-06-01"),
          },
        ],
        new Date("2026-03-01"),
      ),
    ).toThrow(EnrolmentError);
    try {
      assertCanEndEnrolment(
        [
          {
            startedAt: new Date("2025-01-01"),
            endedAt: new Date("2025-06-01"),
          },
        ],
        new Date("2026-03-01"),
      );
    } catch (error) {
      expect((error as EnrolmentError).reason).toBe("NOT_ENROLLED");
    }
  });

  it("refuses an end at or before the start — ENDS_BEFORE_IT_STARTS", () => {
    const started = new Date("2026-01-06");
    expect(() =>
      assertCanEndEnrolment([{ startedAt: started, endedAt: null }], started),
    ).toThrow(EnrolmentError);
    try {
      assertCanEndEnrolment([{ startedAt: started, endedAt: null }], started);
    } catch (error) {
      expect((error as EnrolmentError).reason).toBe("ENDS_BEFORE_IT_STARTS");
    }
    expect(() =>
      assertCanEndEnrolment(
        [{ startedAt: started, endedAt: null }],
        new Date(started.getTime() - 1),
      ),
    ).toThrow(EnrolmentError);
  });
});

describe("the module has no third enrolment operation (D-109)", () => {
  it("exports no way to change status after the fact", async () => {
    // D-109: there is no `convertTrial`, no `updateEnrolment`. Converting a
    // *proefzwemmer* is closing one row and opening another, which is what
    // keeps the record that the trial happened. A source-level check, on the
    // `groups-move-symmetry.test.ts` reasoning: the thing protected is an
    // absence, which has no behaviour of its own to exercise.
    const barrel = await import("@/modules/courses");
    for (const forbidden of [
      "convertTrial",
      "updateEnrolment",
      "changeEnrolmentStatus",
      "deleteCourseLevel",
      "deleteCourse",
      "deleteEnrolment",
    ]) {
      expect(Object.keys(barrel)).not.toContain(forbidden);
    }
  });
});
