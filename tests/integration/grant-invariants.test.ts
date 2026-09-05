import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  assertGrantable,
  configureScopeRelations,
  GrantRefusedError,
  resetScopeRelations,
  type GrantProposal,
} from "@/lib/authorization";

import {
  createPerson,
  createRole,
  emptyWorld,
  grant,
  relationsFor,
  resetAuthorizationFixtures,
  type FakeWorld,
} from "../support/authorization-fixtures";

/**
 * §2.6's three invariants, as completed by §2.6.1 (D-139, D-170).
 *
 * All three are scope-escape test cases under D-032: a granter attempting to
 * grant a permission they lack, a granter attempting to grant over resources
 * their own grant does not cover, and a granter attempting to issue a window
 * wider than their own — all denied **at the service**, because the UI hiding
 * the option is not authorization (§1.1 rule 1).
 *
 * The cross-unit `COURSE` case is here by name, because D-170 requires it: it
 * is *"the case a type-ranking implementation passes"*, so the test must fail
 * on the wrong implementation rather than on nothing.
 */

const NOW = new Date("2026-05-12T18:30:00Z");

let world: FakeWorld;
let administrator: string;
let locationManager: string;
let planner: string;
let subject: string;

let adminRole: string;
let examsRole: string;
let plannerRole: string;

function proposal(overrides: Partial<GrantProposal> = {}): GrantProposal {
  return {
    permission: "exams.results.record",
    scopeType: "COURSE",
    scopeId: "course_diploma_b",
    validFrom: new Date("2026-05-01T00:00:00Z"),
    validUntil: new Date("2026-06-30T00:00:00Z"),
    ...overrides,
  };
}

describe("grant invariants (real database)", () => {
  beforeEach(async () => {
    await resetAuthorizationFixtures();

    administrator = await createPerson("grant_admin");
    locationManager = await createPerson("grant_manager");
    planner = await createPerson("grant_planner");
    subject = await createPerson("grant_subject");

    adminRole = await createRole("grant_role_admin", [
      "exams.results.record",
      "students.medical.read",
      "roles.assign",
    ]);
    examsRole = await createRole("grant_role_exams", ["exams.results.record"]);
    plannerRole = await createRole("grant_role_planner", ["planning.manage"]);

    world = emptyWorld();
    // Zuidbad holds group_a1; Noordbad holds group_summer.
    world.groupUnit.set("group_a1", "unit_zuidbad");
    world.groupUnit.set("group_summer", "unit_noordbad");
    world.sessionGroup.set("session_thu", "group_a1");
    world.sessionDate.set("session_thu", new Date("2026-05-14T18:00:00Z"));
    world.courseEnd.set("course_diploma_b", new Date("2026-06-30T00:00:00Z"));
    world.courseEnd.set(
      "course_zuidbad_only",
      new Date("2026-06-30T00:00:00Z"),
    );
    // Diploma B runs ACROSS both units — §2.1's "one course across groups".
    world.courseGroups.set("course_diploma_b", ["group_a1", "group_summer"]);
    world.courseSessions.set("course_diploma_b", ["session_thu"]);
    // A course entirely inside Zuidbad, for the legitimate half of the case.
    world.courseGroups.set("course_zuidbad_only", ["group_a1"]);
    world.personUnit.set(subject, "unit_zuidbad");
    configureScopeRelations(relationsFor(world));
  });

  afterAll(async () => {
    await resetAuthorizationFixtures();
    resetScopeRelations();
  });

  // ── Invariant 1 ───────────────────────────────────────────────────────────

  it("REFUSES a permission the granter does not hold (no amplification)", async () => {
    // A Planner cannot grant `students.medical.read` because they do not hold
    // it. This is the whole of F-109 in one call.
    await grant({
      personId: planner,
      roleId: plannerRole,
      scopeType: "ORGANIZATION",
    });

    await expect(
      assertGrantable(
        {
          granter: { personId: planner },
          subjectPersonId: subject,
          proposals: [
            proposal({
              permission: "students.medical.read",
              scopeType: "UNIT",
              scopeId: "unit_zuidbad",
              validUntil: null,
            }),
          ],
        },
        { at: NOW },
      ),
    ).rejects.toMatchObject({
      name: "GrantRefusedError",
      reason: "AMPLIFICATION",
    });
  });

  it("REFUSES a permission whose only grant to the granter has EXPIRED", async () => {
    await grant({
      personId: locationManager,
      roleId: examsRole,
      scopeType: "COURSE",
      scopeId: "course_diploma_b",
      validFrom: new Date("2026-01-01T00:00:00Z"),
      validUntil: new Date("2026-02-01T00:00:00Z"),
    });

    await expect(
      assertGrantable(
        {
          granter: { personId: locationManager },
          subjectPersonId: subject,
          proposals: [proposal()],
        },
        { at: NOW },
      ),
    ).rejects.toMatchObject({ reason: "AMPLIFICATION" });
  });

  it("ALLOWS a permission the granter holds, at a scope they cover", async () => {
    await grant({
      personId: administrator,
      roleId: adminRole,
      scopeType: "ORGANIZATION",
    });

    await expect(
      assertGrantable(
        {
          granter: { personId: administrator },
          subjectPersonId: subject,
          proposals: [proposal()],
        },
        { at: NOW },
      ),
    ).resolves.toBeUndefined();
  });

  // ── Invariant 2: containment, not a type ranking (D-170) ──────────────────

  describe("scope confinement is resource containment", () => {
    beforeEach(async () => {
      // A UNIT-scoped Location Manager at Zuidbad, holding exams.results.record
      // there. Exactly F-139's actor.
      await grant({
        personId: locationManager,
        roleId: examsRole,
        scopeType: "UNIT",
        scopeId: "unit_zuidbad",
      });
    });

    it("REFUSES a UNIT granter granting at a COURSE that crosses into another unit", async () => {
      // THE CASE A TYPE-RANKING IMPLEMENTATION PASSES (D-170). Under the
      // obvious breadth ranking COURSE sits "below" UNIT, every check passes,
      // and the Location Manager's reach now covers Diploma B's exam sessions
      // at NOORDBAD — where D-062's append-only results make their amendment
      // the effective outcome.
      await expect(
        assertGrantable(
          {
            granter: { personId: locationManager },
            subjectPersonId: subject,
            proposals: [proposal({ scopeId: "course_diploma_b" })],
          },
          { at: NOW },
        ),
      ).rejects.toMatchObject({ reason: "SCOPE_NOT_CONTAINED" });
    });

    it("ALLOWS the same granter at a COURSE whose every group sits in their unit", async () => {
      await expect(
        assertGrantable(
          {
            granter: { personId: locationManager },
            subjectPersonId: subject,
            proposals: [proposal({ scopeId: "course_zuidbad_only" })],
          },
          { at: NOW },
        ),
      ).resolves.toBeUndefined();
    });

    it("REFUSES a COURSE with no groups — an empty set is not a safe subset", async () => {
      world.courseGroups.set("course_empty", []);
      world.courseEnd.set("course_empty", new Date("2026-06-30T00:00:00Z"));
      await expect(
        assertGrantable(
          {
            granter: { personId: locationManager },
            subjectPersonId: subject,
            proposals: [proposal({ scopeId: "course_empty" })],
          },
          { at: NOW },
        ),
      ).rejects.toMatchObject({ reason: "SCOPE_NOT_CONTAINED" });
    });

    it("REFUSES a UNIT granter granting ORGANIZATION-wide", async () => {
      await expect(
        assertGrantable(
          {
            granter: { personId: locationManager },
            subjectPersonId: subject,
            proposals: [
              proposal({
                scopeType: "ORGANIZATION",
                scopeId: null,
                validUntil: null,
              }),
            ],
          },
          { at: NOW },
        ),
      ).rejects.toMatchObject({ reason: "SCOPE_NOT_CONTAINED" });
    });

    it("REFUSES a UNIT granter granting at another unit (UNIT is flat, D-121)", async () => {
      await expect(
        assertGrantable(
          {
            granter: { personId: locationManager },
            subjectPersonId: subject,
            proposals: [
              proposal({
                scopeType: "UNIT",
                scopeId: "unit_noordbad",
                validUntil: null,
              }),
            ],
          },
          { at: NOW },
        ),
      ).rejects.toMatchObject({ reason: "SCOPE_NOT_CONTAINED" });
    });

    it("ALLOWS a GROUP-scoped instructor to delegate a SESSION on their own group (D-068's aftest case)", async () => {
      const instructor = await createPerson("grant_instructor");
      const assessRole = await createRole("grant_role_assess", [
        "exams.assess",
      ]);
      await grant({
        personId: instructor,
        roleId: assessRole,
        scopeType: "GROUP",
        scopeId: "group_a1",
      });

      await expect(
        assertGrantable(
          {
            granter: { personId: instructor },
            subjectPersonId: subject,
            proposals: [
              proposal({
                permission: "exams.assess",
                scopeType: "SESSION",
                scopeId: "session_thu",
                validFrom: new Date("2026-05-13T00:00:00Z"),
                validUntil: new Date("2026-05-16T00:00:00Z"),
              }),
            ],
          },
          { at: NOW },
        ),
      ).resolves.toBeUndefined();
    });

    it("REFUSES when the containment question cannot be answered at all", async () => {
      // §1.1 rule 2: a question without an answer is a denial, never a pass.
      resetScopeRelations();
      try {
        await expect(
          assertGrantable(
            {
              granter: { personId: locationManager },
              subjectPersonId: subject,
              proposals: [proposal({ scopeId: "course_zuidbad_only" })],
            },
            { at: NOW },
          ),
        ).rejects.toMatchObject({ reason: "UNRESOLVABLE" });
      } finally {
        configureScopeRelations(relationsFor(world));
      }
    });
  });

  // ── Invariant 3 and the ceiling (D-170) ───────────────────────────────────

  describe("window confinement and the ceiling", () => {
    it("REFUSES a window that outlives the granter's own", async () => {
      await grant({
        personId: locationManager,
        roleId: examsRole,
        scopeType: "COURSE",
        scopeId: "course_diploma_b",
        validFrom: new Date("2026-05-01T00:00:00Z"),
        validUntil: new Date("2026-05-20T00:00:00Z"),
      });

      await expect(
        assertGrantable(
          {
            granter: { personId: locationManager },
            subjectPersonId: subject,
            proposals: [
              proposal({ validUntil: new Date("2026-06-30T00:00:00Z") }),
            ],
          },
          { at: NOW },
        ),
      ).rejects.toMatchObject({ reason: "WINDOW_NOT_CONTAINED" });
    });

    it("REFUSES a STANDING grant issued by a granter whose own window is bounded", async () => {
      await grant({
        personId: locationManager,
        roleId: examsRole,
        scopeType: "UNIT",
        scopeId: "unit_zuidbad",
        validFrom: new Date("2026-05-01T00:00:00Z"),
        validUntil: new Date("2026-05-20T00:00:00Z"),
      });

      await expect(
        assertGrantable(
          {
            granter: { personId: locationManager },
            subjectPersonId: subject,
            proposals: [
              proposal({
                scopeType: "UNIT",
                scopeId: "unit_zuidbad",
                validUntil: null,
              }),
            ],
          },
          { at: NOW },
        ),
      ).rejects.toMatchObject({ reason: "WINDOW_NOT_CONTAINED" });
    });

    it("BINDS the null-window administrator to the SESSION ceiling anyway (F-139)", async () => {
      // Invariant 3 was vacuous for exactly the granters who matter: D-144
      // permits a null validUntil for every ORGANIZATION-scoped administrator,
      // and a null window contains every window — so `2099-12-31` passed, which
      // is what a mandatory date field with no ceiling collects on a form filled
      // in under time pressure.
      await grant({
        personId: administrator,
        roleId: adminRole,
        scopeType: "ORGANIZATION",
      });

      const sessionAt = world.sessionDate.get("session_thu") as Date;
      const sevenDaysPast = new Date(sessionAt.getTime() + 7 * 86_400_000);

      await expect(
        assertGrantable(
          {
            granter: { personId: administrator },
            subjectPersonId: subject,
            proposals: [
              proposal({
                scopeType: "SESSION",
                scopeId: "session_thu",
                validFrom: new Date("2026-05-13T00:00:00Z"),
                validUntil: new Date("2099-12-31T00:00:00Z"),
              }),
            ],
          },
          { at: NOW },
        ),
      ).rejects.toMatchObject({ reason: "WINDOW_CEILING_EXCEEDED" });

      // Exactly at the ceiling is fine — the +7 days is D-068's "short window
      // around it for preparation and follow-up" made numeric.
      await expect(
        assertGrantable(
          {
            granter: { personId: administrator },
            subjectPersonId: subject,
            proposals: [
              proposal({
                scopeType: "SESSION",
                scopeId: "session_thu",
                validFrom: new Date("2026-05-13T00:00:00Z"),
                validUntil: sevenDaysPast,
              }),
            ],
          },
          { at: NOW },
        ),
      ).resolves.toBeUndefined();
    });

    it("REFUSES a SESSION grant whose referent has no resolvable date", async () => {
      await grant({
        personId: administrator,
        roleId: adminRole,
        scopeType: "ORGANIZATION",
      });
      await expect(
        assertGrantable(
          {
            granter: { personId: administrator },
            subjectPersonId: subject,
            proposals: [
              proposal({
                scopeType: "SESSION",
                scopeId: "session_that_does_not_exist",
                validUntil: new Date("2026-05-20T00:00:00Z"),
              }),
            ],
          },
          { at: NOW },
        ),
      ).rejects.toMatchObject({ reason: "UNRESOLVABLE" });
    });
  });

  // ── Malformed proposals ───────────────────────────────────────────────────

  it("REFUSES a SESSION proposal with no validUntil before consulting anything", async () => {
    await expect(
      assertGrantable(
        {
          granter: { personId: administrator },
          subjectPersonId: subject,
          proposals: [
            proposal({
              scopeType: "SESSION",
              scopeId: "session_thu",
              validUntil: null,
            }),
          ],
        },
        { at: NOW },
      ),
    ).rejects.toMatchObject({ reason: "MALFORMED_PROPOSAL" });
  });

  it("REFUSES an ORGANIZATION proposal that names a scopeId", async () => {
    await expect(
      assertGrantable(
        {
          granter: { personId: administrator },
          subjectPersonId: subject,
          proposals: [
            proposal({
              scopeType: "ORGANIZATION",
              scopeId: "unit_zuidbad",
              validUntil: null,
            }),
          ],
        },
        { at: NOW },
      ),
    ).rejects.toBeInstanceOf(GrantRefusedError);
  });

  it("refuses the WHOLE bundle when one proposal fails — an access group is all or nothing (§2.7)", async () => {
    await grant({
      personId: locationManager,
      roleId: examsRole,
      scopeType: "UNIT",
      scopeId: "unit_zuidbad",
    });

    await expect(
      assertGrantable(
        {
          granter: { personId: locationManager },
          subjectPersonId: subject,
          proposals: [
            // Legitimate.
            proposal({ scopeId: "course_zuidbad_only" }),
            // Not: it crosses into Noordbad.
            proposal({ scopeId: "course_diploma_b" }),
          ],
        },
        { at: NOW },
      ),
    ).rejects.toMatchObject({ reason: "SCOPE_NOT_CONTAINED" });
  });
});
