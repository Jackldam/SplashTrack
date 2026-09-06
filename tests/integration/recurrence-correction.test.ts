/**
 * Correcting a lesson series, and what that does to the lessons it made.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FIRST TEST IS THE REASON THE REST EXIST
 *
 * Phase 1.7 recorded *"a recurrence's weekday and time are not editable"* as
 * CLOSED rather than deferred, on the grounds that stopping the rule and
 * creating another is the correction. `stop-and-create` below runs exactly that
 * procedure and counts the rows: the club ends up with **two lessons on the
 * same evening**, one of them at the wrong time.
 *
 * That is not a bug in `deactivateRecurrence` — it does precisely what it says,
 * setting `active: false` and leaving the timetable alone, because the lessons
 * it produced point at it. It is that the idempotency key is
 * `(recurrenceId, occursOn)`, **per rule**, so a replacement series cannot
 * deduplicate against its predecessor's lessons. Anything built on "make
 * another one" inherits that.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE OTHERS ARE FOR
 *
 * Every remaining assertion is a place where a plausible implementation is
 * wrong in a way no screen would show:
 *
 *   1. **The past does not move.** Free here, and therefore easy to break by
 *      accident: an implementation that recomputed every occurrence from the
 *      rule would rewrite the club's own record of what it taught, and would
 *      look completely correct on next week's lesson.
 *   2. **The future does move** — including its `occursOn`, which is half the
 *      idempotency key. If it did not, the very next generation run would
 *      produce the new weekday's lessons beside the old ones and reintroduce
 *      the defect this whole capability exists to remove.
 *   3. **A cancelled lesson stays cancelled, and moves.** Leaving it behind is
 *      the subtle one: the moved series generates a fresh SCHEDULED lesson that
 *      week, so a time correction silently reopens a week the club called off.
 *   4. **A pool change empties the season's lanes and freezes the past**, via
 *      D-190's own `pinPastOccurrences` rather than a second copy of rule 3.
 *   5. **It refuses rather than revert an override**, and refuses cleanly —
 *      nothing written.
 *
 * NOTHING IS FAKED. `groups-fixtures.ts` registers the real `ScopeRelations` of
 * all three modules, so the denial is the check that runs in production.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PermissionDeniedError } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import {
  cancelSession,
  createClosure,
  createLane,
  createPool,
  createRecurrence,
  deactivateRecurrence,
  generateSessions,
  listRecurrencesForGroup,
  overrideSessionLanes,
  resolveTimeZone,
  setRecurrenceLanes,
  toIsoDate,
  updatePool,
  updateRecurrence,
} from "@/modules/sessions";

import {
  grantTo,
  GROUPS_ADMIN_PERMISSIONS,
  INSTRUCTOR_PERMISSIONS,
  installRealRelations,
  makeGroup,
  makePerson,
  makeRole,
  resetGroupsFixtures,
} from "../support/groups-fixtures";

/**
 * "Now" sits INSIDE the term, as it does in `lane-assignment.test.ts` and for
 * the same reason: the Tuesdays before it are the past a correction must not
 * touch and the ones after it are the future that follows. A `NOW` outside the
 * term would make one of the two halves untestable.
 *
 * The term also straddles the last Sunday in March, so "the lesson is at 18:30"
 * is asserted on both sides of a change of offset.
 */
const NOW = new Date("2026-03-18T12:00:00.000Z");

/** Tuesdays in the term. The first three have started; the rest have not. */
const PAST_DATES = ["2026-03-03", "2026-03-10", "2026-03-17"];
const FUTURE_DATES = [
  "2026-03-24",
  "2026-03-31",
  "2026-04-07",
  "2026-04-14",
  "2026-04-21",
  "2026-04-28",
];

let adminId: string;
let readerId: string;

function admin() {
  return { principal: { personId: adminId }, at: NOW };
}

function reader() {
  return { principal: { personId: readerId }, at: NOW };
}

beforeAll(() => {
  installRealRelations();
});

/** `Pool.name` is unique, so one survivor fails the next run. */
async function clearFacilities(): Promise<void> {
  await prisma.lane.deleteMany({});
  await prisma.pool.deleteMany({});
}

beforeEach(async () => {
  await resetGroupsFixtures();
  await clearFacilities();

  adminId = await makePerson("rec_admin");
  await grantTo({
    personId: adminId,
    roleId: await makeRole("role_rec_admin", [...GROUPS_ADMIN_PERMISSIONS]),
    scopeType: "ORGANIZATION",
  });

  readerId = await makePerson("rec_reader");
  await grantTo({
    personId: readerId,
    // `planning.read` and not `planning.manage` — the role a club hands an
    // instructor.
    roleId: await makeRole("role_rec_reader", [...INSTRUCTOR_PERMISSIONS]),
    scopeType: "ORGANIZATION",
  });
});

afterAll(async () => {
  await resetGroupsFixtures();
  await clearFacilities();
});

interface Series {
  groupId: string;
  recurrenceId: string;
  poolId: string;
  lanes: Record<string, string>;
}

/** A group, a pool with four lanes, a Tuesday-evening rule, and its term. */
async function aSeries(
  suffix: string,
  lanes: readonly string[] = [],
): Promise<Series> {
  const groupId = await makeGroup(`rec_${suffix}`);
  const pool = await createPool(admin(), {
    name: `Wedstrijdbad ${suffix}`,
    lengthMetres: 25,
  });
  const laneIds: Record<string, string> = {};
  for (const [index, name] of ["baan 1", "baan 2", "baan 3"].entries()) {
    laneIds[name] = (
      await createLane(admin(), pool.id, { name, sequence: index })
    ).id;
  }

  const recurrence = await createRecurrence(admin(), groupId, {
    poolId: pool.id,
    weekday: 2,
    startTime: "18:00",
    durationMinutes: 45,
    startsOn: "2026-03-01",
    endsOn: "2026-04-30",
  });
  if (lanes.length > 0) {
    await setRecurrenceLanes(admin(), recurrence.id, {
      laneIds: lanes.map((name) => laneIds[name]!),
    });
  }
  await generateSessions(admin(), groupId, {
    from: "2026-03-01",
    to: "2026-04-30",
  });

  return {
    groupId,
    recurrenceId: recurrence.id,
    poolId: pool.id,
    lanes: laneIds,
  };
}

/** Every lesson of a group, oldest first, straight from the table. */
async function lessonsOf(groupId: string) {
  const rows = await prisma.scheduledSession.findMany({
    where: { groupId },
    orderBy: [{ occursOn: "asc" }, { startsAt: "asc" }],
    select: {
      id: true,
      occursOn: true,
      startsAt: true,
      endsAt: true,
      poolId: true,
      status: true,
      cancelledAt: true,
      cancellationReason: true,
      laneSource: true,
    },
  });
  return rows;
}

const TIME_ZONE = resolveTimeZone(null);

/** The wall clock a lesson starts at, in the zone the generator used. */
function wallClock(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
}

function dates(rows: readonly { occursOn: Date }[]): string[] {
  return rows.map((row) => toIsoDate(row.occursOn));
}

// ---------------------------------------------------------------------------
// 0. The premise: why "stop and create" is not the correction
// ---------------------------------------------------------------------------

describe("the answer phase 1.7 recorded", () => {
  it("stop-and-create puts two lessons on the same evening", async () => {
    const series = await aSeries("stopandcreate");

    // Exactly the documented procedure: stop the rule, make another with the
    // corrected time, generate.
    await deactivateRecurrence(admin(), series.recurrenceId);
    await createRecurrence(admin(), series.groupId, {
      poolId: series.poolId,
      weekday: 2,
      startTime: "18:30",
      durationMinutes: 45,
      startsOn: "2026-03-01",
      endsOn: "2026-04-30",
    });
    await generateSessions(admin(), series.groupId, {
      from: "2026-03-01",
      to: "2026-04-30",
    });

    const march24 = (await lessonsOf(series.groupId)).filter(
      (row) => toIsoDate(row.occursOn) === "2026-03-24",
    );
    // THE DEFECT, counted. `skipDuplicates` cannot see the first series'
    // lesson, because the unique index is `(recurrenceId, occursOn)` and the
    // replacement carries a different `recurrenceId`.
    expect(march24).toHaveLength(2);
    expect(march24.map((row) => wallClock(row.startsAt)).sort()).toEqual([
      "18:00",
      "18:30",
    ]);
  });

  it("correcting the rule in place leaves one lesson that evening", async () => {
    const series = await aSeries("inplace");

    await updateRecurrence(admin(), series.recurrenceId, {
      poolId: series.poolId,
      weekday: 2,
      startTime: "18:30",
      durationMinutes: 45,
    });
    await generateSessions(admin(), series.groupId, {
      from: "2026-03-01",
      to: "2026-04-30",
    });

    const march24 = (await lessonsOf(series.groupId)).filter(
      (row) => toIsoDate(row.occursOn) === "2026-03-24",
    );
    expect(march24).toHaveLength(1);
    expect(wallClock(march24[0]!.startsAt)).toBe("18:30");
  });
});

// ---------------------------------------------------------------------------
// 1. The time, and the boundary
// ---------------------------------------------------------------------------

describe("changing a season's time", () => {
  it("moves the lessons still to come and leaves the ones already taught", async () => {
    const series = await aSeries("time");

    const report = await updateRecurrence(admin(), series.recurrenceId, {
      poolId: series.poolId,
      weekday: 2,
      startTime: "18:30",
      durationMinutes: 45,
    });
    expect(report.moved).toBe(FUTURE_DATES.length);
    expect(report.changed).toEqual(["startMinuteOfDay"]);

    const lessons = await lessonsOf(series.groupId);
    // THE RECORD OF WHAT THE CLUB DID. Rewriting these would answer "hoe laat
    // zwommen we op 10 maart" with today's rule instead of that evening.
    for (const row of lessons) {
      const expected = PAST_DATES.includes(toIsoDate(row.occursOn))
        ? "18:00"
        : "18:30";
      expect(`${toIsoDate(row.occursOn)} ${wallClock(row.startsAt)}`).toBe(
        `${toIsoDate(row.occursOn)} ${expected}`,
      );
    }
    // The dates themselves are untouched: a time is not a date.
    expect(dates(lessons)).toEqual([...PAST_DATES, ...FUTURE_DATES]);
  });

  it("keeps the wall clock across the March change of offset", async () => {
    // A 45-minute lesson is 45 minutes on the night the clocks change, and
    // 19:15 is 19:15 in April as well as in March. An implementation that
    // shifted `startsAt` by a fixed number of milliseconds passes every
    // assertion above and is an hour out for half the term.
    const series = await aSeries("dst");

    await updateRecurrence(admin(), series.recurrenceId, {
      poolId: series.poolId,
      weekday: 2,
      startTime: "19:15",
      durationMinutes: 45,
    });

    const future = (await lessonsOf(series.groupId)).filter((row) =>
      FUTURE_DATES.includes(toIsoDate(row.occursOn)),
    );
    expect(future.length).toBeGreaterThan(3);
    for (const row of future) {
      expect(wallClock(row.startsAt)).toBe("19:15");
      expect(row.endsAt.getTime() - row.startsAt.getTime()).toBe(45 * 60_000);
    }
  });

  it("recomputes the end when the lesson gets longer", async () => {
    const series = await aSeries("duration");

    await updateRecurrence(admin(), series.recurrenceId, {
      poolId: series.poolId,
      weekday: 2,
      startTime: "18:00",
      durationMinutes: 60,
    });

    for (const row of await lessonsOf(series.groupId)) {
      const expected = PAST_DATES.includes(toIsoDate(row.occursOn)) ? 45 : 60;
      expect(row.endsAt.getTime() - row.startsAt.getTime()).toBe(
        expected * 60_000,
      );
    }
  });

  it("writes nothing at all when nothing changed", async () => {
    const series = await aSeries("noop");
    const before = await lessonsOf(series.groupId);

    const report = await updateRecurrence(admin(), series.recurrenceId, {
      poolId: series.poolId,
      weekday: 2,
      startTime: "18:00",
      durationMinutes: 45,
    });

    expect(report).toEqual({
      changed: [],
      moved: 0,
      onClosure: 0,
      pinnedSessions: 0,
      startsOn: null,
    });
    expect(await lessonsOf(series.groupId)).toEqual(before);
    expect(
      await prisma.auditEvent.count({
        where: {
          eventType: "sessions.recurrence.updated",
          // THIS group's — the audit table is append-only and survives the
          // fixture reset, so an unscoped count would be answering about the
          // rest of the file.
          targetId: series.groupId,
        },
      }),
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. The weekday — the half that touches the idempotency key
// ---------------------------------------------------------------------------

describe("changing a season's weekday", () => {
  it("walks the future forward and carries the rule's start with it", async () => {
    const series = await aSeries("weekday");

    const report = await updateRecurrence(admin(), series.recurrenceId, {
      poolId: series.poolId,
      weekday: 4, // Tuesday → Thursday, +2 days
      startTime: "18:00",
      durationMinutes: 45,
    });
    expect(report.moved).toBe(FUTURE_DATES.length);
    expect(report.startsOn).toBe("2026-03-26");

    expect(dates(await lessonsOf(series.groupId))).toEqual([
      ...PAST_DATES, // the Tuesdays already taught, exactly where they were
      "2026-03-26",
      "2026-04-02",
      "2026-04-09",
      "2026-04-16",
      "2026-04-23",
      "2026-04-30",
    ]);

    const [rule] = await listRecurrencesForGroup(admin(), series.groupId);
    expect(rule!.weekday).toBe(4);
    expect(toIsoDate(rule!.startsOn)).toBe("2026-03-26");
  });

  it("leaves generation idempotent — a re-run creates nothing", async () => {
    // THE PROPERTY THE WHOLE CORRECTION RESTS ON. If the moved dates did not
    // line up exactly with what the corrected rule now plans, the next
    // generation run would fill the gaps and the club would be back to two
    // lessons a week.
    const series = await aSeries("regenerate");
    await updateRecurrence(admin(), series.recurrenceId, {
      poolId: series.poolId,
      weekday: 4,
      startTime: "18:00",
      durationMinutes: 45,
    });

    const again = await generateSessions(admin(), series.groupId, {
      from: "2026-03-01",
      to: "2026-04-30",
    });
    expect(again.created).toBe(0);
    expect(
      await prisma.scheduledSession.count({
        where: { groupId: series.groupId },
      }),
    ).toBe(PAST_DATES.length + FUTURE_DATES.length);
  });

  it("never moves a lesson backwards into a past it did not happen in", async () => {
    // Thursday → Tuesday is `(2 - 4 + 7) % 7 = 5` days FORWARD, not two days
    // back. A signed offset would drop the lesson of 26 March onto 24 March —
    // a date that has already passed, on a rule that never taught it.
    const groupId = await makeGroup("rec_backwards");
    const pool = await createPool(admin(), { name: "Bad achteruit" });
    const rule = await createRecurrence(admin(), groupId, {
      poolId: pool.id,
      weekday: 4,
      startTime: "18:00",
      durationMinutes: 45,
      startsOn: "2026-03-01",
      endsOn: "2026-04-30",
    });
    await generateSessions(admin(), groupId, {
      from: "2026-03-01",
      to: "2026-04-30",
    });

    await updateRecurrence(admin(), rule.id, {
      poolId: pool.id,
      weekday: 2,
      startTime: "18:00",
      durationMinutes: 45,
    });

    const lessons = await lessonsOf(groupId);
    for (const row of lessons) {
      if (row.startsAt.getTime() > NOW.getTime()) continue;
      // Everything at or before NOW is a Thursday that was actually taught.
      expect(["2026-03-05", "2026-03-12"]).toContain(toIsoDate(row.occursOn));
    }
    expect(dates(lessons).filter((date) => date > "2026-03-18")).toEqual([
      "2026-03-24", // was 19 March, +5
      "2026-03-31",
      "2026-04-07",
      "2026-04-14",
      "2026-04-21",
      "2026-04-28",
      // The last one lands PAST the rule's own `endsOn` of 30 April, and stays.
      // Deleting it is not on offer — nothing in this application deletes a
      // lesson — and it is a real occurrence the club is expected to teach or
      // cancel. What it is not is something the rule will produce again.
      "2026-05-05",
    ]);
  });

  it("counts the lessons it has just moved onto a closure", async () => {
    const series = await aSeries("closure");
    // THIS GROUP'S, not club-wide, and that is not cosmetic:
    // `resetGroupsFixtures` only drops a `ScheduleException` whose `groupId` —
    // or whose reason — carries the fixtures prefix, so a club-wide closure
    // written here would survive the reset and quietly suppress 26 March for
    // every other suite in this database. Found the hard way, in this file.
    await createClosure(admin(), {
      groupId: series.groupId,
      fromDate: "2026-03-25",
      toDate: "2026-03-27",
      reason: "bad in onderhoud",
    });

    const report = await updateRecurrence(admin(), series.recurrenceId, {
      poolId: series.poolId,
      weekday: 4,
      startTime: "18:00",
      durationMinutes: 45,
    });

    // 26 March is inside the closure. The lesson is NOT deleted — nothing in
    // this application deletes one — but the person is told, because the repair
    // is cancelling it and only they can write the reason.
    expect(report.onClosure).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. A cancelled lesson
// ---------------------------------------------------------------------------

describe("a lesson the club called off", () => {
  it("moves with the series and stays cancelled", async () => {
    const series = await aSeries("cancelled");
    const march24 = (await lessonsOf(series.groupId)).find(
      (row) => toIsoDate(row.occursOn) === "2026-03-24",
    )!;
    await cancelSession(admin(), march24.id, { reason: "bad in onderhoud" });

    await updateRecurrence(admin(), series.recurrenceId, {
      poolId: series.poolId,
      weekday: 4,
      startTime: "18:00",
      durationMinutes: 45,
    });

    const moved = (await lessonsOf(series.groupId)).find(
      (row) => row.id === march24.id,
    )!;
    expect(toIsoDate(moved.occursOn)).toBe("2026-03-26");
    expect(moved.status).toBe("CANCELLED");
    expect(moved.cancellationReason).toBe("bad in onderhoud");
    expect(moved.cancelledAt).toEqual(NOW);
  });

  it("is not silently reopened by the correction", async () => {
    // THE FAILURE THIS ORDERING PREVENTS. Leave the cancelled lesson on the old
    // date and the corrected rule generates a fresh SCHEDULED one that week —
    // so a time correction quietly puts back a lesson somebody called off.
    const series = await aSeries("reopen");
    const march24 = (await lessonsOf(series.groupId)).find(
      (row) => toIsoDate(row.occursOn) === "2026-03-24",
    )!;
    await cancelSession(admin(), march24.id, { reason: "geen lesgever" });

    await updateRecurrence(admin(), series.recurrenceId, {
      poolId: series.poolId,
      weekday: 4,
      startTime: "18:00",
      durationMinutes: 45,
    });
    await generateSessions(admin(), series.groupId, {
      from: "2026-03-01",
      to: "2026-04-30",
    });

    const thatWeek = (await lessonsOf(series.groupId)).filter(
      (row) =>
        toIsoDate(row.occursOn) >= "2026-03-23" &&
        toIsoDate(row.occursOn) <= "2026-03-29",
    );
    expect(thatWeek).toHaveLength(1);
    expect(thatWeek[0]!.status).toBe("CANCELLED");
  });
});

// ---------------------------------------------------------------------------
// 4. The pool, and the lanes that live inside it
// ---------------------------------------------------------------------------

describe("moving a season to another pool", () => {
  it("moves the future, freezes the past, and empties the lane selection", async () => {
    const series = await aSeries("pool", ["baan 1", "baan 2"]);
    const other = await createPool(admin(), { name: "Instructiebad" });
    await createLane(admin(), other.id, { name: "ondiep", sequence: 0 });

    const report = await updateRecurrence(admin(), series.recurrenceId, {
      poolId: other.id,
      weekday: 2,
      startTime: "18:00",
      durationMinutes: 45,
    });
    expect(report.pinnedSessions).toBe(PAST_DATES.length);

    for (const row of await lessonsOf(series.groupId)) {
      const past = PAST_DATES.includes(toIsoDate(row.occursOn));
      expect(row.poolId).toBe(past ? series.poolId : other.id);
      // D-190 rule 3, through the same code path `setRecurrenceLanes` uses.
      expect(row.laneSource).toBe(past ? "PINNED" : null);
    }

    const frozen = await prisma.sessionLane.findMany({
      where: { session: { groupId: series.groupId } },
      select: { lane: { select: { name: true } } },
    });
    expect(frozen).toHaveLength(PAST_DATES.length * 2);
    expect(new Set(frozen.map((row) => row.lane.name))).toEqual(
      new Set(["baan 1", "baan 2"]),
    );

    // A lane is a place inside a pool, so the season's selection cannot survive
    // the move — it has to be made again, in the new water.
    const [rule] = await listRecurrencesForGroup(admin(), series.groupId);
    expect(rule!.lanes).toEqual([]);
    expect(rule!.poolLanes.map((lane) => lane.name)).toEqual(["ondiep"]);
  });

  it("refuses while a lesson still to come has lanes of its own, and writes nothing", async () => {
    const series = await aSeries("override", ["baan 1"]);
    const other = await createPool(admin(), { name: "Instructiebad twee" });
    const march24 = (await lessonsOf(series.groupId)).find(
      (row) => toIsoDate(row.occursOn) === "2026-03-24",
    )!;
    await overrideSessionLanes(admin(), march24.id, {
      laneIds: [series.lanes["baan 3"]!],
    });

    await expect(
      updateRecurrence(admin(), series.recurrenceId, {
        poolId: other.id,
        weekday: 2,
        startTime: "18:00",
        durationMinutes: 45,
      }),
    ).rejects.toMatchObject({ reason: "laneOverrideBlocksPool" });

    // Nothing half-done: not the rule, not the past, not the override.
    const [rule] = await listRecurrencesForGroup(admin(), series.groupId);
    expect(rule!.poolId).toBe(series.poolId);
    expect(rule!.lanes.map((lane) => lane.name)).toEqual(["baan 1"]);
    expect(
      await prisma.scheduledSession.count({
        where: { groupId: series.groupId, laneSource: "PINNED" },
      }),
    ).toBe(0);
    const still = (await lessonsOf(series.groupId)).find(
      (row) => row.id === march24.id,
    )!;
    expect(still.laneSource).toBe("OVERRIDE");
  });

  it("refuses a pool that does not exist, or has been taken out of use", async () => {
    const series = await aSeries("poolgone");

    await expect(
      updateRecurrence(admin(), series.recurrenceId, {
        poolId: "no_such_pool",
        weekday: 2,
        startTime: "18:00",
        durationMinutes: 45,
      }),
    ).rejects.toMatchObject({ reason: "poolNotFound" });

    const retired = await createPool(admin(), { name: "Oud bad" });
    await updatePool(admin(), retired.id, { name: "Oud bad", active: null });
    await expect(
      updateRecurrence(admin(), series.recurrenceId, {
        poolId: retired.id,
        weekday: 2,
        startTime: "18:00",
        durationMinutes: 45,
      }),
    ).rejects.toMatchObject({ reason: "poolNotFound" });
  });
});

// ---------------------------------------------------------------------------
// 5. Authorization
// ---------------------------------------------------------------------------

describe("without planning.manage", () => {
  it("is DENIED, and changes nothing", async () => {
    const series = await aSeries("denied");
    const before = await lessonsOf(series.groupId);

    await expect(
      updateRecurrence(reader(), series.recurrenceId, {
        poolId: series.poolId,
        weekday: 4,
        startTime: "19:00",
        durationMinutes: 45,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    expect(await lessonsOf(series.groupId)).toEqual(before);
    const [rule] = await listRecurrencesForGroup(admin(), series.groupId);
    expect(rule!.weekday).toBe(2);
  });
});
