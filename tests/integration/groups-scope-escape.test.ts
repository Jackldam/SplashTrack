/**
 * The per-module scope-escape suite `06-delivery.md` §2.1 requires, for `groups`
 * and `sessions`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT HAS TO PROVE THAT `coversResource` ALONE DOES NOT
 *
 * §2.1 is specific: the suite must assert on the **fields returned**, not only
 * on whether a row was reachable. `covers-resource.ts` says so from the other
 * side — *"a green `coversResource` is necessary and not sufficient"* — because
 * D-145 rule 2 makes coverage per RELATION: a `GROUP`-scoped instructor gets
 * *that group's* records and not the pupil's other ones.
 *
 * And §2.1 makes the LIST case the one that must never be dropped: a list query
 * silently returning too much is the exact failure tenancy filtering had, one
 * level down (F-15). So every filter branch is checked against the predicate it
 * mirrors, on the same rows, rather than trusted to have been written to match.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SESSION WINDOW IS A REAL PREDICATE, NOT A LABEL
 *
 * §2.1 requires the escape test to assert refusal *"outside the session … AND
 * outside its time window"*. Both are here: a `SESSION` grant reaches its one
 * lesson inside the window and nothing at all outside it — not even that lesson.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  coversResource,
  PermissionDeniedError,
  resolveReach,
} from "@/lib/authorization";
import { prisma } from "@/lib/database";
import {
  assignInstructor,
  getGroupForPrincipal,
  groupFilterForReach,
  listGroupsForPrincipal,
  moveStudent,
  placeStudentInGroup,
} from "@/modules/groups";
import {
  addGuestToSession,
  createRecurrence,
  generateSessions,
  getSessionForPrincipal,
  listSessionsForPrincipal,
  sessionFilterForReach,
} from "@/modules/sessions";

import {
  grantTo,
  GROUPS_ADMIN_PERMISSIONS,
  INSTRUCTOR_PERMISSIONS,
  installRealRelations,
  makeGroup,
  makePerson,
  makeRole,
  makeStudent,
  resetGroupsFixtures,
} from "../support/groups-fixtures";

const NOW = new Date("2026-06-01T12:00:00.000Z");

let adminId: string;
let instructorRoleId: string;

function admin() {
  return { principal: { personId: adminId }, at: NOW };
}

beforeAll(() => {
  installRealRelations();
});

beforeEach(async () => {
  await resetGroupsFixtures();
  adminId = await makePerson("esc_admin");
  const adminRoleId = await makeRole(
    "esc_role_admin",
    GROUPS_ADMIN_PERMISSIONS,
  );
  instructorRoleId = await makeRole(
    "esc_role_instructor",
    INSTRUCTOR_PERMISSIONS,
  );
  await grantTo({
    personId: adminId,
    roleId: adminRoleId,
    scopeType: "ORGANIZATION",
  });
});

afterAll(async () => {
  await resetGroupsFixtures();
});

describe("a GROUP-scoped instructor", () => {
  it("sees their own group and NOT the one next door", async () => {
    const mine = await makeGroup("esc_mine");
    const theirs = await makeGroup("esc_theirs");
    const instructorId = await makePerson("esc_instructor");
    const { studentProfileId: myPupil } = await makeStudent("esc_my_pupil");
    const { studentProfileId: theirPupil } =
      await makeStudent("esc_their_pupil");

    await placeStudentInGroup(admin(), mine, {
      studentProfileId: myPupil,
      fromDate: "2026-01-06",
      reason: "start",
    });
    await placeStudentInGroup(admin(), theirs, {
      studentProfileId: theirPupil,
      fromDate: "2026-01-06",
      reason: "start",
    });

    await grantTo({
      personId: instructorId,
      roleId: instructorRoleId,
      scopeType: "GROUP",
      scopeId: mine,
    });
    await assignInstructor(admin(), mine, {
      personId: instructorId,
      fromDate: "2026-01-06",
    });

    const instructor = { principal: { personId: instructorId }, at: NOW };

    // THE LIST returns exactly one group — not the other one, and not an error.
    const listed = await listGroupsForPrincipal(instructor);
    expect(listed.map((group) => group.id)).toEqual([mine]);

    // THE PER-ROW READ agrees with the list, in both directions. A group that
    // appears in a list and fails its own detail page is a defect; the reverse
    // is the dangerous one.
    await expect(
      getGroupForPrincipal(instructor, theirs),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect((await getGroupForPrincipal(instructor, mine))?.id).toBe(mine);
  });

  it("returns only THEIR group's pupils in the fields it renders (D-145 rule 2)", async () => {
    // The FIELD-LEVEL half §2.1 asks for. A pupil in two groups must appear in
    // the instructor's group with that group's membership and nothing about the
    // other one — coverage is per relation, not per entity.
    const mine = await makeGroup("esc_f_mine");
    const other = await makeGroup("esc_f_other");
    const instructorId = await makePerson("esc_f_instructor");
    const { studentProfileId } = await makeStudent("esc_f_pupil");

    await placeStudentInGroup(admin(), mine, {
      studentProfileId,
      fromDate: "2026-01-06",
      reason: "start",
    });
    await placeStudentInGroup(admin(), other, {
      studentProfileId,
      fromDate: "2026-02-06",
      reason: "ook wedstrijdgroep",
    });

    await grantTo({
      personId: instructorId,
      roleId: instructorRoleId,
      scopeType: "GROUP",
      scopeId: mine,
    });
    await assignInstructor(admin(), mine, {
      personId: instructorId,
      fromDate: "2026-01-06",
    });

    const detail = await getGroupForPrincipal(
      { principal: { personId: instructorId }, at: NOW },
      mine,
    );

    const member = detail!.members.find(
      (candidate) => candidate.studentProfileId === studentProfileId,
    );
    expect(member).toBeDefined();
    // THIS group's membership dates, and no field naming the other group.
    expect(member!.fromDate.toISOString()).toBe("2026-01-06T00:00:00.000Z");
    expect(JSON.stringify(detail)).not.toContain(other);
  });

  it("reads a pupil's history NARROWED to their own group, not all of it", async () => {
    /**
     * THE REGRESSION THIS PINS. `getStudentGroupHistory` guards on
     * `{ student }`, and a `GROUP` grant DOES cover that reference for a pupil
     * in the group — so the guard passed and the first implementation returned
     * every group the child had ever been in, by name, with dates.
     *
     * D-145 rule 2: coverage is per RELATION, and a group grant returns *that
     * group's* records. The narrowing is in the query now, and this is the
     * assertion that keeps it there.
     */
    const mine = await makeGroup("esc_h_mine");
    const elsewhere = await makeGroup("esc_h_elsewhere");
    const instructorId = await makePerson("esc_h_instructor");
    const { studentProfileId } = await makeStudent("esc_h_pupil");

    await placeStudentInGroup(admin(), mine, {
      studentProfileId,
      fromDate: "2026-01-06",
      reason: "start",
    });
    // The same child is also in a group this instructor has nothing to do with.
    await placeStudentInGroup(admin(), elsewhere, {
      studentProfileId,
      fromDate: "2026-02-06",
      reason: "ook wedstrijdgroep",
    });

    await grantTo({
      personId: instructorId,
      roleId: instructorRoleId,
      scopeType: "GROUP",
      scopeId: mine,
    });
    await assignInstructor(admin(), mine, {
      personId: instructorId,
      fromDate: "2026-01-06",
    });

    const { getStudentGroupHistory } = await import("@/modules/groups");
    const instructor = { principal: { personId: instructorId }, at: NOW };
    const history = await getStudentGroupHistory(instructor, studentProfileId);

    // ONLY their own group's placement.
    expect(history.memberships.map((entry) => entry.groupId)).toEqual([mine]);
    // The other group's NAME never appears anywhere in the payload.
    expect(JSON.stringify(history)).not.toContain("esc_h_elsewhere");

    // An administrator sees both, so the narrowing above is the reach and not
    // an empty fixture.
    const full = await getStudentGroupHistory(admin(), studentProfileId);
    expect(full.memberships.map((entry) => entry.groupId).sort()).toEqual(
      [mine, elsewhere].sort(),
    );
  });

  it("says a group name was WITHHELD rather than rendering it as absent", async () => {
    // A move out of the caller's group is still their record — dropping it would
    // make the child appear to vanish from the history with no explanation. What
    // is withheld is the other group's name, and the entry says so, because a
    // blank `fromGroupName` already means "this was a first placement".
    const mine = await makeGroup("esc_w_mine");
    const elsewhere = await makeGroup("esc_w_elsewhere");
    const instructorId = await makePerson("esc_w_instructor");
    const { studentProfileId } = await makeStudent("esc_w_pupil");

    // The pupil arrives IN this instructor's group from another one. They are
    // still a current member, so D-145 rule 1 is satisfied and the question is
    // purely what the history may say — which is the point of this test.
    //
    // (Moving them the other way would be denied outright, and correctly: a
    // lapsed membership grants nothing, so an instructor cannot read the history
    // of a child who has left them. That is rule 1, and it is asserted in
    // `groups-and-sessions.test.ts`.)
    await placeStudentInGroup(admin(), elsewhere, {
      studentProfileId,
      fromDate: "2026-01-06",
      reason: "start",
    });
    await moveStudent(admin(), {
      studentProfileId,
      fromGroupId: elsewhere,
      toGroupId: mine,
      direction: "DOWN",
      reason: "meer tijd nodig voor de schoolslagbeenslag",
      occurredAt: "2026-03-03",
    });

    await grantTo({
      personId: instructorId,
      roleId: instructorRoleId,
      scopeType: "GROUP",
      scopeId: mine,
    });
    await assignInstructor(admin(), mine, {
      personId: instructorId,
      fromDate: "2026-01-06",
    });

    const { getStudentGroupHistory } = await import("@/modules/groups");
    const history = await getStudentGroupHistory(
      { principal: { personId: instructorId }, at: NOW },
      studentProfileId,
    );

    const move = history.moves.find((entry) => entry.direction === "DOWN");
    expect(move).toBeDefined();
    // Their own end is named…
    expect(move!.toGroupName).toContain("esc_w_mine");
    expect(move!.toGroupWithheld).toBe(false);
    // …the other end is withheld, and SAYS it is withheld, rather than
    // rendering as the blank that already means "there was no group".
    expect(move!.fromGroupName).toBeNull();
    expect(move!.fromGroupWithheld).toBe(true);
    // The reason — which is the value of the record (D-108) — is still theirs
    // to read: it is a decision about a child they now teach.
    expect(move!.reason).toBe("meer tijd nodig voor de schoolslagbeenslag");
    // And the other group's name is nowhere in the payload.
    expect(JSON.stringify(history)).not.toContain("esc_w_elsewhere");

    // The first placement, into the other group, is not this instructor's
    // record at all and does not appear.
    expect(history.moves).toHaveLength(1);
    expect(history.memberships.map((entry) => entry.groupId)).toEqual([mine]);
  });
});

describe("the list filters mirror coversResource", () => {
  it("agrees with the predicate on every group, for every principal", async () => {
    // The property §2.1 exists for: a list must never return more than a per-row
    // check would allow. Asserted by running BOTH on the same rows rather than
    // by reading the two switches side by side.
    const a = await makeGroup("esc_m_a");
    const b = await makeGroup("esc_m_b");
    const instructorId = await makePerson("esc_m_instructor");
    await grantTo({
      personId: instructorId,
      roleId: instructorRoleId,
      scopeType: "GROUP",
      scopeId: a,
    });
    await assignInstructor(admin(), a, {
      personId: instructorId,
      fromDate: "2026-01-06",
    });

    for (const personId of [adminId, instructorId]) {
      const reach = await resolveReach({ personId }, "groups.read", {
        at: NOW,
      });
      const filter = await groupFilterForReach(reach);

      const visible =
        filter.kind === "DENIED"
          ? []
          : await prisma.group.findMany({
              where: filter.kind === "WHERE" ? filter.where : {},
              select: { id: true },
            });
      const visibleIds = new Set(visible.map((row) => row.id));

      for (const groupId of [a, b]) {
        const covered = await coversResource(reach, { group: groupId }, NOW);
        expect(
          visibleIds.has(groupId),
          `${personId} / ${groupId}: list and predicate disagree`,
        ).toBe(covered);
      }
    }
  });
});

describe("a SESSION-scoped grant", () => {
  async function oneLesson(): Promise<{ groupId: string; sessionId: string }> {
    const groupId = await makeGroup("esc_s_group");
    await createRecurrence(admin(), groupId, {
      weekday: 2,
      startTime: "18:00",
      durationMinutes: 45,
      startsOn: "2026-06-01",
    });
    await generateSessions(admin(), groupId, {
      from: "2026-06-01",
      to: "2026-06-09",
    });
    const session = await prisma.scheduledSession.findFirstOrThrow({
      where: { groupId },
      orderBy: { occursOn: "asc" },
      select: { id: true },
    });
    return { groupId, sessionId: session.id };
  }

  it("reaches that lesson and NOT its group", async () => {
    // §2.2: a session grant reaches "that one session's roster only … nothing
    // else, not the course, not the students' other records". The group is one
    // of those "else"s — a make-up guest's instructor may see the lesson, never
    // the group's whole membership list.
    const { groupId, sessionId } = await oneLesson();
    const assessorId = await makePerson("esc_s_assessor");

    await grantTo({
      personId: assessorId,
      roleId: instructorRoleId,
      scopeType: "SESSION",
      scopeId: sessionId,
      validFrom: new Date("2026-05-01T00:00:00Z"),
      // `validUntil` is schema-mandatory for SESSION (D-144).
      validUntil: new Date("2026-07-01T00:00:00Z"),
    });

    const assessor = { principal: { personId: assessorId }, at: NOW };

    expect((await getSessionForPrincipal(assessor, sessionId))?.id).toBe(
      sessionId,
    );
    await expect(
      getGroupForPrincipal(assessor, groupId),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(listGroupsForPrincipal(assessor)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("reaches NOTHING outside its time window — not even its own session", async () => {
    const { sessionId } = await oneLesson();
    const assessorId = await makePerson("esc_w_assessor");

    await grantTo({
      personId: assessorId,
      roleId: instructorRoleId,
      scopeType: "SESSION",
      scopeId: sessionId,
      validFrom: new Date("2026-05-01T00:00:00Z"),
      validUntil: new Date("2026-05-15T00:00:00Z"),
    });

    // AFTER the window. The grant is expired, so `resolveReach` drops it — and
    // the filter re-checks the window anyway, which is what keeps a Reach held
    // across a boundary honest.
    const after = { principal: { personId: assessorId }, at: NOW };
    await expect(
      getSessionForPrincipal(after, sessionId),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    // INSIDE the window it works, so the refusal above is the window and not a
    // broken fixture.
    const inside = {
      principal: { personId: assessorId },
      at: new Date("2026-05-07T12:00:00Z"),
    };
    expect((await getSessionForPrincipal(inside, sessionId))?.id).toBe(
      sessionId,
    );
  });

  it("carries the make-up guest and no other pupil", async () => {
    // D-179's mechanism, from the escape side: the roster is what the grant
    // reaches, and a pupil who is not on it is not reachable through it.
    const { groupId, sessionId } = await oneLesson();
    const assessorId = await makePerson("esc_g_assessor");
    const { studentProfileId: guestId } = await makeStudent("esc_g_guest");
    const { studentProfileId: strangerId } =
      await makeStudent("esc_g_stranger");

    await addGuestToSession(admin(), sessionId, {
      studentProfileId: guestId,
      reason: "inhaalles",
    });

    await grantTo({
      personId: assessorId,
      roleId: instructorRoleId,
      scopeType: "SESSION",
      scopeId: sessionId,
      validFrom: new Date("2026-05-01T00:00:00Z"),
      validUntil: new Date("2026-07-01T00:00:00Z"),
    });

    const reach = await resolveReach({ personId: assessorId }, "groups.read", {
      at: NOW,
    });
    expect(await coversResource(reach, { student: guestId }, NOW)).toBe(true);
    expect(await coversResource(reach, { student: strangerId }, NOW)).toBe(
      false,
    );
    // And still not the group, however many of its pupils are on the roster.
    expect(await coversResource(reach, { group: groupId }, NOW)).toBe(false);
  });

  it("agrees with coversResource on the session list", async () => {
    const { sessionId } = await oneLesson();
    const assessorId = await makePerson("esc_l_assessor");
    await grantTo({
      personId: assessorId,
      roleId: instructorRoleId,
      scopeType: "SESSION",
      scopeId: sessionId,
      validFrom: new Date("2026-05-01T00:00:00Z"),
      validUntil: new Date("2026-07-01T00:00:00Z"),
    });

    const reach = await resolveReach(
      { personId: assessorId },
      "planning.read",
      {
        at: NOW,
      },
    );
    const filter = sessionFilterForReach(reach, NOW);
    const visible =
      filter.kind === "DENIED"
        ? []
        : await prisma.scheduledSession.findMany({
            where: filter.kind === "WHERE" ? filter.where : {},
            select: { id: true },
          });

    const all = await prisma.scheduledSession.findMany({
      select: { id: true },
    });
    for (const row of all) {
      const covered = await coversResource(reach, { session: row.id }, NOW);
      expect(visible.some((entry) => entry.id === row.id)).toBe(covered);
    }
    expect(visible.map((entry) => entry.id)).toEqual([sessionId]);
  });
});

describe("a principal with no grant at all", () => {
  it("is DENIED rather than shown an empty list, everywhere", async () => {
    await makeGroup("esc_n_group");
    const strangerId = await makePerson("esc_stranger");
    const stranger = { principal: { personId: strangerId }, at: NOW };

    await expect(listGroupsForPrincipal(stranger)).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(
      listSessionsForPrincipal(stranger, {
        from: new Date("2026-01-01T00:00:00Z"),
        to: new Date("2027-01-01T00:00:00Z"),
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
