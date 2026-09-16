import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/database";

import { emptyWorld } from "../../../../../tests/support/authorization-fixtures";
import {
  grantTo,
  installRelations,
  makePerson,
  makeRole,
  resetPeopleFixtures,
} from "../../../../../tests/support/people-fixtures";
import { searchGuardianCandidates } from "./route";

/**
 * A light test for the Route Handler wiring, on `relative-candidates/
 * route.test.ts`'s own precedent — NOT a second copy of
 * `tests/integration/people-guardian-candidates.test.ts`, which already owns
 * proving `listActiveGuardiansForStudent` is scope-correct and states the
 * right facts. What is new here is the mapping onto the picker's flat
 * `{ id, label }` shape, and that a `PermissionDeniedError` becomes
 * `{ ok: false, permission }` rather than propagating.
 */

const NOW = new Date("2026-05-12T18:30:00Z");

function actorFor(personId: string) {
  return { principal: { personId }, at: NOW };
}

beforeEach(async () => {
  installRelations(emptyWorld());
  await resetPeopleFixtures();
});

afterAll(async () => {
  await resetPeopleFixtures();
});

describe("searchGuardianCandidates", () => {
  it("maps the one active guardian onto the picker's flat result shape", async () => {
    const child = await makePerson("route_gc_child", { studentOfUnit: null });
    const guardian = await makePerson("route_gc_guardian");
    await prisma.personRelationship.create({
      data: {
        fromPersonId: guardian,
        toPersonId: child,
        type: "GUARDIAN_OF",
        validFrom: new Date("2020-01-01T00:00:00Z"),
      },
    });
    const profile = await prisma.studentProfile.findUniqueOrThrow({
      where: { personId: child },
      select: { id: true },
    });

    const callerId = await makePerson("route_gc_caller");
    const roleId = await makeRole("route_gc_role", ["people.read"]);
    await grantTo({
      personId: callerId,
      roleId,
      scopeType: "ORGANIZATION",
    });

    const result = await searchGuardianCandidates(
      actorFor(callerId),
      profile.id,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.results).toEqual([
      { id: guardian, label: expect.stringContaining("route_gc_guardian") },
    ]);
  });

  it("turns a reach covering nobody into a denial, not a throw", async () => {
    const child = await makePerson("route_gc_child_denied", {
      studentOfUnit: null,
    });
    const guardian = await makePerson("route_gc_guardian_denied");
    await prisma.personRelationship.create({
      data: {
        fromPersonId: guardian,
        toPersonId: child,
        type: "GUARDIAN_OF",
        validFrom: new Date("2020-01-01T00:00:00Z"),
      },
    });
    const profile = await prisma.studentProfile.findUniqueOrThrow({
      where: { personId: child },
      select: { id: true },
    });

    const outsiderId = await makePerson("route_gc_outsider");

    const result = await searchGuardianCandidates(
      actorFor(outsiderId),
      profile.id,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected denied");
    expect(result.permission).toBe("people.read");
  });
});
