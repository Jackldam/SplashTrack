import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/database";
import {
  membershipSource,
  resolveLastRelationshipEnd,
  roleAssignmentSource,
} from "@/lib/retention/last-relationship";

/**
 * D-066's concrete sources against a REAL Postgres: `Membership` (existence
 * only — no period columns exist yet, D-059) and `RoleAssignment` (a real
 * `validFrom`/`validUntil` window, D-144/D-170).
 *
 * The composable "a guardian is held while the child is held" behaviour is
 * proven separately, in `tests/unit/last-relationship.test.ts`, against fake
 * sources — there is no `PersonRelationship` table yet to test it against for
 * real (see `last-relationship.ts`'s own doc comment).
 */

const PERSON_ID = "test_lastrel_person";
const ROLE_ID = "test_lastrel_role";

async function cleanup(): Promise<void> {
  await prisma.roleAssignment.deleteMany({ where: { personId: PERSON_ID } });
  await prisma.membership.deleteMany({ where: { personId: PERSON_ID } });
  await prisma.role.deleteMany({ where: { id: ROLE_ID } });
  await prisma.person.deleteMany({ where: { id: PERSON_ID } });
}

describe("D-066 relationship sources (real database)", () => {
  beforeEach(async () => {
    await cleanup();
    await prisma.person.create({
      data: { id: PERSON_ID, givenName: "Last", familyName: "Relationship" },
    });
    await prisma.role.create({
      data: { id: ROLE_ID, key: "test.last_relationship", name: "Test role" },
    });
  });

  afterEach(cleanup);

  describe("membershipSource", () => {
    it("reports undefined when the person has never had a Membership row", async () => {
      await expect(
        membershipSource.resolve(PERSON_ID),
      ).resolves.toBeUndefined();
    });

    it("reports held while the Membership row exists", async () => {
      await prisma.membership.create({ data: { personId: PERSON_ID } });
      await expect(membershipSource.resolve(PERSON_ID)).resolves.toEqual({
        held: true,
      });
    });
  });

  describe("roleAssignmentSource", () => {
    it("reports undefined with no RoleAssignment rows", async () => {
      await expect(
        roleAssignmentSource.resolve(PERSON_ID),
      ).resolves.toBeUndefined();
    });

    it("reports held for a standing grant (validUntil null)", async () => {
      await prisma.roleAssignment.create({
        data: {
          personId: PERSON_ID,
          roleId: ROLE_ID,
          scopeType: "ORGANIZATION",
          validFrom: new Date("2020-01-01T00:00:00Z"),
        },
      });
      await expect(roleAssignmentSource.resolve(PERSON_ID)).resolves.toEqual({
        held: true,
      });
    });

    it("reports held for a bounded grant that has not yet expired", async () => {
      const farFuture = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);
      await prisma.roleAssignment.create({
        data: {
          personId: PERSON_ID,
          roleId: ROLE_ID,
          scopeType: "GROUP",
          scopeId: "group_still_open",
          validFrom: new Date("2020-01-01T00:00:00Z"),
          validUntil: farFuture,
        },
      });
      await expect(roleAssignmentSource.resolve(PERSON_ID)).resolves.toEqual({
        held: true,
      });
    });

    it("reports the LATEST validUntil once every grant has expired", async () => {
      const earlier = new Date("2024-01-01T00:00:00Z");
      const later = new Date("2024-06-01T00:00:00Z");
      await prisma.roleAssignment.createMany({
        data: [
          {
            personId: PERSON_ID,
            roleId: ROLE_ID,
            scopeType: "GROUP",
            scopeId: "group_a",
            validFrom: new Date("2023-01-01T00:00:00Z"),
            validUntil: earlier,
          },
          {
            personId: PERSON_ID,
            roleId: ROLE_ID,
            scopeType: "GROUP",
            scopeId: "group_b",
            validFrom: new Date("2023-06-01T00:00:00Z"),
            validUntil: later,
          },
        ],
      });
      await expect(roleAssignmentSource.resolve(PERSON_ID)).resolves.toEqual({
        held: false,
        endedAt: later,
      });
    });
  });

  describe("resolveLastRelationshipEnd, composed over both real sources", () => {
    it("held (undefined trigger date) while ANY source still holds the person", async () => {
      const past = new Date("2024-01-01T00:00:00Z");
      await prisma.roleAssignment.create({
        data: {
          personId: PERSON_ID,
          roleId: ROLE_ID,
          scopeType: "GROUP",
          scopeId: "group_a",
          validFrom: new Date("2023-01-01T00:00:00Z"),
          validUntil: past,
        },
      });
      // RoleAssignment alone has expired, but Membership still holds them —
      // the LAST relationship of any kind has not ended.
      await prisma.membership.create({ data: { personId: PERSON_ID } });

      await expect(resolveLastRelationshipEnd(PERSON_ID)).resolves.toEqual({
        held: true,
      });
    });

    it("reports undefined when no source has ever held the person", async () => {
      await expect(
        resolveLastRelationshipEnd(PERSON_ID),
      ).resolves.toBeUndefined();
    });
  });
});
