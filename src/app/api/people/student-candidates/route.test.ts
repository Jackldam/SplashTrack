import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  assignInstructorTo,
  grantTo,
  installRealRelations,
  makeGroup,
  makePerson,
  makeRole,
  makeStudent,
  placeInGroup,
  resetAttendanceFixtures,
} from "../../../../../tests/support/attendance-fixtures";
import { searchStudentCandidates } from "./route";

/**
 * A light test for the Route Handler wiring, NOT a second scope-escape
 * suite — `tests/integration/student-candidates-scope.test.ts` already owns
 * proving `listStudentCandidatesForPrincipal` is scope-correct, and this
 * route calls that same, unchanged function. What is new here is the
 * mapping onto the picker's flat `{ id, label, sublabel }` response shape,
 * and that a `PermissionDeniedError` becomes `{ ok: false, permission }`
 * rather than propagating — both of which only this file's code performs.
 */

const NOW = new Date("2026-03-10T18:00:00.000Z");

function actorFor(personId: string) {
  return { principal: { personId }, at: NOW };
}

beforeAll(() => {
  installRealRelations();
});

beforeEach(async () => {
  await resetAttendanceFixtures();
});

afterAll(async () => {
  await resetAttendanceFixtures();
});

describe("searchStudentCandidates", () => {
  it("maps a reachable pupil onto the picker's flat result shape", async () => {
    const group = await makeGroup("route_g");
    const pupil = await makeStudent("route_pupil");
    await placeInGroup(group, pupil.studentProfileId);

    const instructorId = await makePerson("route_instr");
    await assignInstructorTo(group, instructorId);
    const roleId = await makeRole("route_role", ["students.read"]);
    await grantTo({
      personId: instructorId,
      roleId,
      scopeType: "GROUP",
      scopeId: group,
    });

    const result = await searchStudentCandidates(
      actorFor(instructorId),
      "route_pupil",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.results).toEqual([
      {
        id: pupil.studentProfileId,
        label: expect.stringContaining("route_pupil"),
        sublabel: expect.stringContaining("route_pupil"),
      },
    ]);
  });

  it("turns a reach covering no pupil into a denial, not a throw", async () => {
    const outsiderId = await makePerson("route_outsider");

    const result = await searchStudentCandidates(actorFor(outsiderId), "");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected denied");
    expect(result.permission).toBe("students.read");
  });
});
