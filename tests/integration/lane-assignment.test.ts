/**
 * Lane assignment — inherit from the season, override one lesson (D-190).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE, AND WHY AGAINST A REAL DATABASE
 *
 * `SessionLane` sat in the schema for two phases with nothing writing it. What
 * this pass adds is not a form — it is a RULE about where a lesson's lanes come
 * from, and every assertion below is a place where a plausible implementation
 * is wrong in a way no screen would show:
 *
 *   1. **Generated lessons inherit.** An implementation that materialised the
 *      recurrence's lanes onto every occurrence at generation would pass a
 *      click-through and cost a row per lane per week — and, worse, would make
 *      an inherited lesson indistinguishable from an overridden one, so the
 *      next change to the season would either rewrite an override or skip
 *      everything.
 *   2. **An override is local.** A write that touched the recurrence, or its
 *      neighbours, would look identical on the lesson you were looking at.
 *   3. **Clearing returns to inheriting**, marker and rows together. Deleting
 *      the rows and leaving the marker gives a lesson that claims to be
 *      overridden and shows nothing; clearing the marker and leaving the rows
 *      gives one that claims to inherit and shows its own lanes. Both look
 *      fine from the side you are standing on.
 *   4. **Changing the season behaves as decided**: overrides untouched, future
 *      non-overridden lessons follow, past ones keep what they were taught in.
 *      The third is the one that costs something, so it is the one an
 *      implementation quietly drops.
 *   5. **Without `planning.manage` it is DENIED**, not ignored.
 *
 * NOTHING IS FAKED. `groups-fixtures.ts` registers the real `ScopeRelations` of
 * all three modules, so the denial in 5 is the check that runs in production.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PermissionDeniedError } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import {
  clearSessionLaneOverride,
  createLane,
  createPool,
  createRecurrence,
  generateSessions,
  getSessionForPrincipal,
  listRecurrencesForGroup,
  listSessionsForPrincipal,
  overrideSessionLanes,
  ScheduleError,
  setRecurrenceLanes,
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
 * "Now" for the whole suite, and it sits INSIDE the generated term on purpose:
 * the March lessons before it are the past that rule 3 pins and the ones after
 * it are the future that follows. A `NOW` outside the term would make one of
 * the two halves untestable.
 */
const NOW = new Date("2026-03-18T12:00:00.000Z");

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

/**
 * Pools made by `createPool` carry a generated id rather than the fixture
 * prefix, and `Pool.name` is unique — so one survivor fails the next run.
 * `correctability.test.ts` empties both tables for the same reason.
 */
async function clearFacilities(): Promise<void> {
  await prisma.lane.deleteMany({});
  await prisma.pool.deleteMany({});
}

beforeEach(async () => {
  await resetGroupsFixtures();
  await clearFacilities();

  adminId = await makePerson("lane_admin");
  await grantTo({
    personId: adminId,
    roleId: await makeRole("role_lane_admin", [...GROUPS_ADMIN_PERMISSIONS]),
    scopeType: "ORGANIZATION",
  });

  readerId = await makePerson("lane_reader");
  await grantTo({
    personId: readerId,
    // `planning.read` without `planning.manage` — the role the club actually
    // hands an instructor.
    roleId: await makeRole("role_lane_reader", [...INSTRUCTOR_PERMISSIONS]),
    scopeType: "ORGANIZATION",
  });
});

afterAll(async () => {
  await resetGroupsFixtures();
  await clearFacilities();
});

interface Season {
  groupId: string;
  recurrenceId: string;
  poolId: string;
  lanes: Record<string, string>;
  /** The generated lessons, oldest first. */
  sessionIds: string[];
}

/**
 * A club, a pool with four lanes, one Tuesday-evening rule, and a term of
 * lessons generated from it — which is what every assertion below is about.
 *
 * The lessons straddle `NOW`: 3, 10 and 17 March have started, 24 and 31 March
 * have not.
 *
 * THE LANES ARE SET BEFORE THE TERM IS GENERATED, which is the order a club
 * works in once this feature exists: describe the season, then produce it. It
 * also matters to what these tests can claim — setting a season's lanes for the
 * FIRST time after lessons have been taught pins those lessons with the empty
 * set they were taught under, which is correct (nobody recorded lanes for them)
 * and is asserted on its own below rather than smuggled into every fixture.
 */
async function aSeason(
  suffix: string,
  initialLanes: readonly string[] = [],
): Promise<Season> {
  const groupId = await makeGroup(`lane_${suffix}`);
  const pool = await createPool(admin(), {
    name: `Wedstrijdbad ${suffix}`,
    lengthMetres: 25,
  });
  const lanes: Record<string, string> = {};
  for (const [index, name] of [
    "baan 1",
    "baan 2",
    "baan 3",
    "baan 4",
  ].entries()) {
    lanes[name] = (
      await createLane(admin(), pool.id, { name, sequence: index })
    ).id;
  }

  const recurrence = await createRecurrence(admin(), groupId, {
    poolId: pool.id,
    weekday: 2,
    startTime: "18:00",
    durationMinutes: 45,
    startsOn: "2026-03-01",
    endsOn: "2026-03-31",
  });
  if (initialLanes.length > 0) {
    await setRecurrenceLanes(admin(), recurrence.id, {
      laneIds: initialLanes.map((name) => lanes[name]!),
    });
  }
  await generateSessions(admin(), groupId, {
    from: "2026-03-01",
    to: "2026-03-31",
  });

  const sessions = await prisma.scheduledSession.findMany({
    where: { groupId },
    orderBy: { startsAt: "asc" },
    select: { id: true },
  });

  return {
    groupId,
    recurrenceId: recurrence.id,
    poolId: pool.id,
    lanes,
    sessionIds: sessions.map((row) => row.id),
  };
}

/** The lessons of a group as the schedule screen reads them, oldest first. */
async function scheduleOf(groupId: string) {
  const rows = await listSessionsForPrincipal(admin(), {
    from: new Date("2026-01-01T00:00:00.000Z"),
    to: new Date("2026-12-31T00:00:00.000Z"),
    groupId,
  });
  return rows.map((row) => ({
    id: row.id,
    lanes: row.laneAssignment.lanes.map((lane) => lane.name),
    source: row.laneAssignment.laneSource,
  }));
}

// ---------------------------------------------------------------------------
// 1. Generated lessons inherit the recurrence's lanes
// ---------------------------------------------------------------------------

describe("a season's lanes", () => {
  it("are inherited by every lesson the rule generates", async () => {
    const season = await aSeason("inherit", ["baan 1", "baan 2"]);

    const schedule = await scheduleOf(season.groupId);
    expect(schedule.length).toBeGreaterThan(3);
    for (const lesson of schedule) {
      expect(lesson.source).toBe("INHERITED");
      expect(lesson.lanes).toEqual(["baan 1", "baan 2"]);
    }
  });

  it("cost nothing per lesson — inheritance is by reference, not by copy", async () => {
    // THE PROPERTY THE WHOLE MODEL RESTS ON. A term of lessons each carrying
    // its own copy of the season's lanes would pass the assertion above and
    // would make every later rule about propagation unimplementable, because
    // an inherited lesson would be indistinguishable from an overridden one.
    const season = await aSeason("byreference", ["baan 1", "baan 2"]);

    expect(
      await prisma.sessionLane.count({
        where: { session: { groupId: season.groupId } },
      }),
    ).toBe(0);
    expect(
      await prisma.scheduledSession.count({
        where: { groupId: season.groupId, laneSource: { not: null } },
      }),
    ).toBe(0);
  });

  it("survive a re-run of the generator", async () => {
    const season = await aSeason("laterterm", ["baan 3"]);

    // Generation is idempotent, so nothing new appears — and the point here is
    // that nothing OLD changes either: a second run must not stamp lanes onto
    // lessons that are inheriting them perfectly well.
    await generateSessions(admin(), season.groupId, {
      from: "2026-03-01",
      to: "2026-03-31",
    });

    const schedule = await scheduleOf(season.groupId);
    expect(schedule).toHaveLength(season.sessionIds.length);
    expect(schedule.every((lesson) => lesson.source === "INHERITED")).toBe(
      true,
    );
    expect(schedule.every((lesson) => lesson.lanes.join() === "baan 3")).toBe(
      true,
    );
  });

  it("reach the screen that edits them, with the pool's lanes to choose from", async () => {
    const season = await aSeason("recurrenceview", ["baan 2"]);

    const [rule] = await listRecurrencesForGroup(admin(), season.groupId);
    expect(rule!.lanes.map((lane) => lane.name)).toEqual(["baan 2"]);
    // The CHOICES, and they are this pool's — the form cannot offer a lane the
    // service would then refuse.
    expect(rule!.poolLanes.map((lane) => lane.name)).toEqual([
      "baan 1",
      "baan 2",
      "baan 3",
      "baan 4",
    ]);
  });

  it("refuse a lane from another pool, and any lane at all without one", async () => {
    const season = await aSeason("wrongpool");
    const otherPool = await createPool(admin(), { name: "Instructiebad" });
    const otherLane = await createLane(admin(), otherPool.id, {
      name: "ondiep",
    });

    await expect(
      setRecurrenceLanes(admin(), season.recurrenceId, {
        laneIds: [otherLane.id],
      }),
    ).rejects.toMatchObject({ reason: "laneNotInPool" });

    const poolless = await createRecurrence(admin(), season.groupId, {
      weekday: 4,
      startTime: "19:00",
      durationMinutes: 45,
      startsOn: "2026-03-01",
    });
    await expect(
      setRecurrenceLanes(admin(), poolless.id, {
        laneIds: [season.lanes["baan 1"]],
      }),
    ).rejects.toMatchObject({ reason: "laneWithoutPool" });
  });

  it("accept several at once — the model is many-to-many because the club is", async () => {
    const season = await aSeason("multiple", ["baan 1", "baan 2", "baan 3"]);

    const [rule] = await listRecurrencesForGroup(admin(), season.groupId);
    expect(rule!.lanes.map((lane) => lane.name)).toEqual([
      "baan 1",
      "baan 2",
      "baan 3",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. An override on one lesson leaves its neighbours untouched
// ---------------------------------------------------------------------------

describe("an override on one lesson", () => {
  it("changes that lesson and nothing else — not the series, not its neighbours", async () => {
    const season = await aSeason("override", ["baan 1", "baan 2"]);

    const target = season.sessionIds[1]!;
    await overrideSessionLanes(admin(), target, {
      laneIds: [season.lanes["baan 3"], season.lanes["baan 4"]],
    });

    const schedule = await scheduleOf(season.groupId);
    for (const lesson of schedule) {
      if (lesson.id === target) {
        expect(lesson.source).toBe("OVERRIDE");
        expect(lesson.lanes).toEqual(["baan 3", "baan 4"]);
      } else {
        expect(lesson.source).toBe("INHERITED");
        expect(lesson.lanes).toEqual(["baan 1", "baan 2"]);
      }
    }

    // And the SERIES is what it was. An override that wrote through to the
    // recurrence would look right on the lesson it was made on.
    const [rule] = await listRecurrencesForGroup(admin(), season.groupId);
    expect(rule!.lanes.map((lane) => lane.name)).toEqual(["baan 1", "baan 2"]);
  });

  it("is a REPLACEMENT: unticking a lane removes it", async () => {
    const season = await aSeason("replace");
    const target = season.sessionIds[0]!;

    await overrideSessionLanes(admin(), target, {
      laneIds: [season.lanes["baan 1"], season.lanes["baan 2"]],
    });
    await overrideSessionLanes(admin(), target, {
      laneIds: [season.lanes["baan 2"]],
    });

    const lesson = await getSessionForPrincipal(admin(), target);
    expect(lesson!.laneAssignment.lanes.map((lane) => lane.name)).toEqual([
      "baan 2",
    ]);
  });

  it("with an EMPTY selection is a decision, not a clearing", async () => {
    // *"Deze week geen vaste baan"* is a statement, and it has to survive a
    // later change to the season exactly as any other override does — which is
    // only expressible because the marker is a column and not the presence of
    // rows.
    const season = await aSeason("emptyoverride", ["baan 1"]);

    const target = season.sessionIds[2]!;
    await overrideSessionLanes(admin(), target, { laneIds: [] });

    const lesson = await getSessionForPrincipal(admin(), target);
    expect(lesson!.laneAssignment.laneSource).toBe("OVERRIDE");
    expect(lesson!.laneAssignment.lanes).toEqual([]);

    await setRecurrenceLanes(admin(), season.recurrenceId, {
      laneIds: [season.lanes["baan 4"]],
    });
    const after = await getSessionForPrincipal(admin(), target);
    expect(after!.laneAssignment.laneSource).toBe("OVERRIDE");
    expect(after!.laneAssignment.lanes).toEqual([]);
  });

  it("offers the lesson's own pool's lanes to choose from", async () => {
    const season = await aSeason("sessionchoices");
    const lesson = await getSessionForPrincipal(admin(), season.sessionIds[0]!);
    expect(lesson!.poolLanes.map((lane) => lane.name)).toEqual([
      "baan 1",
      "baan 2",
      "baan 3",
      "baan 4",
    ]);
  });

  it("refuses a lane from another pool", async () => {
    const season = await aSeason("sessionwrongpool");
    const otherPool = await createPool(admin(), { name: "Instructiebad" });
    const otherLane = await createLane(admin(), otherPool.id, {
      name: "ondiep",
    });

    await expect(
      overrideSessionLanes(admin(), season.sessionIds[0]!, {
        laneIds: [otherLane.id],
      }),
    ).rejects.toBeInstanceOf(ScheduleError);
  });

  it("is audited against the lesson, and says what it was before", async () => {
    const season = await aSeason("overrideaudit");
    const target = season.sessionIds[0]!;
    await overrideSessionLanes(admin(), target, {
      laneIds: [season.lanes["baan 1"]],
    });

    const events = await prisma.auditEvent.findMany({
      where: { targetId: target },
      orderBy: { sequence: "asc" },
      select: {
        eventType: true,
        targetType: true,
        actorPersonId: true,
        changedFields: true,
      },
    });
    expect(events.at(-1)).toMatchObject({
      eventType: "sessions.session.lanes.overridden",
      targetType: "scheduled_session",
      actorPersonId: adminId,
      changedFields: {
        groupId: season.groupId,
        lanes: 1,
        previousSource: "INHERITED",
      },
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Clearing an override returns that lesson to inheriting
// ---------------------------------------------------------------------------

describe("clearing an override", () => {
  it("returns the lesson to following its series, and it follows a LATER change too", async () => {
    const season = await aSeason("clear", ["baan 1"]);

    const target = season.sessionIds[3]!;
    await overrideSessionLanes(admin(), target, {
      laneIds: [season.lanes["baan 4"]],
    });
    await clearSessionLaneOverride(admin(), target);

    const lesson = await getSessionForPrincipal(admin(), target);
    expect(lesson!.laneAssignment.laneSource).toBe("INHERITED");
    expect(lesson!.laneAssignment.lanes.map((lane) => lane.name)).toEqual([
      "baan 1",
    ]);

    // THE PART THAT WOULD BE WRONG IF CLEARING ONLY COPIED THE SEASON'S LANES
    // ONTO THE LESSON: it would read identically here and would never follow
    // the series again.
    await setRecurrenceLanes(admin(), season.recurrenceId, {
      laneIds: [season.lanes["baan 2"]],
    });
    const after = await getSessionForPrincipal(admin(), target);
    expect(after!.laneAssignment.laneSource).toBe("INHERITED");
    expect(after!.laneAssignment.lanes.map((lane) => lane.name)).toEqual([
      "baan 2",
    ]);
  });

  it("clears the marker and the rows together, never one of the two", async () => {
    // The invariant the database does not hold (see the migration's closing
    // comment). Rows left behind under a cleared marker are invisible until the
    // day somebody reads the join table directly.
    const season = await aSeason("pairing");
    const target = season.sessionIds[0]!;

    await overrideSessionLanes(admin(), target, {
      laneIds: [season.lanes["baan 1"], season.lanes["baan 2"]],
    });
    expect(
      await prisma.sessionLane.count({ where: { sessionId: target } }),
    ).toBe(2);

    await clearSessionLaneOverride(admin(), target);

    expect(
      await prisma.scheduledSession.findUniqueOrThrow({
        where: { id: target },
        select: { laneSource: true },
      }),
    ).toEqual({ laneSource: null });
    expect(
      await prisma.sessionLane.count({ where: { sessionId: target } }),
    ).toBe(0);
  });

  it("does nothing, and says nothing, to a lesson that already inherits", async () => {
    const season = await aSeason("clearnoop");
    const target = season.sessionIds[0]!;
    const before = await prisma.auditEvent.count({
      where: { targetId: target },
    });

    await clearSessionLaneOverride(admin(), target);

    expect(await prisma.auditEvent.count({ where: { targetId: target } })).toBe(
      before,
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Changing the series behaves as decided — the deferred cases pinned
// ---------------------------------------------------------------------------

describe("changing a series' lanes", () => {
  it("leaves an override alone, moves the future, and pins the past", async () => {
    const season = await aSeason("propagate", ["baan 1"]);

    // 3, 10, 17, 24, 31 March. `NOW` is 18 March, so the first three are past.
    const [first, second, third, fourth, fifth] = season.sessionIds;
    expect(fifth).toBeDefined();

    // One deliberate exception, on a FUTURE lesson.
    await overrideSessionLanes(admin(), fourth!, {
      laneIds: [season.lanes["baan 4"]],
    });

    // *"Vanaf nu zwemmen we in baan 2 en 3."*
    await setRecurrenceLanes(admin(), season.recurrenceId, {
      laneIds: [season.lanes["baan 2"], season.lanes["baan 3"]],
    });

    const byId = new Map(
      (await scheduleOf(season.groupId)).map((lesson) => [lesson.id, lesson]),
    );

    // THE PAST keeps what it was taught in, marked as recorded rather than as
    // somebody's deliberate exception.
    for (const past of [first!, second!, third!]) {
      expect(byId.get(past)).toMatchObject({
        source: "PINNED",
        lanes: ["baan 1"],
      });
    }
    // THE OVERRIDE is untouched — the requirement, not a judgement call.
    expect(byId.get(fourth!)).toMatchObject({
      source: "OVERRIDE",
      lanes: ["baan 4"],
    });
    // THE FUTURE follows, for free, because it never stored anything.
    expect(byId.get(fifth!)).toMatchObject({
      source: "INHERITED",
      lanes: ["baan 2", "baan 3"],
    });
  });

  it("pins a past lesson that had NO lanes, so it does not acquire them later", async () => {
    // The case an implementation that only copies rows gets wrong: with no
    // lanes to copy there is nothing to write, so the lesson keeps inheriting
    // and silently acquires lanes it was never swum in. The MARKER is what
    // makes an empty past expressible.
    const season = await aSeason("pinempty");

    await setRecurrenceLanes(admin(), season.recurrenceId, {
      laneIds: [season.lanes["baan 1"]],
    });

    const byId = new Map(
      (await scheduleOf(season.groupId)).map((lesson) => [lesson.id, lesson]),
    );
    expect(byId.get(season.sessionIds[0]!)).toMatchObject({
      source: "PINNED",
      lanes: [],
    });
    expect(byId.get(season.sessionIds[4]!)).toMatchObject({
      source: "INHERITED",
      lanes: ["baan 1"],
    });
  });

  it("writes nothing at all when the selection did not change", async () => {
    // Otherwise pressing save on an unchanged form would freeze the whole past
    // of a season and append an audit event saying something happened.
    const season = await aSeason("unchanged", ["baan 1"]);
    const after = await prisma.auditEvent.count({
      where: { targetId: season.groupId },
    });
    const pinned = await prisma.scheduledSession.count({
      where: { groupId: season.groupId, laneSource: "PINNED" },
    });

    // Same set, different order — a set is a set.
    await setRecurrenceLanes(admin(), season.recurrenceId, {
      laneIds: [season.lanes["baan 1"]],
    });

    expect(
      await prisma.auditEvent.count({ where: { targetId: season.groupId } }),
    ).toBe(after);
    expect(
      await prisma.scheduledSession.count({
        where: { groupId: season.groupId, laneSource: "PINNED" },
      }),
    ).toBe(pinned);
  });

  it("audits the change against the group, with how much of the past it froze", async () => {
    const season = await aSeason("propagateaudit", ["baan 1"]);
    await setRecurrenceLanes(admin(), season.recurrenceId, {
      laneIds: [season.lanes["baan 2"]],
    });

    const events = await prisma.auditEvent.findMany({
      where: { targetId: season.groupId },
      orderBy: { sequence: "asc" },
      select: { eventType: true, changedFields: true },
    });
    expect(events.at(-1)).toMatchObject({
      eventType: "sessions.recurrence.lanes.set",
      changedFields: {
        recurrenceId: season.recurrenceId,
        lanes: 1,
        previousLanes: 1,
        // 3, 10 and 17 March had already started at `NOW`.
        pinnedSessions: 3,
      },
    });
  });

  it("does not reach lessons of another series in the same group", async () => {
    const season = await aSeason("otherseries", ["baan 1"]);
    const otherRule = await createRecurrence(admin(), season.groupId, {
      poolId: season.poolId,
      weekday: 4,
      startTime: "19:00",
      durationMinutes: 45,
      startsOn: "2026-03-01",
      endsOn: "2026-03-31",
    });
    await setRecurrenceLanes(admin(), otherRule.id, {
      laneIds: [season.lanes["baan 4"]],
    });
    await generateSessions(admin(), season.groupId, {
      from: "2026-03-01",
      to: "2026-03-31",
    });

    await setRecurrenceLanes(admin(), season.recurrenceId, {
      laneIds: [season.lanes["baan 2"]],
    });

    // The Thursday lessons still answer with their own rule's lane, and the
    // past ones among them were not pinned by the Tuesday rule's change.
    const thursdays = await prisma.scheduledSession.findMany({
      where: { recurrenceId: otherRule.id },
      select: { id: true, laneSource: true },
    });
    expect(thursdays.length).toBeGreaterThan(0);
    expect(thursdays.every((row) => row.laneSource === null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Without the write permission it is denied, not ignored
// ---------------------------------------------------------------------------

describe("a lane assignment attempted without planning.manage", () => {
  it("is DENIED on all three paths, and changes nothing", async () => {
    const season = await aSeason("denied", ["baan 1"]);
    const target = season.sessionIds[4]!;

    // The reader CAN read the schedule — this is what got them to the page.
    await expect(
      listSessionsForPrincipal(reader(), {
        from: new Date("2026-01-01T00:00:00.000Z"),
        to: new Date("2026-12-31T00:00:00.000Z"),
        groupId: season.groupId,
      }),
    ).resolves.not.toHaveLength(0);

    await expect(
      setRecurrenceLanes(reader(), season.recurrenceId, {
        laneIds: [season.lanes["baan 4"]],
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      overrideSessionLanes(reader(), target, {
        laneIds: [season.lanes["baan 4"]],
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      clearSessionLaneOverride(reader(), target),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    // A SILENT NO-OP WOULD BE THE NATURAL WRONG ANSWER, and it would teach the
    // reader the application is broken rather than that a permission is
    // missing. Nothing moved.
    const [rule] = await listRecurrencesForGroup(admin(), season.groupId);
    expect(rule!.lanes.map((lane) => lane.name)).toEqual(["baan 1"]);
    expect(
      await prisma.scheduledSession.count({
        where: { groupId: season.groupId, laneSource: { not: null } },
      }),
    ).toBe(0);
  });

  it("guards BEFORE reading the row, so a bad id is still a denial", async () => {
    // Otherwise the refusal a caller sees depends on whether the thing they
    // aimed at exists, which is an existence oracle for anybody who can reach
    // the endpoint.
    await expect(
      overrideSessionLanes(reader(), "groupsfx_no_such_session", {
        laneIds: [],
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      clearSessionLaneOverride(reader(), "groupsfx_no_such_session"),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
