/**
 * The four properties phase 1.7's definition of done names, against a real
 * Postgres, through the real services.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE FOUR
 *
 * The defect this phase fixes is not "one missing button". It is that a screen
 * which creates something must let you correct it, and the application had
 * shipped several that did not — a pool could be created and never renamed, a
 * lane could not be created at all. Each assertion below is a place where a
 * plausible fix is wrong in a way nothing else notices:
 *
 *   1. **A rename persists AND is audited.** An update that writes the row and
 *      forgets the event passes every screen and leaves no answer to "who
 *      changed the name of this pool" — the one control that makes an in-place
 *      correction acceptable at all (`CLAUDE.md` rule 2).
 *   2. **A lane reaches the surface a lesson is planned on.** `createLane` has
 *      existed since phase 1.6 and no screen called it; a fix that adds the
 *      form and stops there leaves the lane visible on exactly one page and
 *      invisible where it is used, which is the same defect one layer up.
 *   3. **An edit without the write permission is DENIED, not ignored.** An edit
 *      form is a write surface. The page renders on `planning.read`, so an
 *      implementation that trusts the check which got the caller to the page
 *      lets a reader rename the club's facilities — and the natural wrong
 *      alternative, silently doing nothing, teaches them the application is
 *      broken instead of telling them a permission is missing.
 *   4. **A correction under an append-only rule appends.** The distinction this
 *      phase draws is per attribute: a pool's name is corrected in place
 *      because no earlier state is evidence, and a pupil's lifecycle is
 *      corrected by a NEW event because the earlier one is (`CLAUDE.md` rule 4,
 *      D-059). A change that generalised "make it editable" across both would
 *      pass 1 to 3 and destroy history.
 *
 * NOTHING IS FAKED. `groups-fixtures.ts` registers the real `ScopeRelations` of
 * all three modules, so the denial in 3 is the check that runs in production.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PermissionDeniedError } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { currentLifecycleState, recordLifecycleEvent } from "@/modules/people";
import {
  createClosure,
  createLane,
  createPool,
  createRecurrence,
  FacilityError,
  generateSessions,
  listClosuresForGroup,
  listPoolsForPrincipal,
  updateClosure,
  updateLane,
  updatePool,
} from "@/modules/sessions";

import { poolOptionLabel } from "@/app/groups/format";

import {
  grantTo,
  GROUPS_ADMIN_PERMISSIONS,
  INSTRUCTOR_PERMISSIONS,
  installRealRelations,
  makeGroup,
  makePerson,
  makePool,
  makeRole,
  makeStudent,
  resetGroupsFixtures,
} from "../support/groups-fixtures";

/** One instant for the whole suite, so nothing depends on wall time. */
const NOW = new Date("2026-09-06T10:00:00.000Z");

let adminId: string;
/** Holds `planning.read` and NOT `planning.manage` — the reader in proof 3. */
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
 * The pools these tests make come from `createPool`, so they carry a generated
 * id rather than the fixture prefix `resetGroupsFixtures` cleans by — and
 * `Pool.name` is unique, so one survivor fails the next run with a duplicate
 * name. Both tables are club configuration with no personal data in them, the
 * node project runs test FILES serially, and every suite that makes a pool
 * makes a prefixed one it cleans up itself. So: empty them.
 */
async function clearFacilities(): Promise<void> {
  await prisma.lane.deleteMany({});
  await prisma.pool.deleteMany({});
}

beforeEach(async () => {
  await resetGroupsFixtures();
  await clearFacilities();

  adminId = await makePerson("fac_admin");
  await grantTo({
    personId: adminId,
    roleId: await makeRole("role_fac_admin", [
      ...GROUPS_ADMIN_PERMISSIONS,
      // `recordLifecycleEvent` guards on this; the groups admin set has no
      // reason to carry it, so proof 4 asks for it by name.
      "students.update",
    ]),
    scopeType: "ORGANIZATION",
  });

  readerId = await makePerson("fac_reader");
  await grantTo({
    personId: readerId,
    // `INSTRUCTOR_PERMISSIONS` already is the shape under test: `planning.read`
    // without `planning.manage`. Using it rather than a bespoke list keeps the
    // proof about a role the club actually hands out.
    roleId: await makeRole("role_fac_reader", [...INSTRUCTOR_PERMISSIONS]),
    scopeType: "ORGANIZATION",
  });
});

afterAll(async () => {
  await resetGroupsFixtures();
  await clearFacilities();
});

/** Every audit event about one target, oldest first. */
async function auditFor(targetId: string) {
  return prisma.auditEvent.findMany({
    where: { targetId },
    orderBy: { sequence: "asc" },
    select: {
      eventType: true,
      outcome: true,
      actorPersonId: true,
      targetType: true,
      changedFields: true,
    },
  });
}

// ---------------------------------------------------------------------------
// 1. A pool rename persists and is audited
// ---------------------------------------------------------------------------

describe("correcting a pool", () => {
  it("persists the new name and length, and records who changed what", async () => {
    const { id } = await createPool(admin(), {
      name: "Instructiebda",
      lengthMetres: 20,
    });

    await updatePool(admin(), id, { name: "Instructiebad", lengthMetres: 25 });

    const after = await prisma.pool.findUniqueOrThrow({
      where: { id },
      select: { name: true, lengthMetres: true, active: true },
    });
    expect(after).toEqual({
      name: "Instructiebad",
      lengthMetres: 25,
      active: true,
    });

    const events = await auditFor(id);
    expect(events.map((event) => event.eventType)).toEqual([
      "sessions.pool.created",
      "sessions.pool.updated",
    ]);
    expect(events[1]).toMatchObject({
      outcome: "SUCCESS",
      actorPersonId: adminId,
      targetType: "pool",
      // Field NAMES and never values: the trail says the name changed, not
      // what it changed to.
      changedFields: { fields: "name,lengthMetres" },
    });
  });

  it("records only the fields that actually changed", async () => {
    const { id } = await createPool(admin(), { name: "Wedstrijdbad" });

    await updatePool(admin(), id, {
      name: "Wedstrijdbad",
      lengthMetres: 25,
    });

    const events = await auditFor(id);
    expect(events[1]?.changedFields).toEqual({ fields: "lengthMetres" });
  });

  it("writes nothing at all when nothing changed", async () => {
    // An audit trail with an entry for every save — including the ones that
    // changed nothing — is one nobody reads.
    const { id } = await createPool(admin(), {
      name: "Buitenbad",
      lengthMetres: 50,
    });

    await updatePool(admin(), id, { name: "Buitenbad", lengthMetres: 50 });

    expect(await auditFor(id)).toHaveLength(1);
  });

  it("refuses a rename onto a name that exists, as a refusal and not a 500", async () => {
    await createPool(admin(), { name: "Instructiebad" });
    const { id } = await createPool(admin(), { name: "Wedstrijdbad" });

    await expect(
      updatePool(admin(), id, { name: "Instructiebad" }),
    ).rejects.toBeInstanceOf(FacilityError);
  });
});

// ---------------------------------------------------------------------------
// 2. A lane can be added, and appears where lessons are planned
// ---------------------------------------------------------------------------

describe("adding a lane to an existing pool", () => {
  it("appears in that pool's schedule options", async () => {
    const { id } = await createPool(admin(), {
      name: "Instructiebad",
      lengthMetres: 25,
    });

    await createLane(admin(), id, { name: "baan 1", sequence: 0 });
    await createLane(admin(), id, { name: "baan 2", sequence: 1 });

    // The list the schedule screen builds its pool `<select>` from, through the
    // guarded service — not a direct table read.
    const pools = await listPoolsForPrincipal(admin());
    const pool = pools.find((candidate) => candidate.id === id)!;

    expect(pool.lanes.map((lane) => lane.name)).toEqual(["baan 1", "baan 2"]);
    expect(poolOptionLabel(pool)).toBe("Instructiebad — baan 1, baan 2");
  });

  it("audits the addition against the pool", async () => {
    const { id } = await createPool(admin(), { name: "Instructiebad" });
    const lane = await createLane(admin(), id, { name: "ondiep" });

    const events = await auditFor(id);
    expect(events.map((event) => event.eventType)).toEqual([
      "sessions.pool.created",
      "sessions.lane.created",
    ]);
    expect(events[1]?.changedFields).toMatchObject({ laneId: lane.id });
  });

  it("lets a lane be corrected, and audits it against the pool", async () => {
    const { id } = await createPool(admin(), { name: "Instructiebad" });
    const lane = await createLane(admin(), id, { name: "baan 1" });

    await updateLane(admin(), lane.id, { name: "ondiepe baan" });

    const pools = await listPoolsForPrincipal(admin());
    expect(pools.find((candidate) => candidate.id === id)!.lanes[0]?.name).toBe(
      "ondiepe baan",
    );

    const events = await auditFor(id);
    expect(events.at(-1)).toMatchObject({
      eventType: "sessions.lane.updated",
      targetType: "pool",
      changedFields: { laneId: lane.id, fields: "name" },
    });
  });

  it("refuses two lanes with the same name in one pool", async () => {
    const { id } = await createPool(admin(), { name: "Instructiebad" });
    await createLane(admin(), id, { name: "baan 1" });

    await expect(
      createLane(admin(), id, { name: "baan 1" }),
    ).rejects.toBeInstanceOf(FacilityError);
  });
});

// ---------------------------------------------------------------------------
// 3. An edit without the write permission is denied, not ignored
// ---------------------------------------------------------------------------

describe("an edit attempted without planning.manage", () => {
  it("is DENIED rather than silently doing nothing", async () => {
    const { id } = await createPool(admin(), {
      name: "Instructiebad",
      lengthMetres: 25,
    });

    // The reader can READ the facilities — this is what got them to the page.
    await expect(listPoolsForPrincipal(reader())).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id })]),
    );

    // And is refused the write, by name. A silent no-op would be the natural
    // wrong answer and would teach them the application is broken.
    await expect(
      updatePool(reader(), id, { name: "Gekaapt bad" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    expect((await prisma.pool.findUniqueOrThrow({ where: { id } })).name).toBe(
      "Instructiebad",
    );
  });

  it("refuses the same caller a new lane and a lane correction", async () => {
    const { id } = await createPool(admin(), { name: "Instructiebad" });
    const lane = await createLane(admin(), id, { name: "baan 1" });

    await expect(
      createLane(reader(), id, { name: "baan 2" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(
      updateLane(reader(), lane.id, { name: "baan 9" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    const pools = await listPoolsForPrincipal(admin());
    expect(
      pools.find((candidate) => candidate.id === id)!.lanes.map((l) => l.name),
    ).toEqual(["baan 1"]);
  });

  it("guards the write BEFORE it reads the row, so a bad id is still a denial", async () => {
    // Otherwise the refusal a caller sees depends on whether the thing they
    // aimed at exists, which is an existence oracle for anybody who can reach
    // the endpoint.
    await expect(
      updatePool(reader(), "groupsfx_no_such_pool", { name: "x" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

// ---------------------------------------------------------------------------
// The same class, swept: a closure had no repair path either
// ---------------------------------------------------------------------------

describe("correcting a closure", () => {
  it("moves the dates, audits them, and leaves generated lessons alone", async () => {
    const groupId = await makeGroup("closure_group");
    const poolId = await makePool("closure_pool");
    await createRecurrence(admin(), groupId, {
      poolId,
      weekday: 2,
      startTime: "18:00",
      durationMinutes: 45,
      startsOn: "2026-03-03",
      endsOn: "2026-03-31",
    });
    const generated = await generateSessions(admin(), groupId, {
      from: "2026-03-01",
      to: "2026-03-31",
    });

    // Typed with the wrong MONTH, which is how this goes wrong in practice.
    const closure = await createClosure(admin(), {
      groupId,
      fromDate: "2026-04-10",
      toDate: "2026-04-17",
      reason: "voorjaarsvakantie",
    });

    await updateClosure(admin(), closure.id, {
      fromDate: "2026-03-10",
      toDate: "2026-03-17",
      reason: "voorjaarsvakantie",
    });

    const closures = await listClosuresForGroup(admin(), groupId);
    expect(closures[0]).toMatchObject({
      fromDate: new Date("2026-03-10T00:00:00.000Z"),
      toDate: new Date("2026-03-17T00:00:00.000Z"),
    });

    // The lessons the club already has are untouched: a closure suppresses
    // GENERATION and never reaches back into a timetable.
    expect(await prisma.scheduledSession.count({ where: { groupId } })).toBe(
      generated.created,
    );

    const events = await auditFor(groupId);
    expect(events.at(-1)).toMatchObject({
      eventType: "sessions.closure.updated",
      changedFields: { closureId: closure.id, fields: "fromDate,toDate" },
    });
  });

  it("is denied to a caller without planning.manage", async () => {
    const groupId = await makeGroup("closure_denied");
    const closure = await createClosure(admin(), {
      groupId,
      fromDate: "2026-03-10",
      toDate: "2026-03-17",
      reason: "kerstvakantie",
    });

    await expect(
      updateClosure(reader(), closure.id, {
        fromDate: "2026-01-01",
        toDate: "2026-12-31",
        reason: "het hele jaar dicht",
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

// ---------------------------------------------------------------------------
// 4. A correction under an append-only rule appends
// ---------------------------------------------------------------------------

describe("correcting something the append-only rules govern", () => {
  it("writes a superseding event and leaves the first row untouched", async () => {
    const { studentProfileId } = await makeStudent("corrected_pupil");

    // Recorded as having LEFT — and it was somebody else who left.
    await recordLifecycleEvent(admin(), studentProfileId, {
      type: "LEFT",
      occurredAt: "2026-09-01",
      reason: "vertrokken",
    });
    const [first] = await prisma.studentLifecycleEvent.findMany({
      where: { studentProfileId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    });

    // The correction. `CLAUDE.md` rule 4 and D-059: a new event, never an
    // update — the module exports no path that could mutate the first one.
    await recordLifecycleEvent(admin(), studentProfileId, {
      type: "RETURNED",
      occurredAt: "2026-09-02",
      reason: "onterecht afgemeld",
    });

    const events = await prisma.studentLifecycleEvent.findMany({
      where: { studentProfileId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      select: { id: true, type: true, occurredAt: true },
    });

    // TWO rows, and the first is byte-for-byte what it was: the club's account
    // of its own week survives the correction, which is the whole point.
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ id: first!.id, type: "LEFT" });
    expect(events[0]!.occurredAt).toEqual(first!.occurredAt);
    expect(events[1]!.type).toBe("RETURNED");

    // And the derived state follows the newer event rather than the older row.
    expect(currentLifecycleState(events, NOW)).toBe("ACTIVE");
    expect(
      currentLifecycleState(events, new Date("2026-09-01T12:00:00.000Z")),
    ).toBe("LEFT");
  });

  it("has no update path to reach for in the first place", async () => {
    // The strongest form of the guarantee is that the capability does not
    // exist: `people/index.ts` exports no way to update or delete a lifecycle
    // event, so no screen can grow one by accident.
    const peopleModule = await import("@/modules/people");
    expect(
      Object.keys(peopleModule).filter((name) =>
        /^(update|delete|remove)LifecycleEvent$/.test(name),
      ),
    ).toEqual([]);
  });
});
