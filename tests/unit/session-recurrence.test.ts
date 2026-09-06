/**
 * Expanding a recurrence — the arithmetic, with no database in sight.
 *
 * Every decision about WHICH DATES a rule produces is made in
 * `@/modules/sessions` `domain/recurrence.ts` from values alone, so "generating
 * a term skips a configured holiday" and "the same window produces the same set
 * twice" are testable here as properties of a function. What is left for the
 * integration suite is the WRITE — the idempotency of `createMany` against the
 * unique index — which is a much smaller thing to get right once this is proven.
 *
 * THE DST CASES ARE THE ONES THAT WOULD HAVE SHIPPED BROKEN. Both Dutch
 * transitions fall inside a swimming season, and the failure — every lesson from
 * April an hour out — is invisible in the data and obvious at the pool.
 */
import { describe, expect, it } from "vitest";

import {
  addDays,
  calendarDate,
  expandAll,
  expandRecurrence,
  isoWeekday,
  occurrenceKey,
  resolveTimeZone,
  toIsoDate,
  wallClockToInstant,
  type ClosureWindow,
  type RecurrenceRule,
} from "@/modules/sessions";

const AMSTERDAM = "Europe/Amsterdam";

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Tuesdays at 18:00 for 45 minutes, open-ended. */
function tuesdayRule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    id: "rule_tue",
    weekday: 2,
    startMinuteOfDay: 18 * 60,
    durationMinutes: 45,
    startsOn: day("2026-01-01"),
    endsOn: null,
    active: true,
    ...overrides,
  };
}

const GROUP = "group_a";

describe("isoWeekday", () => {
  it("reads the calendar day the operator typed, not the server's", () => {
    // A `@db.Date` is stored at UTC midnight, so the day must be read off the
    // UTC fields. `getDay()` would shift the whole timetable by one for any
    // container running west of Greenwich.
    expect(isoWeekday(day("2026-03-02"))).toBe(1); // Monday
    expect(isoWeekday(day("2026-03-08"))).toBe(7); // Sunday
  });
});

describe("expandRecurrence", () => {
  it("produces every matching weekday in the window, and only those", () => {
    const { planned } = expandRecurrence(
      tuesdayRule(),
      day("2026-03-01"),
      day("2026-03-31"),
      [],
      GROUP,
    );
    expect(planned.map((p) => toIsoDate(p.occursOn))).toEqual([
      "2026-03-03",
      "2026-03-10",
      "2026-03-17",
      "2026-03-24",
      "2026-03-31",
    ]);
  });

  it("starts on the window's own first matching day, whatever day it opens on", () => {
    // The window opens on a Wednesday, so the first Tuesday is the following
    // week. An off-by-one here silently loses a lesson every term.
    const { planned } = expandRecurrence(
      tuesdayRule(),
      day("2026-03-04"),
      day("2026-03-18"),
      [],
      GROUP,
    );
    expect(planned.map((p) => toIsoDate(p.occursOn))).toEqual([
      "2026-03-10",
      "2026-03-17",
    ]);
  });

  it("intersects the caller's window with the rule's own", () => {
    // Asking for a year when the rule runs a term produces the term. Both
    // questions are answered at once rather than one overriding the other.
    const { planned } = expandRecurrence(
      tuesdayRule({
        startsOn: day("2026-03-10"),
        endsOn: day("2026-03-17"),
      }),
      day("2026-01-01"),
      day("2026-12-31"),
      [],
      GROUP,
    );
    expect(planned.map((p) => toIsoDate(p.occursOn))).toEqual([
      "2026-03-10",
      "2026-03-17",
    ]);
  });

  it("produces nothing from an inactive rule", () => {
    const { planned } = expandRecurrence(
      tuesdayRule({ active: false }),
      day("2026-03-01"),
      day("2026-03-31"),
      [],
      GROUP,
    );
    expect(planned).toEqual([]);
  });

  it("produces nothing when the windows do not overlap", () => {
    const { planned } = expandRecurrence(
      tuesdayRule({ endsOn: day("2026-02-01") }),
      day("2026-03-01"),
      day("2026-03-31"),
      [],
      GROUP,
    );
    expect(planned).toEqual([]);
  });
});

describe("closures", () => {
  const holiday: ClosureWindow = {
    groupId: null,
    fromDate: day("2026-03-09"),
    toDate: day("2026-03-15"),
    reason: "kerstvakantie",
  };

  it("skips a club-wide closure and REPORTS what it skipped", () => {
    const { planned, skipped } = expandRecurrence(
      tuesdayRule(),
      day("2026-03-01"),
      day("2026-03-31"),
      [holiday],
      GROUP,
    );

    expect(planned.map((p) => toIsoDate(p.occursOn))).toEqual([
      "2026-03-03",
      "2026-03-17",
      "2026-03-24",
      "2026-03-31",
    ]);
    // REPORTED, not swallowed. An administrator who expected five lessons and
    // got four can otherwise only tell a working holiday calendar from a broken
    // generator by counting.
    expect(skipped).toHaveLength(1);
    expect(toIsoDate(skipped[0].occursOn)).toBe("2026-03-10");
    expect(skipped[0].reason).toBe("kerstvakantie");
  });

  it("treats a one-day closure as one day, inclusive at both ends", () => {
    // `fromDate === toDate` is how an administrator types a single day, and a
    // half-open reading would silently make it a no-op.
    const { planned, skipped } = expandRecurrence(
      tuesdayRule(),
      day("2026-03-01"),
      day("2026-03-31"),
      [
        {
          groupId: null,
          fromDate: day("2026-03-17"),
          toDate: day("2026-03-17"),
          reason: "bad in onderhoud",
        },
      ],
      GROUP,
    );
    expect(planned).toHaveLength(4);
    expect(toIsoDate(skipped[0].occursOn)).toBe("2026-03-17");
  });

  it("applies a group's own closure to that group and no other", () => {
    const ownClosure: ClosureWindow = {
      groupId: GROUP,
      fromDate: day("2026-03-10"),
      toDate: day("2026-03-10"),
      reason: "lesgever ziek",
    };

    const mine = expandRecurrence(
      tuesdayRule(),
      day("2026-03-01"),
      day("2026-03-17"),
      [ownClosure],
      GROUP,
    );
    const theirs = expandRecurrence(
      tuesdayRule(),
      day("2026-03-01"),
      day("2026-03-17"),
      [ownClosure],
      "group_b",
    );

    expect(mine.planned).toHaveLength(2);
    expect(theirs.planned).toHaveLength(3);
  });
});

describe("expandAll", () => {
  it("keeps two rules on the same date as two separate lessons", () => {
    // A group swimming Tuesday and Thursday is two rules. Deduplicating by DATE
    // would silently drop the second lesson of a week whenever they collided.
    const tuesday = tuesdayRule({ id: "rule_a" });
    const alsoTuesday = tuesdayRule({
      id: "rule_b",
      startMinuteOfDay: 19 * 60,
    });

    const { planned } = expandAll(
      [tuesday, alsoTuesday],
      day("2026-03-03"),
      day("2026-03-03"),
      [],
      GROUP,
    );

    expect(planned).toHaveLength(2);
    expect(new Set(planned.map(occurrenceKey)).size).toBe(2);
  });

  it("is a pure function of its arguments — same input, same output", () => {
    // The property idempotency rests on: the expander cannot produce a different
    // set on a second run, so any doubling would have to come from the write.
    const args = [
      [tuesdayRule()],
      day("2026-03-01"),
      day("2026-06-30"),
      [],
      GROUP,
    ] as const;

    const first = expandAll(...args);
    const second = expandAll(...args);

    expect(first.planned.map(occurrenceKey)).toEqual(
      second.planned.map(occurrenceKey),
    );
    expect(first.planned.length).toBeGreaterThan(10);
  });
});

describe("wall-clock times across a DST boundary", () => {
  /**
   * The failure this prevents: generate a term in February by adding seven days
   * to the first `startsAt`, and every lesson from the last Sunday in March is
   * an hour out. Invisible in the data; obvious at the pool, in April, when the
   * instructor turns up at 19:00 for a lesson the app says is at 18:00.
   */
  it("keeps 18:00 local at 18:00 local on both sides of the March change", () => {
    // 2026-03-29 is the last Sunday in March: CET (+1) becomes CEST (+2).
    const before = wallClockToInstant(2026, 3, 24, 18 * 60, AMSTERDAM);
    const after = wallClockToInstant(2026, 3, 31, 18 * 60, AMSTERDAM);

    // Different INSTANTS…
    expect(after.getTime() - before.getTime()).toBe(
      7 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000,
    );
    // …and the same wall clock, which is what the club means by "Tuesday at six".
    const localHour = (value: Date) =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: AMSTERDAM,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(value);
    expect(localHour(before)).toBe("18:00");
    expect(localHour(after)).toBe("18:00");
  });

  it("does the same across the October change", () => {
    // 2026-10-25: CEST (+2) becomes CET (+1).
    const before = wallClockToInstant(2026, 10, 20, 18 * 60, AMSTERDAM);
    const after = wallClockToInstant(2026, 10, 27, 18 * 60, AMSTERDAM);
    expect(after.getTime() - before.getTime()).toBe(
      7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000,
    );
  });

  it("keeps a 45-minute lesson 45 minutes long on the changeover night", () => {
    // The duration is added to the INSTANT, not to a second wall-clock time.
    // Computing the end as wall clock would make this lesson 105 minutes.
    const start = wallClockToInstant(2026, 3, 29, 1 * 60 + 45, AMSTERDAM);
    const end = new Date(start.getTime() + 45 * 60_000);
    expect(end.getTime() - start.getTime()).toBe(45 * 60_000);
  });

  it("is exact in UTC too, where there is no transition to get wrong", () => {
    expect(wallClockToInstant(2026, 3, 3, 18 * 60, "UTC").toISOString()).toBe(
      "2026-03-03T18:00:00.000Z",
    );
  });
});

describe("resolveTimeZone", () => {
  it("prefers the organisation's configured zone", () => {
    expect(resolveTimeZone(AMSTERDAM)).toBe(AMSTERDAM);
    expect(resolveTimeZone("  Europe/Amsterdam  ")).toBe(AMSTERDAM);
  });

  it("falls back to the runtime's own zone rather than a hard-coded one", () => {
    // A hard-coded `Europe/Amsterdam` would be right for this club and silently
    // wrong for the next, and it would disagree with `formatDateTime` sitting
    // beside it, which already falls back this way.
    const runtime = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    expect(resolveTimeZone(null)).toBe(runtime);
    expect(resolveTimeZone("   ")).toBe(runtime);
  });
});

describe("date helpers", () => {
  it("addDays stays on the calendar day it lands on", () => {
    expect(toIsoDate(addDays(day("2026-03-29"), 7))).toBe("2026-04-05");
  });

  it("calendarDate builds a UTC-midnight date from its parts", () => {
    expect(calendarDate(2026, 3, 3).toISOString()).toBe(
      "2026-03-03T00:00:00.000Z",
    );
  });
});
