/**
 * `src/modules/attendance/domain/attendance-event.ts` — pure functions, no
 * database.
 *
 * The derivation under test is D-061's own sentence: *"the effective status
 * is derived: the latest event for that student and session that nothing
 * supersedes."* Both halves matter and both are pinned here — supersession
 * beats recency (a superseded row is out of the running even when it is the
 * newest), and recency decides among the survivors.
 */
import { describe, expect, it } from "vitest";

import {
  ATTENDANCE_STATES,
  AttendanceError,
  effectiveAttendanceByStudent,
  type AttendanceEntry,
} from "@/modules/attendance";

function entry(overrides: Partial<AttendanceEntry>): AttendanceEntry {
  return {
    id: "e1",
    studentProfileId: "sp1",
    state: "PRESENT",
    recordedAt: new Date("2026-03-10T17:00:00Z"),
    supersedesEventId: null,
    ...overrides,
  };
}

describe("ATTENDANCE_STATES", () => {
  it("is exactly §3.4's vocabulary, in the register's order", () => {
    expect(ATTENDANCE_STATES).toEqual(["PRESENT", "ABSENT", "EXCUSED", "LATE"]);
  });
});

describe("effectiveAttendanceByStudent", () => {
  it("answers nothing for no events", () => {
    expect(effectiveAttendanceByStudent([]).size).toBe(0);
  });

  it("a single event is the answer", () => {
    const result = effectiveAttendanceByStudent([
      entry({ id: "a", state: "ABSENT" }),
    ]);
    expect(result.get("sp1")).toMatchObject({ eventId: "a", state: "ABSENT" });
  });

  it("a correction supersedes the original — D-061's marked-absent-then-found-in-the-water case", () => {
    const result = effectiveAttendanceByStudent([
      entry({
        id: "orig",
        state: "ABSENT",
        recordedAt: new Date("2026-03-10T17:00:00Z"),
      }),
      entry({
        id: "fix",
        state: "PRESENT",
        recordedAt: new Date("2026-03-10T17:20:00Z"),
        supersedesEventId: "orig",
      }),
    ]);
    expect(result.get("sp1")).toMatchObject({
      eventId: "fix",
      state: "PRESENT",
    });
  });

  it("supersession beats recency: a superseded row loses even when it is the latest", () => {
    // The correction was recorded, then somebody appended one more original
    // observation with an EARLIER instant (a backdated write) — the superseded
    // row must stay out of the running regardless of timestamps.
    const result = effectiveAttendanceByStudent([
      entry({
        id: "orig",
        state: "ABSENT",
        recordedAt: new Date("2026-03-10T19:00:00Z"),
      }),
      entry({
        id: "fix",
        state: "LATE",
        recordedAt: new Date("2026-03-10T17:20:00Z"),
        supersedesEventId: "orig",
      }),
    ]);
    expect(result.get("sp1")).toMatchObject({ eventId: "fix", state: "LATE" });
  });

  it("a chain of corrections resolves to the unsuperseded end", () => {
    const result = effectiveAttendanceByStudent([
      entry({ id: "a", state: "ABSENT" }),
      entry({
        id: "b",
        state: "PRESENT",
        recordedAt: new Date("2026-03-10T17:10:00Z"),
        supersedesEventId: "a",
      }),
      entry({
        id: "c",
        state: "EXCUSED",
        recordedAt: new Date("2026-03-10T17:20:00Z"),
        supersedesEventId: "b",
      }),
    ]);
    expect(result.get("sp1")).toMatchObject({ eventId: "c", state: "EXCUSED" });
  });

  it("two surviving corrections of the same event resolve by recency", () => {
    const result = effectiveAttendanceByStudent([
      entry({ id: "a", state: "ABSENT" }),
      entry({
        id: "b",
        state: "PRESENT",
        recordedAt: new Date("2026-03-10T17:10:00Z"),
        supersedesEventId: "a",
      }),
      entry({
        id: "c",
        state: "LATE",
        recordedAt: new Date("2026-03-10T17:30:00Z"),
        supersedesEventId: "a",
      }),
    ]);
    expect(result.get("sp1")).toMatchObject({ eventId: "c", state: "LATE" });
  });

  it("an exact tie resolves by insertion order — the write order callers pass", () => {
    const at = new Date("2026-03-10T17:00:00Z");
    const result = effectiveAttendanceByStudent([
      entry({ id: "first", state: "ABSENT", recordedAt: at }),
      entry({ id: "second", state: "PRESENT", recordedAt: at }),
    ]);
    expect(result.get("sp1")).toMatchObject({ eventId: "second" });
  });

  it("keeps pupils separate", () => {
    const result = effectiveAttendanceByStudent([
      entry({ id: "a", studentProfileId: "sp1", state: "PRESENT" }),
      entry({ id: "b", studentProfileId: "sp2", state: "ABSENT" }),
    ]);
    expect(result.get("sp1")?.state).toBe("PRESENT");
    expect(result.get("sp2")?.state).toBe("ABSENT");
  });
});

describe("AttendanceError", () => {
  it("carries its reason as a field and a Dutch sentence as its message", () => {
    const error = new AttendanceError("NOT_ON_ROSTER");
    expect(error.reason).toBe("NOT_ON_ROSTER");
    expect(error.message).toContain("Gast toevoegen");
  });
});
