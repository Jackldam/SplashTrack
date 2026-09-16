import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { PermissionDeniedError } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import {
  listActiveGuardiansForStudent,
  type ActorContext,
} from "@/modules/people";

import { emptyWorld } from "../support/authorization-fixtures";
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
 * D-090's automatic payer default — `listActiveGuardiansForStudent`
 * (`src/modules/people/application/relationship-service.ts`).
 *
 * This function states FACTS ONLY — zero, one or several active `GUARDIAN_OF`
 * relatives — and deliberately does not decide what "unambiguous" means. The
 * fees charge form is what turns "exactly one" into a preselection; that
 * decision has its own coverage in `tests/e2e/fees.spec.ts`. What belongs
 * here is that the LIST itself is right: administratively active only, never
 * the D-151 consent-authority derivation, and guarded on the subject exactly
 * like every other read in this module.
 */

const NOW = new Date("2026-05-12T18:30:00Z");

function actorFor(personId: string): ActorContext {
  return { principal: { personId }, at: NOW };
}

async function guardianOf(
  relativeId: string,
  subjectId: string,
  window: { validFrom?: Date; validTo?: Date | null } = {},
): Promise<void> {
  await prisma.personRelationship.create({
    data: {
      fromPersonId: relativeId,
      toPersonId: subjectId,
      type: "GUARDIAN_OF",
      validFrom: window.validFrom ?? new Date("2020-01-01T00:00:00Z"),
      validTo: window.validTo ?? null,
    },
  });
}

async function emergencyContactOf(
  relativeId: string,
  subjectId: string,
): Promise<void> {
  await prisma.personRelationship.create({
    data: {
      fromPersonId: relativeId,
      toPersonId: subjectId,
      type: "EMERGENCY_CONTACT",
      validFrom: new Date("2020-01-01T00:00:00Z"),
    },
  });
}

async function studentProfileIdOf(personId: string): Promise<string> {
  const profile = await prisma.studentProfile.findUniqueOrThrow({
    where: { personId },
    select: { id: true },
  });
  return profile.id;
}

let admin: string;

describe("listActiveGuardiansForStudent — D-090's automatic payer default", () => {
  beforeEach(async () => {
    await resetPeopleFixtures();
    installRelations(emptyWorld());

    admin = await makePerson("gc_admin");
    const role = await makeRole("gc_role_admin", [...PEOPLE_ADMIN_PERMISSIONS]);
    await grantTo({ personId: admin, roleId: role, scopeType: "ORGANIZATION" });
  });

  afterAll(resetPeopleFixtures);

  it("zero active guardians — no default is possible", async () => {
    const child = await makePerson("gc_child_none", { studentOfUnit: null });
    const studentProfileId = await studentProfileIdOf(child);

    const result = await listActiveGuardiansForStudent(
      actorFor(admin),
      studentProfileId,
    );

    expect(result).toEqual([]);
  });

  it("exactly one active guardian — the unambiguous case", async () => {
    const child = await makePerson("gc_child_one", { studentOfUnit: null });
    const guardian = await makePerson("gc_guardian_one");
    await guardianOf(guardian, child);
    const studentProfileId = await studentProfileIdOf(child);

    const result = await listActiveGuardiansForStudent(
      actorFor(admin),
      studentProfileId,
    );

    expect(result).toEqual([
      {
        id: guardian,
        givenName: "Fixture",
        familyName: "gc_guardian_one",
      },
    ]);
  });

  it("two active guardians — ambiguous, both are returned and neither is chosen here", async () => {
    const child = await makePerson("gc_child_two", { studentOfUnit: null });
    const guardianA = await makePerson("gc_guardian_two_a");
    const guardianB = await makePerson("gc_guardian_two_b");
    await guardianOf(guardianA, child);
    await guardianOf(guardianB, child);
    const studentProfileId = await studentProfileIdOf(child);

    const result = await listActiveGuardiansForStudent(
      actorFor(admin),
      studentProfileId,
    );

    expect(result.map((g) => g.id).sort()).toEqual(
      [guardianA, guardianB].sort(),
    );
  });

  it("a relationship the school recorded as ENDED is excluded", async () => {
    const child = await makePerson("gc_child_ended", { studentOfUnit: null });
    const formerGuardian = await makePerson("gc_guardian_ended");
    await guardianOf(formerGuardian, child, {
      validTo: new Date("2025-01-01T00:00:00Z"),
    });
    const studentProfileId = await studentProfileIdOf(child);

    const result = await listActiveGuardiansForStudent(
      actorFor(admin),
      studentProfileId,
    );

    expect(result).toEqual([]);
  });

  it("a relationship that has not started yet is excluded", async () => {
    const child = await makePerson("gc_child_future", { studentOfUnit: null });
    const futureGuardian = await makePerson("gc_guardian_future");
    await guardianOf(futureGuardian, child, {
      validFrom: new Date("2030-01-01T00:00:00Z"),
    });
    const studentProfileId = await studentProfileIdOf(child);

    const result = await listActiveGuardiansForStudent(
      actorFor(admin),
      studentProfileId,
    );

    expect(result).toEqual([]);
  });

  it("an EMERGENCY_CONTACT relationship is never counted as a guardian", async () => {
    const child = await makePerson("gc_child_ec", { studentOfUnit: null });
    const contact = await makePerson("gc_contact_ec");
    await emergencyContactOf(contact, child);
    const studentProfileId = await studentProfileIdOf(child);

    const result = await listActiveGuardiansForStudent(
      actorFor(admin),
      studentProfileId,
    );

    expect(result).toEqual([]);
  });

  it("a StudentProfile id that does not exist yields an empty list, not a denial", async () => {
    const result = await listActiveGuardiansForStudent(
      actorFor(admin),
      "gc_no_such_student_profile",
    );

    expect(result).toEqual([]);
  });

  // ── scope escape ──────────────────────────────────────────────────────────

  it("a UNIT-scoped principal outside the pupil's unit is DENIED — never an empty list", async () => {
    const zuidbad = await makeUnit("gc_unit_zuid");
    const noordbad = await makeUnit("gc_unit_noord");

    // UNIT coverage of a `{ person }` resource reads the MEMBERSHIP unit
    // (`covers-resource.ts`'s own `unitOfPerson`, not `homeUnitOfStudent`) —
    // so the child needs a membership in Noordbad, not only a pupil record
    // there, for a Zuidbad-scoped grant to genuinely be the wrong unit rather
    // than "no unit at all".
    const child = await makePerson("gc_scope_child", {
      memberOfUnit: noordbad,
      studentOfUnit: noordbad,
    });
    const guardian = await makePerson("gc_scope_guardian");
    await guardianOf(guardian, child);
    const studentProfileId = await studentProfileIdOf(child);

    const outsider = await makePerson("gc_scope_outsider");
    const readerRole = await makeRole("gc_role_reader", ["people.read"]);
    await grantTo({
      personId: outsider,
      roleId: readerRole,
      scopeType: "UNIT",
      scopeId: zuidbad,
    });

    await expect(
      listActiveGuardiansForStudent(actorFor(outsider), studentProfileId),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("no grant at all is DENIED outright", async () => {
    const child = await makePerson("gc_scope_nogrant_child", {
      studentOfUnit: null,
    });
    const guardian = await makePerson("gc_scope_nogrant_guardian");
    await guardianOf(guardian, child);
    const studentProfileId = await studentProfileIdOf(child);

    const outsider = await makePerson("gc_scope_nogrant_outsider");

    await expect(
      listActiveGuardiansForStudent(actorFor(outsider), studentProfileId),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
