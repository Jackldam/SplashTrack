import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  configureScopeRelations,
  coversResource,
  isEmptyReach,
  PermissionDeniedError,
  reachVariant,
  requirePermission,
  resetScopeRelations,
  resolveReach,
} from "@/lib/authorization";

import {
  ALWAYS,
  between,
  createPerson,
  createRole,
  emptyWorld,
  grant,
  relationsFor,
  resetAuthorizationFixtures,
  type FakeWorld,
} from "../support/authorization-fixtures";

/**
 * `resolveReach` and `coversResource` against a real database (D-147, D-145,
 * D-144, D-068, D-121, D-179).
 *
 * The grants are real rows in real Postgres; the domain relations are the fake
 * of `tests/support/authorization-fixtures.ts` — see that file for why, and for
 * exactly what that split does and does not prove.
 *
 * This is the beginning of the scope-escape gate `06-delivery.md` §2.1 calls
 * "the most important gate in this table". It covers the MECHANISM's four
 * required cases; the per-module suites that assert on the FIELDS returned
 * arrive with their modules.
 */

const NOW = new Date("2026-05-12T18:30:00Z");

let world: FakeWorld;

// The cast of characters, seeded fresh per test.
let instructor: string;
let examiner: string;
let assessor: string;
let manager: string;
let outsider: string;

let instructorRole: string;
let examinerRole: string;
let managerRole: string;

async function seedPeopleAndRoles(): Promise<void> {
  instructor = await createPerson("instructor");
  examiner = await createPerson("examiner");
  assessor = await createPerson("assessor");
  manager = await createPerson("manager");
  outsider = await createPerson("outsider");

  instructorRole = await createRole("role_instructor", [
    "students.read",
    "attendance.record",
  ]);
  examinerRole = await createRole("role_examiner", [
    "students.read",
    "exams.results.record",
  ]);
  managerRole = await createRole("role_manager", ["students.read"]);
}

/**
 * One club, one season.
 *
 *   unit_zuidbad ─┬─ group_a1 ── session_thu (12 March) ── student_sanne
 *                 └─ group_b2
 *   unit_noordbad ── group_summer
 *   course_diploma_b ── group_a1 + group_summer   (crosses BOTH units — §2.1)
 */
function seedWorld(): FakeWorld {
  const w = emptyWorld();
  w.groupUnit.set("group_a1", "unit_zuidbad");
  w.groupUnit.set("group_b2", "unit_zuidbad");
  w.groupUnit.set("group_summer", "unit_noordbad");

  w.sessionGroup.set("session_thu", "group_a1");
  w.sessionDate.set("session_thu", new Date("2026-05-14T18:00:00Z"));
  w.sessionGroup.set("session_summer", "group_summer");
  w.sessionDate.set("session_summer", new Date("2026-07-02T18:00:00Z"));

  w.courseGroups.set("course_diploma_b", ["group_a1", "group_summer"]);
  w.courseSessions.set("course_diploma_b", ["session_thu", "session_summer"]);
  w.courseEnd.set("course_diploma_b", new Date("2026-06-30T00:00:00Z"));

  w.studentPerson.set("student_sanne", "person_sanne");
  w.personUnit.set("person_sanne", "unit_zuidbad");
  w.groupMemberships.push({
    groupId: "group_a1",
    studentProfileId: "student_sanne",
    interval: ALWAYS,
  });
  w.enrolments.push({
    courseId: "course_diploma_b",
    studentProfileId: "student_sanne",
    interval: ALWAYS,
  });
  w.rosters.push({
    sessionId: "session_thu",
    studentProfileId: "student_sanne",
    interval: ALWAYS,
  });
  return w;
}

describe("resolveReach / coversResource (real database)", () => {
  beforeEach(async () => {
    await resetAuthorizationFixtures();
    await seedPeopleAndRoles();
    world = seedWorld();
    configureScopeRelations(relationsFor(world));
  });

  afterAll(async () => {
    await resetAuthorizationFixtures();
    resetScopeRelations();
  });

  // ── The variants the OLD shape could not express at all (F-112) ───────────

  it("a COURSE-scoped grant resolves to a NON-EMPTY reach", async () => {
    // The internal examiner of §2.4. Under `{units, groups, all}` this resolved
    // to `{units: [], groups: [], all: false}` — empty reach, every list denies
    // them, and the candidate list they are standing there to assess is blank.
    await grant({
      personId: examiner,
      roleId: examinerRole,
      scopeType: "COURSE",
      scopeId: "course_diploma_b",
      validUntil: new Date("2026-07-07T00:00:00Z"),
    });

    const reach = await resolveReach(
      { personId: examiner },
      "exams.results.record",
      { at: NOW },
    );

    expect(isEmptyReach(reach)).toBe(false);
    expect(reachVariant(reach)).toEqual({
      kind: "COURSES",
      courseIds: ["course_diploma_b"],
    });
    await expect(
      coversResource(reach, { course: "course_diploma_b" }, NOW),
    ).resolves.toBe(true);
    // "all its exam sessions" (§2.2)
    await expect(
      coversResource(reach, { session: "session_summer" }, NOW),
    ).resolves.toBe(true);
  });

  it("a SESSION-scoped grant resolves to a NON-EMPTY reach, with its window", async () => {
    // The independent aftest assessor (D-085) and the external examiner
    // (D-052) — and, weekly, the substitute and the make-up guest's receiving
    // instructor (D-179).
    await grant({
      personId: assessor,
      roleId: examinerRole,
      scopeType: "SESSION",
      scopeId: "session_thu",
      validFrom: new Date("2026-05-11T00:00:00Z"),
      validUntil: new Date("2026-05-21T00:00:00Z"),
    });

    const reach = await resolveReach({ personId: assessor }, "students.read", {
      at: NOW,
    });

    expect(isEmptyReach(reach)).toBe(false);
    const variant = reachVariant(reach);
    expect(variant.kind).toBe("SESSIONS");
    if (variant.kind !== "SESSIONS") throw new Error("unreachable");
    expect(variant.sessionIds).toEqual(["session_thu"]);
    expect(variant.window.until.toISOString()).toBe("2026-05-21T00:00:00.000Z");

    // The roster is resolved AT CHECK TIME, never cached at grant time (D-068).
    await expect(
      coversResource(reach, { student: "student_sanne" }, NOW),
    ).resolves.toBe(true);
  });

  // ── Expiry, evaluated in the guard and nowhere else (D-144) ───────────────

  it("an EXPIRED grant resolves to NONE, with no cleanup job having run", async () => {
    // The row is still there — nothing deleted it, and nothing was scheduled to.
    // A job that has not run yet is an open grant; a predicate cannot be behind
    // schedule. F-113.
    const grantId = await grant({
      personId: examiner,
      roleId: examinerRole,
      scopeType: "SESSION",
      scopeId: "session_thu",
      validFrom: new Date("2026-03-10T00:00:00Z"),
      validUntil: new Date("2026-03-21T00:00:00Z"),
    });

    const reach = await resolveReach(
      { personId: examiner },
      "exams.results.record",
      { at: NOW },
    );

    expect(reachVariant(reach)).toEqual({ kind: "NONE" });
    expect(isEmptyReach(reach)).toBe(true);

    // The proof that no cleanup ran: the grant is still on disk, unchanged.
    const stillThere = await import("@/lib/database").then(({ prisma }) =>
      prisma.roleAssignment.findUnique({ where: { id: grantId } }),
    );
    expect(stillThere).not.toBeNull();
    expect(stillThere?.validUntil?.toISOString()).toBe(
      "2026-03-21T00:00:00.000Z",
    );

    // ... and the same grant WAS live inside its own window.
    const thenReach = await resolveReach(
      { personId: examiner },
      "exams.results.record",
      { at: new Date("2026-03-14T10:00:00Z") },
    );
    expect(isEmptyReach(thenReach)).toBe(false);
  });

  it("a grant that has not STARTED yet resolves to NONE", async () => {
    await grant({
      personId: assessor,
      roleId: examinerRole,
      scopeType: "SESSION",
      scopeId: "session_summer",
      validFrom: new Date("2026-07-01T00:00:00Z"),
      validUntil: new Date("2026-07-09T00:00:00Z"),
    });
    const reach = await resolveReach({ personId: assessor }, "students.read", {
      at: NOW,
    });
    expect(reachVariant(reach)).toEqual({ kind: "NONE" });
  });

  // ── D-145: live evaluation of every membership-derived coverage ───────────

  it("GROUP coverage DISAPPEARS the moment the InstructorAssignment ends", async () => {
    // F-114: `GroupMembership` rows are kept for life (D-059), so the natural
    // union-of-grants implementation lets every instructor who ever taught a
    // child keep read access to their complete record permanently. The grant
    // row below is standing and is never revoked; what ends is the assignment.
    await grant({
      personId: instructor,
      roleId: instructorRole,
      scopeType: "GROUP",
      scopeId: "group_a1",
    });
    world.instructorAssignments.push({
      personId: instructor,
      groupId: "group_a1",
      interval: between("2026-01-01T00:00:00Z", "2026-05-12T18:00:00Z"),
    });

    const thirtyMinutesBefore = new Date("2026-05-12T17:30:00Z");
    const reachWhileTeaching = await resolveReach(
      { personId: instructor },
      "students.read",
      { at: thirtyMinutesBefore },
    );
    expect(reachVariant(reachWhileTeaching)).toEqual({
      kind: "GROUPS",
      groupIds: ["group_a1"],
    });
    await expect(
      coversResource(
        reachWhileTeaching,
        { student: "student_sanne" },
        thirtyMinutesBefore,
      ),
    ).resolves.toBe(true);

    // NOW is 18:30 — thirty minutes after the assignment ended.
    const reachAfter = await resolveReach(
      { personId: instructor },
      "students.read",
      { at: NOW },
    );
    expect(reachVariant(reachAfter)).toEqual({ kind: "NONE" });
    await expect(
      coversResource(reachAfter, { student: "student_sanne" }, NOW),
    ).resolves.toBe(false);

    // And the grant row is untouched — this is a live predicate, not a revocation.
    const rows = await import("@/lib/database").then(({ prisma }) =>
      prisma.roleAssignment.count({ where: { personId: instructor } }),
    );
    expect(rows).toBe(1);
  });

  it("GROUP coverage of a student needs the MEMBERSHIP live too, not only the assignment", async () => {
    await grant({
      personId: instructor,
      roleId: instructorRole,
      scopeType: "GROUP",
      scopeId: "group_a1",
    });
    world.instructorAssignments.push({
      personId: instructor,
      groupId: "group_a1",
      interval: ALWAYS,
    });
    // Sanne left the group in April. The row survives — D-059 keeps it for life.
    world.groupMemberships = [
      {
        groupId: "group_a1",
        studentProfileId: "student_sanne",
        interval: between("2026-01-01T00:00:00Z", "2026-04-01T00:00:00Z"),
      },
    ];

    const reach = await resolveReach(
      { personId: instructor },
      "students.read",
      {
        at: NOW,
      },
    );
    // The instructor still reaches the GROUP...
    await expect(
      coversResource(reach, { group: "group_a1" }, NOW),
    ).resolves.toBe(true);
    // ... and no longer reaches the child who left it.
    await expect(
      coversResource(reach, { student: "student_sanne" }, NOW),
    ).resolves.toBe(false);
  });

  it("a student's PROFILE is governed by their HOME unit, not by the unit of a group they visit", async () => {
    // D-145's cross-unit case: a child registered at Zuidbad attending a summer
    // course at Noordbad. A union always takes the broader answer, so without
    // this rule Noordbad's Location Manager reaches her whole profile.
    await grant({
      personId: manager,
      roleId: managerRole,
      scopeType: "UNIT",
      scopeId: "unit_noordbad",
    });
    world.groupMemberships.push({
      groupId: "group_summer",
      studentProfileId: "student_sanne",
      interval: ALWAYS,
    });

    const reach = await resolveReach({ personId: manager }, "students.read", {
      at: NOW,
    });
    // The group at Noordbad, yes — "that group's attendance and progress only".
    await expect(
      coversResource(reach, { group: "group_summer" }, NOW),
    ).resolves.toBe(true);
    // Her profile, no — her home unit is Zuidbad.
    await expect(
      coversResource(reach, { student: "student_sanne" }, NOW),
    ).resolves.toBe(false);
  });

  // ── Scope escape (D-032, §6.1) ────────────────────────────────────────────

  describe("scope escape", () => {
    beforeEach(async () => {
      world.instructorAssignments.push({
        personId: instructor,
        groupId: "group_a1",
        interval: ALWAYS,
      });
    });

    it("a GROUP-scoped principal is denied outside their group, on read and on write", async () => {
      await grant({
        personId: instructor,
        roleId: instructorRole,
        scopeType: "GROUP",
        scopeId: "group_a1",
      });
      const principal = { personId: instructor };

      await expect(
        requirePermission(
          principal,
          "students.read",
          { group: "group_a1" },
          { at: NOW },
        ),
      ).resolves.toBeDefined();

      for (const ref of [
        { group: "group_b2" },
        { unit: "unit_zuidbad" },
        { course: "course_diploma_b" },
        { session: "session_summer" },
        { organization: true as const },
      ]) {
        await expect(
          requirePermission(principal, "students.read", ref, { at: NOW }),
        ).rejects.toBeInstanceOf(PermissionDeniedError);
      }

      // A write permission they were never granted, on their OWN group.
      await expect(
        requirePermission(
          principal,
          "exams.results.record",
          { group: "group_a1" },
          { at: NOW },
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });

    it("UNIT is FLAT — a child unit is outside it (D-121)", async () => {
      // The child unit is a real row; the point is that no code walks to it.
      const { prisma } = await import("@/lib/database");
      const parent = await prisma.organizationUnit.create({
        data: { id: "authzfx_unit_parent", name: "Zuidbad", path: "/zuidbad/" },
      });
      const child = await prisma.organizationUnit.create({
        data: {
          id: "authzfx_unit_child",
          parentId: parent.id,
          name: "Instructiebad",
          path: "/zuidbad/instructiebad/",
          depth: 1,
        },
      });
      try {
        await grant({
          personId: manager,
          roleId: managerRole,
          scopeType: "UNIT",
          scopeId: parent.id,
        });
        const reach = await resolveReach(
          { personId: manager },
          "students.read",
          {
            at: NOW,
          },
        );
        await expect(
          coversResource(reach, { unit: parent.id }, NOW),
        ).resolves.toBe(true);
        await expect(
          coversResource(reach, { unit: child.id }, NOW),
        ).resolves.toBe(false);
      } finally {
        await prisma.roleAssignment.deleteMany({
          where: { personId: manager },
        });
        await prisma.organizationUnit.delete({ where: { id: child.id } });
        await prisma.organizationUnit.delete({ where: { id: parent.id } });
      }
    });

    it("a SESSION-scoped principal is denied outside their session AND outside its window", async () => {
      await grant({
        personId: assessor,
        roleId: examinerRole,
        scopeType: "SESSION",
        scopeId: "session_thu",
        validFrom: new Date("2026-05-11T00:00:00Z"),
        validUntil: new Date("2026-05-21T00:00:00Z"),
      });
      const principal = { personId: assessor };

      await expect(
        requirePermission(
          principal,
          "students.read",
          { session: "session_thu" },
          { at: NOW },
        ),
      ).resolves.toBeDefined();

      // Outside the session — not the course, not the group, not the unit.
      for (const ref of [
        { session: "session_summer" },
        { course: "course_diploma_b" },
        { group: "group_a1" },
        { unit: "unit_zuidbad" },
      ]) {
        await expect(
          requirePermission(principal, "students.read", ref, { at: NOW }),
        ).rejects.toBeInstanceOf(PermissionDeniedError);
      }

      // Outside the window, on the very session they were assigned to.
      await expect(
        requirePermission(
          principal,
          "students.read",
          { session: "session_thu" },
          { at: new Date("2026-05-22T09:00:00Z") },
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });

    it("a principal holding NO grant reaches nothing and is denied everything", async () => {
      const principal = { personId: outsider };
      const reach = await resolveReach(principal, "students.read", { at: NOW });
      expect(reachVariant(reach)).toEqual({ kind: "NONE" });
      await expect(
        requirePermission(
          principal,
          "students.read",
          { student: "student_sanne" },
          { at: NOW },
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });

    it("a bare permission check is refused — every operation is resource-referenced (D-030)", async () => {
      await grant({
        personId: manager,
        roleId: managerRole,
        scopeType: "ORGANIZATION",
      });
      await expect(
        requirePermission({ personId: manager }, "students.read", {} as never, {
          at: NOW,
        }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });
  });

  // ── Union and absorption (§2.1) ───────────────────────────────────────────

  it("effective reach is the UNION of a principal's grants", async () => {
    world.instructorAssignments.push({
      personId: instructor,
      groupId: "group_a1",
      interval: ALWAYS,
    });
    await grant({
      personId: instructor,
      roleId: instructorRole,
      scopeType: "GROUP",
      scopeId: "group_a1",
    });
    const secondRole = await createRole("role_instructor_2", ["students.read"]);
    await grant({
      personId: instructor,
      roleId: secondRole,
      scopeType: "SESSION",
      scopeId: "session_summer",
      validFrom: new Date("2026-05-01T00:00:00Z"),
      validUntil: new Date("2026-07-09T00:00:00Z"),
    });

    const reach = await resolveReach(
      { personId: instructor },
      "students.read",
      {
        at: NOW,
      },
    );
    const variant = reachVariant(reach);
    expect(variant.kind).toBe("UNION");
    if (variant.kind !== "UNION") throw new Error("unreachable");
    expect(variant.of.map((r) => reachVariant(r).kind).sort()).toEqual([
      "GROUPS",
      "SESSIONS",
    ]);
    await expect(
      coversResource(reach, { group: "group_a1" }, NOW),
    ).resolves.toBe(true);
    await expect(
      coversResource(reach, { session: "session_summer" }, NOW),
    ).resolves.toBe(true);
  });

  it("an ORGANIZATION grant ABSORBS the union rather than joining it", async () => {
    await grant({
      personId: manager,
      roleId: managerRole,
      scopeType: "ORGANIZATION",
    });
    const unitRole = await createRole("role_unit", ["students.read"]);
    await grant({
      personId: manager,
      roleId: unitRole,
      scopeType: "UNIT",
      scopeId: "unit_zuidbad",
    });

    const reach = await resolveReach({ personId: manager }, "students.read", {
      at: NOW,
    });
    // "Everything" is a resolution OUTCOME, not a field anyone can set.
    expect(reachVariant(reach)).toEqual({ kind: "ORGANIZATION" });
  });

  // ── SELF is explicit, never implicit (D-146) ──────────────────────────────

  it("SELF covers only the holder's own records, and only from a real grant", async () => {
    const selfRole = await createRole("role_self", ["students.read"]);
    world.studentPerson.set("student_self", outsider);

    // Before the grant exists: an authenticated person holding NO grant. F-124
    // is exactly this call succeeding.
    const before = await resolveReach({ personId: outsider }, "students.read", {
      at: NOW,
    });
    expect(reachVariant(before)).toEqual({ kind: "NONE" });
    await expect(
      coversResource(before, { person: outsider }, NOW),
    ).resolves.toBe(false);

    await grant({
      personId: outsider,
      roleId: selfRole,
      scopeType: "SELF",
    });

    const after = await resolveReach({ personId: outsider }, "students.read", {
      at: NOW,
    });
    expect(reachVariant(after)).toEqual({ kind: "SELF", personId: outsider });
    await expect(
      coversResource(after, { person: outsider }, NOW),
    ).resolves.toBe(true);
    await expect(
      coversResource(after, { student: "student_self" }, NOW),
    ).resolves.toBe(true);
    // Never anything about another person.
    await expect(
      coversResource(after, { person: instructor }, NOW),
    ).resolves.toBe(false);
    await expect(
      coversResource(after, { student: "student_sanne" }, NOW),
    ).resolves.toBe(false);
  });

  // ── Deny by default when a relation nobody registered is needed ───────────

  it("DENIES rather than throwing when a scope relation has no implementation", async () => {
    resetScopeRelations();
    try {
      await grant({
        personId: instructor,
        roleId: instructorRole,
        scopeType: "GROUP",
        scopeId: "group_a1",
      });
      // The GROUP half drops...
      const reach = await resolveReach(
        { personId: instructor },
        "students.read",
        {
          at: NOW,
        },
      );
      expect(reachVariant(reach)).toEqual({ kind: "NONE" });

      // ... while an ORGANIZATION grant on the same instance still resolves,
      // because the failure is scoped to the grant that needed the relation.
      await grant({
        personId: manager,
        roleId: managerRole,
        scopeType: "ORGANIZATION",
      });
      const managerReach = await resolveReach(
        { personId: manager },
        "students.read",
        { at: NOW },
      );
      expect(reachVariant(managerReach)).toEqual({ kind: "ORGANIZATION" });
    } finally {
      configureScopeRelations(relationsFor(world));
    }
  });
});
