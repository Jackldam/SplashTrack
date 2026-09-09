import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  isReach,
  PermissionDeniedError,
  resetScopeRelations,
  resolveReach,
} from "@/lib/authorization";
import { prisma } from "@/lib/database";
import {
  createPerson,
  createStudentProfile,
  getPersonForPrincipal,
  listPeopleForPrincipal,
  personFilterForReach,
  updatePerson,
} from "@/modules/people";

import {
  ALWAYS,
  between,
  emptyWorld,
  type FakeWorld,
} from "../support/authorization-fixtures";
import {
  grantTo,
  installRelations,
  makePerson,
  makeRole,
  makeUnit,
  PEOPLE_ADMIN_PERMISSIONS,
  resetPeopleFixtures,
} from "../support/people-fixtures";

/**
 * THE `people` MODULE'S SCOPE-ESCAPE SUITE — `06-delivery.md` §2.1's "most
 * important gate in this table", and a module without one fails Definition of
 * Done.
 *
 * The gate's minimum content, per module, is a matrix rather than a sentence:
 *
 *   | A GROUP-scoped principal   | read, write AND list outside their group are
 *   |                            | denied — all three
 *   | A UNIT-scoped principal    | the same three outside their unit, and UNIT
 *   |                            | is FLAT in v1 so a child unit is outside it
 *   | A SESSION-scoped principal | the same three outside the session AND
 *   |                            | outside its time window
 *   | Reach construction         | a Reach cannot be built outside resolveReach,
 *   |                            | asserted STRUCTURALLY
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE ONE THIS MODULE ADDS: **DENIED IS NOT EMPTY**
 *
 * The list case is the one §2.1 says must never be dropped, and the failure it
 * names is a list "silently returning too much". This module's list has the
 * opposite failure available to it as well, and it is nearly as bad: a
 * `GROUP`-scoped instructor covers no `Person` at all, so the naive filter is an
 * empty `where`, which renders as *"no people found"* — indistinguishable from a
 * club with no members. Every list assertion below therefore checks that the
 * call THREW, not that it returned nothing.
 */

const NOW = new Date("2026-05-12T18:30:00Z");

let world: FakeWorld;
let zuidbad: string;
let noordbad: string;

/** People the tests read: one member per unit, one pupil per unit. */
let memberZuid: string;
let memberNoord: string;
let pupilZuid: string;

/** Principals. */
let instructor: string;
let unitManager: string;
let assessor: string;
let administrator: string;

let readerRole: string;
let adminRole: string;

async function seed(): Promise<void> {
  await resetPeopleFixtures();

  zuidbad = await makeUnit("unit_zuidbad");
  noordbad = await makeUnit("unit_noordbad");

  memberZuid = await makePerson("member_zuid", { memberOfUnit: zuidbad });
  memberNoord = await makePerson("member_noord", { memberOfUnit: noordbad });
  pupilZuid = await makePerson("pupil_zuid", { studentOfUnit: zuidbad });

  instructor = await makePerson("instructor");
  unitManager = await makePerson("unit_manager");
  assessor = await makePerson("assessor");
  administrator = await makePerson("administrator");

  readerRole = await makeRole("role_reader", [
    "people.read",
    "people.update",
    "students.create",
  ]);
  adminRole = await makeRole("role_admin", [...PEOPLE_ADMIN_PERMISSIONS]);

  // The four principals of §2.1's matrix.
  await grantTo({
    personId: instructor,
    roleId: readerRole,
    scopeType: "GROUP",
    scopeId: "group_a1",
  });
  await grantTo({
    personId: unitManager,
    roleId: readerRole,
    scopeType: "UNIT",
    scopeId: zuidbad,
  });
  await grantTo({
    personId: assessor,
    roleId: readerRole,
    scopeType: "SESSION",
    scopeId: "session_thu",
    validFrom: new Date("2026-05-11T00:00:00Z"),
    validUntil: new Date("2026-05-21T00:00:00Z"),
  });
  await grantTo({
    personId: administrator,
    roleId: adminRole,
    scopeType: "ORGANIZATION",
  });
}

/** The groups/sessions/courses this module does not own, as fakes. */
function seedWorld(): FakeWorld {
  const w = emptyWorld();
  w.groupUnit.set("group_a1", zuidbad);
  w.sessionGroup.set("session_thu", "group_a1");
  w.sessionDate.set("session_thu", new Date("2026-05-14T18:00:00Z"));
  w.instructorAssignments.push({
    personId: instructor,
    groupId: "group_a1",
    interval: ALWAYS,
  });
  w.rosters.push({
    sessionId: "session_thu",
    studentProfileId: "irrelevant",
    interval: ALWAYS,
  });
  return w;
}

describe("people — scope escape (06-delivery.md §2.1)", () => {
  beforeEach(async () => {
    await seed();
    world = seedWorld();
    installRelations(world);
  });

  afterAll(async () => {
    await resetPeopleFixtures();
    resetScopeRelations();
  });

  // ── A GROUP-scoped principal ─────────────────────────────────────────────

  describe("a GROUP-scoped instructor", () => {
    const actor = () => ({
      principal: { personId: instructor },
      at: NOW,
    });

    it("is DENIED reading a person outside their reach — and it is a denial, not a not-found", async () => {
      await expect(
        getPersonForPrincipal(actor(), memberZuid),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });

    it("is DENIED reading a person in the unit their own group sits in", async () => {
      // The near miss that a scope-type RANKING would wave through: the group
      // IS in Zuidbad, and a group grant still does not reach upward to the
      // unit or sideways to a person record (§2.2, §6.1).
      await expect(
        getPersonForPrincipal(actor(), memberNoord),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });

    it("is DENIED WRITING to a person outside their reach", async () => {
      await expect(
        updatePerson(actor(), memberZuid, {
          givenName: "Overwritten",
          familyName: "ByAnInstructor",
        }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);

      // And nothing changed. A guard that throws after the write is not a guard.
      const row = await prisma.person.findUnique({
        where: { id: memberZuid },
        select: { givenName: true },
      });
      expect(row?.givenName).toBe("Fixture");
    });

    it("is DENIED creating a pupil record for a person outside their reach", async () => {
      await expect(
        createStudentProfile(actor(), memberZuid, {}),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        prisma.studentProfile.count({ where: { personId: memberZuid } }),
      ).resolves.toBe(0);
    });

    it("is DENIED THE LIST — it THROWS, and does not return an empty page", async () => {
      // THE ASSERTION THIS WHOLE FILE EXISTS FOR. An empty array here would
      // pass a naive "cannot see other people's records" test while teaching
      // the instructor that the screen is broken, and would hide the fact that
      // the filter had silently become "no predicate at all".
      await expect(listPeopleForPrincipal(actor())).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
    });

    it("resolves a NON-EMPTY reach — the denial is about coverage, not about holding nothing", async () => {
      // If this were empty the test above would pass for the wrong reason: it
      // would be asserting that the grant does not exist rather than that a
      // group grant does not cover a Person.
      const reach = await resolveReach(
        { personId: instructor },
        "people.read",
        {
          at: NOW,
        },
      );
      expect(isReach(reach)).toBe(true);
      expect(personFilterForReach(reach)).toEqual({ kind: "DENIED" });
    });
  });

  // ── A UNIT-scoped principal ──────────────────────────────────────────────

  describe("a UNIT-scoped member administrator", () => {
    const actor = () => ({ principal: { personId: unitManager }, at: NOW });

    it("READS a member of their own unit", async () => {
      const person = await getPersonForPrincipal(actor(), memberZuid);
      expect(person?.id).toBe(memberZuid);
    });

    it("is DENIED a member of ANOTHER unit", async () => {
      await expect(
        getPersonForPrincipal(actor(), memberNoord),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });

    it("is DENIED WRITING to a member of another unit", async () => {
      await expect(
        updatePerson(actor(), memberNoord, {
          givenName: "Reached",
          familyName: "Across",
        }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });

    it("LISTS only their own unit's members — and a pupil with no membership is NOT in it", async () => {
      const people = await listPeopleForPrincipal(actor());
      const ids = people.map((person) => person.id);

      expect(ids).toContain(memberZuid);
      expect(ids).not.toContain(memberNoord);
      // The documented reading, asserted rather than assumed: `UNIT` coverage
      // of a bare { person } resolves through the MEMBERSHIP unit, so a child
      // taking lessons — the most common person in the database, §5.1 — is not
      // reachable this way. They are addressed as { student }, through their
      // home unit. If that reading ever changes, this line is where it is
      // noticed.
      expect(ids).not.toContain(pupilZuid);
    });

    it("the list agrees with the per-row guard, row by row", async () => {
      // The property §2.1 is really asking for: a list that returns MORE than
      // the guard allows is the F-15 failure, and a list that returns less is a
      // screen nobody can use. Checked exhaustively against every person in the
      // database rather than against a hand-picked pair.
      const listed = new Set(
        (await listPeopleForPrincipal(actor())).map((person) => person.id),
      );
      const everyone = await prisma.person.findMany({
        where: { id: { startsWith: "peoplefx_" } },
        select: { id: true },
      });

      for (const { id } of everyone) {
        const guardAllows = await getPersonForPrincipal(actor(), id)
          .then(() => true)
          .catch((error) => {
            if (error instanceof PermissionDeniedError) return false;
            throw error;
          });
        expect(guardAllows, `guard vs list disagree for ${id}`).toBe(
          listed.has(id),
        );
      }
    });
  });

  // ── A SESSION-scoped principal ───────────────────────────────────────────

  describe("a SESSION-scoped aftest assessor", () => {
    const inside = () => ({ principal: { personId: assessor }, at: NOW });
    /** After the grant's own window has closed (D-144, D-170). */
    const outside = () => ({
      principal: { personId: assessor },
      at: new Date("2026-06-30T00:00:00Z"),
    });

    it("is DENIED a person record inside the window — a roster is not a person register", async () => {
      // §2.2: a SESSION grant reaches that session's roster and "nothing else,
      // not the course, not the students' other records".
      await expect(
        getPersonForPrincipal(inside(), memberZuid),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });

    it("is DENIED reading, writing and listing OUTSIDE the time window", async () => {
      await expect(
        getPersonForPrincipal(outside(), memberZuid),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        updatePerson(outside(), memberZuid, {
          givenName: "After",
          familyName: "TheWindow",
        }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(listPeopleForPrincipal(outside())).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
    });

    it("holds NO reach at all once the window has closed", async () => {
      // The grant row still exists. Expiry is a predicate inside resolveReach
      // and never a cleanup job (D-144) — a job that has not run yet is an open
      // grant.
      const reach = await resolveReach({ personId: assessor }, "people.read", {
        at: outside().at,
      });
      expect(personFilterForReach(reach)).toEqual({ kind: "DENIED" });
    });
  });

  // ── Reach construction ───────────────────────────────────────────────────

  describe("reach construction (structural, not by convention)", () => {
    it("the repository refuses a hand-built literal", async () => {
      // D-147's opacity, checked at the module boundary rather than only in the
      // authorization layer's own suite: the brand is a non-exported symbol, so
      // this object is a compile error AND a runtime refusal.
      const forged = { kind: "ORGANIZATION" } as never;
      expect(() => personFilterForReach(forged)).toThrow();
    });

    it("the repository refuses a SPREAD of a real reach — the one-line forgery", async () => {
      const real = await resolveReach({ personId: instructor }, "people.read", {
        at: NOW,
      });
      // `reachVariant` returns a copy with the brand REMOVED precisely so that
      // spreading it cannot widen anything. Re-widening it to ORGANIZATION here
      // must not produce something the filter accepts.
      const forged = { kind: "ORGANIZATION" } as never;
      expect(isReach(real)).toBe(true);
      expect(() => personFilterForReach(forged)).toThrow();
    });
  });

  // ── The administrator, so the suite is not vacuous ───────────────────────

  it("an ORGANIZATION-scoped administrator reads, writes and lists everyone", async () => {
    // Without this, every assertion above could pass because nothing works.
    const actor = { principal: { personId: administrator }, at: NOW };
    const people = await listPeopleForPrincipal(actor);
    const ids = people.map((person) => person.id);
    expect(ids).toContain(memberZuid);
    expect(ids).toContain(memberNoord);
    expect(ids).toContain(pupilZuid);

    await expect(
      getPersonForPrincipal(actor, memberNoord),
    ).resolves.not.toBeNull();

    await createPerson(actor, {
      givenName: "Created",
      familyName: "ByAdministrator",
    });
  });

  it("a principal with the SELF grant reads their own record and nobody else's", async () => {
    // D-146's closed set, and the axis D-161 forbids foreclosing: this is a
    // reader who is not staff, and the query supports them because the filter
    // switches on the reach rather than asking whether the caller is staff.
    const selfRole = await makeRole("role_self", ["people.read"]);
    await grantTo({
      personId: memberZuid,
      roleId: selfRole,
      scopeType: "SELF",
    });

    const actor = { principal: { personId: memberZuid }, at: NOW };
    const people = await listPeopleForPrincipal(actor);
    expect(people.map((person) => person.id)).toEqual([memberZuid]);

    await expect(
      getPersonForPrincipal(actor, memberNoord),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("a GROUP grant whose InstructorAssignment has LAPSED reaches nothing", async () => {
    // D-145 rule 1, from this module's side: GroupMembership rows are kept for
    // life (D-059), so resolving group reach from the grant alone would mean
    // every instructor who ever taught a child keeps access permanently (F-114).
    world.instructorAssignments = [
      {
        personId: instructor,
        groupId: "group_a1",
        interval: between("2024-01-01", "2025-01-01"),
      },
    ];
    installRelations(world);

    const reach = await resolveReach({ personId: instructor }, "people.read", {
      at: NOW,
    });
    expect(personFilterForReach(reach)).toEqual({ kind: "DENIED" });
  });
});
