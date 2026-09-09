import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { emptyWorld } from "../../../../../tests/support/authorization-fixtures";
import {
  grantTo,
  installRelations,
  makePerson,
  makeRole,
  makeUnit,
  resetPeopleFixtures,
} from "../../../../../tests/support/people-fixtures";
import { searchRelativeCandidates } from "./route";

/**
 * A light test for the Route Handler wiring, NOT a second scope-escape suite
 * — `tests/integration/people-scope-escape.test.ts` already owns proving
 * `listPeopleForPrincipal` is scope-correct, and this route calls that same,
 * unchanged function. What is new here is the mapping onto the picker's flat
 * `{ id, label, sublabel }` response shape, and that a
 * `PermissionDeniedError` becomes `{ ok: false, permission }` rather than
 * propagating.
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

describe("searchRelativeCandidates", () => {
  it("maps a reachable person onto the picker's flat result shape", async () => {
    const unit = await makeUnit("route_unit");
    const relative = await makePerson("route_relative", {
      memberOfUnit: unit,
    });

    const callerId = await makePerson("route_caller", { memberOfUnit: unit });
    const roleId = await makeRole("route_role", ["people.read"]);
    await grantTo({
      personId: callerId,
      roleId,
      scopeType: "UNIT",
      scopeId: unit,
    });

    const result = await searchRelativeCandidates(
      actorFor(callerId),
      "route_relative",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.results).toEqual([
      {
        id: relative,
        label: expect.stringContaining("route_relative"),
        sublabel: undefined,
      },
    ]);
  });

  it("turns a reach covering nobody into a denial, not a throw", async () => {
    const outsiderId = await makePerson("route_outsider");

    const result = await searchRelativeCandidates(actorFor(outsiderId), "");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected denied");
    expect(result.permission).toBe("people.read");
  });
});
