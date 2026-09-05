import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/database";
import {
  resolveLastRelationshipEnd,
  roleAssignmentSource,
} from "@/lib/retention/last-relationship";
import {
  ensurePeopleRegistrations,
  membershipPeriodSource,
} from "@/modules/people";

/**
 * D-066's concrete sources against a REAL Postgres.
 *
 * PHASE 1.1 REPLACED THE MEMBERSHIP SOURCE. The original `membershipSource`
 * could only say "a row exists, so held" — `Membership` had no period columns
 * to date an ending from, and its own doc comment named this replacement as the
 * `people` module's work. `membershipPeriodSource` reads real intervals
 * (D-059), so a departed member is now a DATED ending rather than `undefined`,
 * and that is what this file asserts.
 *
 * `resolveLastRelationshipEnd()` with no explicit source list reads the
 * REGISTRY, so `ensurePeopleRegistrations()` is what puts the three
 * people-module sources in it. Without that call the composed assertions below
 * would silently be testing `RoleAssignment` alone.
 *
 * The guardian sources have their own file
 * (`tests/integration/people-relationship-retention.test.ts`), which proves
 * D-066's composability against real rows for the first time — until phase 1.1
 * it could only be proven against fakes.
 */

const PERSON_ID = "test_lastrel_person";
const ROLE_ID = "test_lastrel_role";

async function cleanup(): Promise<void> {
  await prisma.roleAssignment.deleteMany({ where: { personId: PERSON_ID } });
  await prisma.membershipPeriod.deleteMany({
    where: { membership: { personId: PERSON_ID } },
  });
  await prisma.membership.deleteMany({ where: { personId: PERSON_ID } });
  await prisma.role.deleteMany({ where: { id: ROLE_ID } });
  await prisma.person.deleteMany({ where: { id: PERSON_ID } });
}

describe("D-066 relationship sources (real database)", () => {
  beforeEach(async () => {
    ensurePeopleRegistrations();
    await cleanup();
    await prisma.person.create({
      data: { id: PERSON_ID, givenName: "Last", familyName: "Relationship" },
    });
    await prisma.role.create({
      data: { id: ROLE_ID, key: "test.last_relationship", name: "Test role" },
    });
  });

  afterEach(cleanup);

  describe("membershipPeriodSource", () => {
    it("reports undefined when the person has never had a Membership row", async () => {
      await expect(
        membershipPeriodSource.resolve(PERSON_ID),
      ).resolves.toBeUndefined();
    });

    it("reports held while a period is OPEN", async () => {
      await prisma.membership.create({
        data: {
          personId: PERSON_ID,
          memberNumber: "M-lastrel-1",
          periods: { create: { startedAt: new Date("2024-01-01T00:00:00Z") } },
        },
      });
      await expect(membershipPeriodSource.resolve(PERSON_ID)).resolves.toEqual({
        held: true,
      });
    });

    it("DATES the ending once every period is closed — the thing the old source could not do", async () => {
      const first = new Date("2024-06-01T00:00:00Z");
      const last = new Date("2026-02-01T00:00:00Z");
      await prisma.membership.create({
        data: {
          personId: PERSON_ID,
          memberNumber: "M-lastrel-2",
          periods: {
            create: [
              { startedAt: new Date("2023-01-01T00:00:00Z"), endedAt: first },
              { startedAt: new Date("2025-01-01T00:00:00Z"), endedAt: last },
            ],
          },
        },
      });
      // The LAST relationship, not the first: D-066's whole aggregation rule,
      // applied within one source across a leave-and-return.
      await expect(membershipPeriodSource.resolve(PERSON_ID)).resolves.toEqual({
        held: false,
        endedAt: last,
      });
    });

    it("reports undefined for a register entry with no interval of belonging at all", async () => {
      await prisma.membership.create({
        data: { personId: PERSON_ID, memberNumber: "M-lastrel-3" },
      });
      // The row exists and no period ever did, so this source cannot date an
      // ending it never saw — `undefined`, honestly, rather than inventing one.
      await expect(
        membershipPeriodSource.resolve(PERSON_ID),
      ).resolves.toBeUndefined();
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

  describe("resolveLastRelationshipEnd, composed over the registered sources", () => {
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
      // RoleAssignment alone has expired, but an OPEN membership period still
      // holds them — the LAST relationship of any kind has not ended.
      await prisma.membership.create({
        data: {
          personId: PERSON_ID,
          memberNumber: "M-lastrel-4",
          periods: { create: { startedAt: new Date("2023-01-01T00:00:00Z") } },
        },
      });

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
