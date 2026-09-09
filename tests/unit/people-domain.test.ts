import { describe, expect, it } from "vitest";

import {
  currentLifecycleState,
  isCurrentlyAMember,
  lastMembershipEnd,
  lifecycleEndedAt,
  MEMBER_NUMBER_PREFIX,
  nextAllocatedNumber,
  normaliseSuppliedNumber,
  openPeriod,
  InvalidNumberError,
} from "@/modules/people";

/**
 * The derivations that exist BECAUSE there is no status column (D-059).
 *
 * Phase 0.3 deleted `Membership.status` and its enum rather than carrying them,
 * and phase 1.1 must not reintroduce the same thing as a helper. These tests are
 * what keeps that honest: every question the flag used to answer is answered
 * here from the rows, and the answers stay correct across a leave-and-return
 * that a flag would have flattened.
 */

const D = (iso: string) => new Date(iso);

describe("membership derived from intervals (D-059)", () => {
  const leftAndReturned = [
    { startedAt: D("2020-09-01"), endedAt: D("2022-07-01") },
    { startedAt: D("2025-09-01"), endedAt: null },
  ];

  it("is a member during a period and NOT a member in the gap", () => {
    expect(isCurrentlyAMember(leftAndReturned, D("2021-01-01"))).toBe(true);
    // The gap. A status flag set to "active" in 2020 and never touched would
    // have said `true` here, and a flag set to "inactive" in 2022 would have
    // destroyed the 2020-2022 answer entirely.
    expect(isCurrentlyAMember(leftAndReturned, D("2023-01-01"))).toBe(false);
    expect(isCurrentlyAMember(leftAndReturned, D("2026-01-01"))).toBe(true);
  });

  it("has at most one open period, and finds it", () => {
    expect(openPeriod(leftAndReturned)?.startedAt).toEqual(D("2025-09-01"));
    expect(
      openPeriod([{ startedAt: D("2020-01-01"), endedAt: D("2021-01-01") }]),
    ).toBeNull();
  });

  it("reports null while a period is open — the retention clock has not started", () => {
    expect(lastMembershipEnd(leftAndReturned)).toBeNull();
  });

  it("reports the LATEST ending once every period is closed, not the first", () => {
    expect(
      lastMembershipEnd([
        { startedAt: D("2020-09-01"), endedAt: D("2022-07-01") },
        { startedAt: D("2023-09-01"), endedAt: D("2026-02-01") },
      ]),
    ).toEqual(D("2026-02-01"));
  });

  it("reports undefined with no periods at all — never held, never dated", () => {
    expect(lastMembershipEnd([])).toBeUndefined();
  });
});

describe("student lifecycle derived from the append-only log (D-005, D-059)", () => {
  it("a profile with no events is ACTIVE — the record's existence is the registration", () => {
    expect(currentLifecycleState([], D("2026-05-01"))).toBe("ACTIVE");
  });

  it("a trial lesson alone is PROSPECTIVE", () => {
    expect(
      currentLifecycleState(
        [{ type: "TRIAL_ATTENDED", occurredAt: D("2026-01-10") }],
        D("2026-05-01"),
      ),
    ).toBe("PROSPECTIVE");
  });

  it("a PAUSE is not an ending, and holds the person under D-066", () => {
    const events = [
      { type: "JOINED" as const, occurredAt: D("2024-09-01") },
      { type: "PAUSED" as const, occurredAt: D("2026-02-01") },
    ];
    expect(currentLifecycleState(events, D("2026-05-01"))).toBe("PAUSED");
    // The load-bearing half: treating a broken arm as a departure would start a
    // 24-month retention clock on a child who is back in September.
    expect(lifecycleEndedAt(events, D("2026-05-01"))).toBeNull();
  });

  it("LEFT ends it, and dates the ending at the event's own moment", () => {
    const events = [
      { type: "JOINED" as const, occurredAt: D("2024-09-01") },
      { type: "LEFT" as const, occurredAt: D("2026-03-15") },
    ];
    expect(currentLifecycleState(events, D("2026-05-01"))).toBe("LEFT");
    expect(lifecycleEndedAt(events, D("2026-05-01"))).toEqual(D("2026-03-15"));
  });

  it("a RETURN after a departure is held again, and the old LEFT stays history", () => {
    const events = [
      { type: "JOINED" as const, occurredAt: D("2022-09-01") },
      { type: "LEFT" as const, occurredAt: D("2024-03-15") },
      { type: "RETURNED" as const, occurredAt: D("2026-01-08") },
    ];
    expect(currentLifecycleState(events, D("2026-05-01"))).toBe("ACTIVE");
    // NOT "the latest LEFT event": that reading would make a returning swimmer
    // permanently due for deletion, with a row somebody has to remember to
    // override.
    expect(lifecycleEndedAt(events, D("2026-05-01"))).toBeNull();
  });

  it("answers AS OF an instant, so history is replayable", () => {
    const events = [
      { type: "JOINED" as const, occurredAt: D("2022-09-01") },
      { type: "LEFT" as const, occurredAt: D("2024-03-15") },
      { type: "RETURNED" as const, occurredAt: D("2026-01-08") },
    ];
    expect(currentLifecycleState(events, D("2025-01-01"))).toBe("LEFT");
    expect(currentLifecycleState(events, D("2023-01-01"))).toBe("ACTIVE");
  });
});

describe("member and pupil numbering", () => {
  it("allocates the next number, ignoring a club's own legacy scheme", () => {
    expect(
      nextAllocatedNumber(MEMBER_NUMBER_PREFIX, [
        "M-00001",
        "M-00007",
        // A club's own imported numbers. Parsing these to guess a successor
        // produces collisions in a scheme we did not invent, so they are
        // ignored rather than interpreted.
        "1998-17",
        "ZK042",
      ]),
    ).toBe("M-00008");
  });

  it("starts at one on an empty register", () => {
    expect(nextAllocatedNumber(MEMBER_NUMBER_PREFIX, [])).toBe("M-00001");
  });

  it("keeps a supplied number exactly, leading zeros and all", () => {
    // The reason the column is a string. `0042` and `42` are one integer and
    // two member numbers, and a club that has used the first for thirty years
    // will not accept the second.
    expect(normaliseSuppliedNumber("memberNumber", " 0042 ")).toBe("0042");
    expect(normaliseSuppliedNumber("memberNumber", "1998/17")).toBe("1998/17");
  });

  it("refuses a number that is not one", () => {
    expect(() => normaliseSuppliedNumber("memberNumber", "")).toThrow(
      InvalidNumberError,
    );
    expect(() =>
      normaliseSuppliedNumber("memberNumber", "<script>alert(1)</script>"),
    ).toThrow(InvalidNumberError);
  });
});
