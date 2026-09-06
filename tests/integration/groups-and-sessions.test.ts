/**
 * The five properties the phase 1.6 definition of done names, proved against a
 * real Postgres with the REAL scope relations registered.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE FIVE AND NOT A CLICK-THROUGH
 *
 * Each one is a place where a plausible implementation is wrong in a way nothing
 * else notices:
 *
 *   1. **Generation is idempotent.** An "insert what is missing" generator looks
 *      identical until somebody runs it twice, and then the club has two of
 *      every lesson and no way to tell which is which.
 *   2. **Cancelling keeps the row.** A delete looks tidier and answers a
 *      parent's question wrongly, permanently.
 *   3. **A pupil moved DOWN has two membership rows.** An implementation that
 *      updated the row in place passes every screen and destroys the answer to
 *      "which group was this child in last March?".
 *   4. **An instructor whose assignment ended is DENIED, not shown an empty
 *      list.** The empty list is the natural implementation and it teaches the
 *      instructor that the application is broken.
 *   5. **A make-up guest is visible without an administrator granting
 *      anything.** Without session-derived reach the fix at 16:55 on a Tuesday
 *      is minting a grant on the highest-risk path in the application (D-179).
 *
 * NOTHING IS FAKED. `tests/support/groups-fixtures.ts` registers the real
 * `ScopeRelations` of `groups`, `sessions` and `people`, so these assertions are
 * about the queries that will run in production.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PermissionDeniedError } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import {
  assignInstructor,
  endInstructorAssignment,
  getGroupForPrincipal,
  getStudentGroupHistory,
  listGroupsForPrincipal,
  moveStudent,
  placeStudentInGroup,
} from "@/modules/groups";
import {
  addGuestToSession,
  cancelSession,
  createClosure,
  createRecurrence,
  generateSessions,
  getSessionForPrincipal,
  listSessionsForPrincipal,
} from "@/modules/sessions";

import {
  day,
  gid,
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

/** The whole suite evaluates at one instant, so nothing depends on wall time. */
const NOW = new Date("2026-06-01T12:00:00.000Z");

let adminId: string;
let adminRoleId: string;
let instructorRoleId: string;

function admin() {
  return { principal: { personId: adminId }, at: NOW };
}

beforeAll(() => {
  installRealRelations();
});

beforeEach(async () => {
  await resetGroupsFixtures();
  adminId = await makePerson("admin");
  adminRoleId = await makeRole("role_admin", GROUPS_ADMIN_PERMISSIONS);
  instructorRoleId = await makeRole("role_instructor", INSTRUCTOR_PERMISSIONS);
  await grantTo({
    personId: adminId,
    roleId: adminRoleId,
    scopeType: "ORGANIZATION",
  });
});

afterAll(async () => {
  await resetGroupsFixtures();
});

// ---------------------------------------------------------------------------
// 1. Generating a term
// ---------------------------------------------------------------------------

describe("generating a term from a recurrence", () => {
  async function groupWithTuesdayLessons(): Promise<string> {
    const groupId = await makeGroup("g_sched");
    const poolId = await makePool("pool");
    await createRecurrence(admin(), groupId, {
      poolId,
      weekday: 2,
      startTime: "18:00",
      durationMinutes: 45,
      startsOn: "2026-03-01",
      endsOn: null,
    });
    return groupId;
  }

  it("produces exactly the expected lessons", async () => {
    const groupId = await groupWithTuesdayLessons();

    const report = await generateSessions(admin(), groupId, {
      from: "2026-03-01",
      to: "2026-03-31",
    });

    expect(report.planned).toBe(5);
    expect(report.created).toBe(5);

    const rows = await prisma.scheduledSession.findMany({
      where: { groupId },
      orderBy: { occursOn: "asc" },
      select: { occursOn: true, startsAt: true, endsAt: true },
    });
    expect(rows.map((row) => row.occursOn.toISOString().slice(0, 10))).toEqual([
      "2026-03-03",
      "2026-03-10",
      "2026-03-17",
      "2026-03-24",
      "2026-03-31",
    ]);
    // A 45-minute lesson is 45 minutes long, including across the 29 March
    // change — the duration is added to the instant, never to a wall clock.
    for (const row of rows) {
      expect(row.endsAt.getTime() - row.startsAt.getTime()).toBe(45 * 60_000);
    }
  });

  it("skips a configured holiday and says which", async () => {
    const groupId = await groupWithTuesdayLessons();
    await createClosure(admin(), {
      groupId: null, // CLUB-WIDE, the ordinary case
      fromDate: "2026-03-09",
      toDate: "2026-03-15",
      reason: `${gid("")}voorjaarsvakantie`,
    });

    const report = await generateSessions(admin(), groupId, {
      from: "2026-03-01",
      to: "2026-03-31",
    });

    expect(report.created).toBe(4);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0].date).toBe("2026-03-10");
    expect(report.skipped[0].reason).toContain("voorjaarsvakantie");

    const dates = await prisma.scheduledSession.findMany({
      where: { groupId },
      select: { occursOn: true },
    });
    expect(
      dates.some((row) => row.occursOn.toISOString().startsWith("2026-03-10")),
    ).toBe(false);
  });

  it("IS IDEMPOTENT — running it twice does not double the schedule", async () => {
    const groupId = await groupWithTuesdayLessons();

    const first = await generateSessions(admin(), groupId, {
      from: "2026-03-01",
      to: "2026-03-31",
    });
    const second = await generateSessions(admin(), groupId, {
      from: "2026-03-01",
      to: "2026-03-31",
    });

    expect(first.created).toBe(5);
    // Not "5 again": the unique index on (recurrenceId, occursOn) means the
    // second run inserts nothing at all.
    expect(second.created).toBe(0);
    expect(second.planned).toBe(5);

    expect(await prisma.scheduledSession.count({ where: { groupId } })).toBe(5);
  });

  it("does not resurrect a cancelled lesson on a later run", async () => {
    // The case an "insert what is missing" implementation gets wrong: a
    // cancelled lesson LOOKS missing. The constraint sees it, so it is not.
    const groupId = await groupWithTuesdayLessons();
    await generateSessions(admin(), groupId, {
      from: "2026-03-01",
      to: "2026-03-31",
    });

    const lesson = await prisma.scheduledSession.findFirstOrThrow({
      where: { groupId, occursOn: day("2026-03-17") },
      select: { id: true },
    });
    await cancelSession(admin(), lesson.id, { reason: "bad in onderhoud" });

    const again = await generateSessions(admin(), groupId, {
      from: "2026-03-01",
      to: "2026-03-31",
    });

    expect(again.created).toBe(0);
    const after = await prisma.scheduledSession.findUniqueOrThrow({
      where: { id: lesson.id },
      select: { status: true },
    });
    expect(after.status).toBe("CANCELLED");
    expect(await prisma.scheduledSession.count({ where: { groupId } })).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 2. Cancelling an occurrence
// ---------------------------------------------------------------------------

describe("cancelling one occurrence", () => {
  it("KEEPS IT IN THE HISTORY rather than deleting it", async () => {
    const groupId = await makeGroup("g_cancel");
    await createRecurrence(admin(), groupId, {
      weekday: 2,
      startTime: "18:00",
      durationMinutes: 45,
      startsOn: "2026-03-01",
    });
    await generateSessions(admin(), groupId, {
      from: "2026-03-01",
      to: "2026-03-31",
    });

    const lesson = await prisma.scheduledSession.findFirstOrThrow({
      where: { groupId, occursOn: day("2026-03-17") },
      select: { id: true },
    });

    await cancelSession(admin(), lesson.id, {
      reason: "bad in onderhoud",
    });

    // THE ROW IS STILL THERE. "The lesson was called off" and "there was no
    // lesson" are different answers to the parent asking about a missed week.
    const row = await prisma.scheduledSession.findUnique({
      where: { id: lesson.id },
      select: { status: true, cancelledAt: true, cancellationReason: true },
    });
    expect(row).not.toBeNull();
    expect(row!.status).toBe("CANCELLED");
    expect(row!.cancellationReason).toBe("bad in onderhoud");
    expect(row!.cancelledAt).not.toBeNull();

    // And it is still in the schedule the screen renders, with its reason.
    const listed = await listSessionsForPrincipal(admin(), {
      from: new Date("2026-03-01T00:00:00Z"),
      to: new Date("2026-04-01T00:00:00Z"),
      groupId,
    });
    expect(listed).toHaveLength(5);
    const cancelled = listed.find((entry) => entry.id === lesson.id);
    expect(cancelled?.status).toBe("CANCELLED");
    expect(cancelled?.cancellationReason).toBe("bad in onderhoud");
  });

  it("refuses to cancel twice rather than overwriting the first reason", async () => {
    const groupId = await makeGroup("g_twice");
    await createRecurrence(admin(), groupId, {
      weekday: 2,
      startTime: "18:00",
      durationMinutes: 45,
      startsOn: "2026-03-01",
    });
    await generateSessions(admin(), groupId, {
      from: "2026-03-01",
      to: "2026-03-10",
    });
    const lesson = await prisma.scheduledSession.findFirstOrThrow({
      where: { groupId },
      select: { id: true },
    });

    await cancelSession(admin(), lesson.id, { reason: "eerste reden" });
    await expect(
      cancelSession(admin(), lesson.id, { reason: "tweede reden" }),
    ).rejects.toThrow(/already cancelled/i);

    const row = await prisma.scheduledSession.findUniqueOrThrow({
      where: { id: lesson.id },
      select: { cancellationReason: true },
    });
    expect(row.cancellationReason).toBe("eerste reden");
  });
});

// ---------------------------------------------------------------------------
// 3. Moving a pupil DOWN a level
// ---------------------------------------------------------------------------

describe("moving a pupil back down a level", () => {
  it("leaves TWO GroupMembership rows and loses no history", async () => {
    const higher = await makeGroup("g_higher");
    const lower = await makeGroup("g_lower");
    const { studentProfileId } = await makeStudent("pupil_down");

    await placeStudentInGroup(admin(), higher, {
      studentProfileId,
      fromDate: "2026-01-06",
      reason: "start van het blok",
    });

    await moveStudent(admin(), {
      studentProfileId,
      fromGroupId: higher,
      toGroupId: lower,
      direction: "DOWN",
      reason: "meer tijd nodig voor de schoolslagbeenslag",
      occurredAt: "2026-03-03",
    });

    const memberships = await prisma.groupMembership.findMany({
      where: { studentProfileId },
      orderBy: { fromDate: "asc" },
      select: { groupId: true, fromDate: true, toDate: true },
    });

    // TWO ROWS. The first was CLOSED, not deleted or updated in place — which is
    // what keeps "which group was this child in in February?" answerable.
    expect(memberships).toHaveLength(2);
    expect(memberships[0].groupId).toBe(higher);
    expect(memberships[0].toDate?.toISOString()).toBe(
      "2026-03-03T00:00:00.000Z",
    );
    expect(memberships[1].groupId).toBe(lower);
    expect(memberships[1].toDate).toBeNull();

    // The history still answers the question about the past.
    expect(memberships[0].fromDate.toISOString()).toBe(
      "2026-01-06T00:00:00.000Z",
    );

    const history = await getStudentGroupHistory(admin(), studentProfileId);
    expect(history.memberships).toHaveLength(2);
    // Two moves: the first placement, and the move down. Both are ordinary
    // history in one date-ordered list — there is no separate "corrections" view
    // and no flag a renderer could colour on.
    expect(history.moves).toHaveLength(2);
    const down = history.moves[1];
    expect(down.direction).toBe("DOWN");
    expect(down.reason).toBe("meer tijd nodig voor de schoolslagbeenslag");
    expect(down.fromGroupName).toContain("g_higher");
    expect(down.decidedBy).not.toBeNull();
  });

  it("records a move UP through exactly the same path", async () => {
    // The symmetry D-108 requires, asserted rather than assumed: same service,
    // same required reason, same row shape, same audit event type. If somebody
    // adds a convenience helper for "the common case", this goes red.
    const lower = await makeGroup("g_low2");
    const higher = await makeGroup("g_high2");
    const { studentProfileId } = await makeStudent("pupil_up");

    await placeStudentInGroup(admin(), lower, {
      studentProfileId,
      fromDate: "2026-01-06",
      reason: "start van het blok",
    });
    await moveStudent(admin(), {
      studentProfileId,
      fromGroupId: lower,
      toGroupId: higher,
      direction: "UP",
      reason: "schoolslag zit goed",
      occurredAt: "2026-03-03",
    });

    const [up] = await prisma.groupMove.findMany({
      where: { studentProfileId, direction: "UP" },
      select: { reason: true, occurredAt: true, decidedByPersonId: true },
    });
    const [down] = await prisma.groupMove.findMany({
      where: { studentProfileId, direction: "LATERAL" },
      select: { reason: true, decidedByPersonId: true },
    });

    expect(up.reason).toBe("schoolslag zit goed");
    expect(up.decidedByPersonId).toBe(adminId);
    expect(down.decidedByPersonId).toBe(adminId);

    // ONE audit event type for every direction. A `.demoted` beside a
    // `.promoted` would make a move down separately searchable and separately
    // alertable, which is the asymmetry D-108 refuses.
    const events = await prisma.auditEvent.findMany({
      where: { eventType: { startsWith: "groups.membership." } },
      select: { eventType: true },
    });
    expect(new Set(events.map((event) => event.eventType))).toEqual(
      new Set(["groups.membership.placed", "groups.membership.moved"]),
    );
  });

  it("refuses a move with no reason, in either direction", async () => {
    const from = await makeGroup("g_from3");
    const to = await makeGroup("g_to3");
    const { studentProfileId } = await makeStudent("pupil_noreason");
    await placeStudentInGroup(admin(), from, {
      studentProfileId,
      fromDate: "2026-01-06",
      reason: "start",
    });

    for (const direction of ["UP", "DOWN"] as const) {
      await expect(
        moveStudent(admin(), {
          studentProfileId,
          fromGroupId: from,
          toGroupId: to,
          direction,
          reason: "   ",
          occurredAt: "2026-03-03",
        }),
      ).rejects.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. An instructor whose assignment has ended
// ---------------------------------------------------------------------------

describe("an instructor whose assignment has ended", () => {
  it("CANNOT read the group's pupils, and the refusal is a DENIAL", async () => {
    const groupId = await makeGroup("g_taught");
    const instructorId = await makePerson("instructor");
    const { studentProfileId } = await makeStudent("pupil_taught");

    await placeStudentInGroup(admin(), groupId, {
      studentProfileId,
      fromDate: "2026-01-06",
      reason: "start van het blok",
    });

    // The GRANT — a GROUP-scoped role assignment. It is never revoked in this
    // test; only the teaching assignment ends. That is the point of D-145 rule 1.
    await grantTo({
      personId: instructorId,
      roleId: instructorRoleId,
      scopeType: "GROUP",
      scopeId: groupId,
    });
    await assignInstructor(admin(), groupId, {
      personId: instructorId,
      fromDate: "2026-01-06",
    });

    const instructor = { principal: { personId: instructorId }, at: NOW };

    // WHILE ASSIGNED: they see the group and its pupils.
    const before = await getGroupForPrincipal(instructor, groupId);
    expect(before?.members.map((member) => member.studentProfileId)).toEqual([
      studentProfileId,
    ]);
    expect(await listGroupsForPrincipal(instructor)).toHaveLength(1);

    // The assignment ends. The GRANT is untouched.
    await endInstructorAssignment(admin(), groupId, {
      personId: instructorId,
      toDate: "2026-05-01",
    });
    expect(
      await prisma.roleAssignment.count({
        where: { personId: instructorId, scopeId: groupId },
      }),
    ).toBe(1);

    // A DENIAL, NOT AN EMPTY LIST. This is the assertion the definition of done
    // names: an empty list would tell the instructor the application is broken,
    // when what happened is that they are no longer the person who may read it.
    await expect(
      getGroupForPrincipal(instructor, groupId),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(listGroupsForPrincipal(instructor)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("loses the group's schedule too, on the same query", async () => {
    // The session filter reads the same reach, so there is no window in which
    // the group is denied and its lessons are not.
    const groupId = await makeGroup("g_sched2");
    const instructorId = await makePerson("instructor2");
    await createRecurrence(admin(), groupId, {
      weekday: 2,
      startTime: "18:00",
      durationMinutes: 45,
      startsOn: "2026-03-01",
    });
    await generateSessions(admin(), groupId, {
      from: "2026-03-01",
      to: "2026-03-31",
    });

    await grantTo({
      personId: instructorId,
      roleId: instructorRoleId,
      scopeType: "GROUP",
      scopeId: groupId,
    });
    await assignInstructor(admin(), groupId, {
      personId: instructorId,
      fromDate: "2026-01-06",
    });

    const instructor = { principal: { personId: instructorId }, at: NOW };
    const window = {
      from: new Date("2026-03-01T00:00:00Z"),
      to: new Date("2026-04-01T00:00:00Z"),
    };
    expect(await listSessionsForPrincipal(instructor, window)).toHaveLength(5);

    await endInstructorAssignment(admin(), groupId, {
      personId: instructorId,
      toDate: "2026-05-01",
    });

    await expect(
      listSessionsForPrincipal(instructor, window),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("keeps the assignment row, so 'who taught this group' still has an answer", async () => {
    const groupId = await makeGroup("g_hist");
    const instructorId = await makePerson("instructor3");
    await assignInstructor(admin(), groupId, {
      personId: instructorId,
      role: "hoofdinstructeur",
      fromDate: "2026-01-06",
    });
    await endInstructorAssignment(admin(), groupId, {
      personId: instructorId,
      toDate: "2026-05-01",
    });

    const rows = await prisma.instructorAssignment.findMany({
      where: { groupId },
      select: { personId: true, role: true, fromDate: true, toDate: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].toDate?.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(rows[0].role).toBe("hoofdinstructeur");
  });
});

// ---------------------------------------------------------------------------
// 5. The make-up guest
// ---------------------------------------------------------------------------

describe("a make-up guest (inhaalles, D-179)", () => {
  it("is visible to the receiving instructor with NO administrator granting anything", async () => {
    // The setup: a pupil enrolled in one group attends one lesson of another.
    const homeGroup = await makeGroup("g_home");
    const receivingGroup = await makeGroup("g_receiving");
    const receivingInstructorId = await makePerson("receiving_instructor");
    const { studentProfileId: guestId } = await makeStudent("guest_pupil");

    await placeStudentInGroup(admin(), homeGroup, {
      studentProfileId: guestId,
      fromDate: "2026-01-06",
      reason: "start van het blok",
    });

    await createRecurrence(admin(), receivingGroup, {
      weekday: 2,
      startTime: "18:00",
      durationMinutes: 45,
      startsOn: "2026-03-01",
    });
    await generateSessions(admin(), receivingGroup, {
      from: "2026-03-01",
      to: "2026-03-31",
    });
    const lesson = await prisma.scheduledSession.findFirstOrThrow({
      where: { groupId: receivingGroup },
      orderBy: { occursOn: "asc" },
      select: { id: true },
    });

    // The receiving instructor holds a GROUP grant over their own group and a
    // GROUP-scoped InstructorAssignment. NOTHING about the guest.
    await grantTo({
      personId: receivingInstructorId,
      roleId: instructorRoleId,
      scopeType: "GROUP",
      scopeId: receivingGroup,
    });
    await assignInstructor(admin(), receivingGroup, {
      personId: receivingInstructorId,
      fromDate: "2026-01-06",
    });

    const instructor = {
      principal: { personId: receivingInstructorId },
      at: NOW,
    };

    // BEFORE: the child is not on the roster, so they are not there.
    const emptyRoster = await getSessionForPrincipal(instructor, lesson.id);
    expect(emptyRoster?.roster).toHaveLength(0);

    // The ONLY act: one roster row. No grant is minted, no membership is
    // written, no permission is changed.
    const grantsBefore = await prisma.roleAssignment.count();
    await addGuestToSession(admin(), lesson.id, {
      studentProfileId: guestId,
      reason: "inhaalles, les van 5 maart gemist",
    });
    expect(await prisma.roleAssignment.count()).toBe(grantsBefore);

    // AFTER: the instructor standing at the poolside can see the child in front
    // of them — through participation in the session, never through group
    // membership, which the guest does not have.
    const roster = await getSessionForPrincipal(instructor, lesson.id);
    const guest = roster?.roster.find(
      (member) => member.studentProfileId === guestId,
    );
    expect(guest).toBeDefined();
    expect(guest!.source).toBe("GUEST");
    expect(guest!.reason).toBe("inhaalles, les van 5 maart gemist");

    // And they are still NOT in the receiving group.
    expect(
      await prisma.groupMembership.count({
        where: { groupId: receivingGroup, studentProfileId: guestId },
      }),
    ).toBe(0);
  });

  it("does not consume a place in a full group", async () => {
    // The reading recorded in `docs/glossary.md`: capacity counts places in the
    // GROUP, and a guest is not in the group (D-179). A full group can still
    // take a make-up lesson, which is the point of a make-up lesson.
    const full = await makeGroup("g_full", { capacity: 1 });
    const { studentProfileId: memberId } = await makeStudent("member");
    const { studentProfileId: guestId } = await makeStudent("guest2");

    await placeStudentInGroup(admin(), full, {
      studentProfileId: memberId,
      fromDate: "2026-01-06",
      reason: "start",
    });

    await createRecurrence(admin(), full, {
      weekday: 2,
      startTime: "18:00",
      durationMinutes: 45,
      startsOn: "2026-03-01",
    });
    await generateSessions(admin(), full, {
      from: "2026-03-01",
      to: "2026-03-10",
    });
    const lesson = await prisma.scheduledSession.findFirstOrThrow({
      where: { groupId: full },
      select: { id: true },
    });

    // The group refuses another PLACEMENT…
    await expect(
      placeStudentInGroup(admin(), full, {
        studentProfileId: guestId,
        fromDate: "2026-03-03",
        reason: "erbij",
      }),
    ).rejects.toThrow(/already has/i);

    // …and still accepts a GUEST for one lesson.
    await expect(
      addGuestToSession(admin(), lesson.id, {
        studentProfileId: guestId,
        reason: "inhaalles",
      }),
    ).resolves.toBeDefined();
  });
});
