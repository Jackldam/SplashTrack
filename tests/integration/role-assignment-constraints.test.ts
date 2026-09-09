import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/database";

/**
 * The grant tuple's database constraints (D-144 as completed by D-170, D-147).
 *
 * Every one of these is HAND-WRITTEN in
 * `prisma/migrations/20260903130526_scope_and_validity_on_grants/migration.sql`
 * because the Prisma DSL can express none of them: three CHECK constraints and
 * one PARTIAL unique index with `NULLS NOT DISTINCT`. They are therefore
 * invisible in `schema.prisma` and would vanish silently in a future
 * "regenerate the migrations" tidy-up — the same hazard
 * `organization-singleton.test.ts` exists for. This file names each constraint
 * so that losing one goes red here rather than in production data.
 *
 * What each one is protecting:
 *   - scope shape: a grant naming `UNIT` with no `scopeId` would read as
 *     "every unit" to a coverage rule that tests membership of a list.
 *   - bounded window: without it, the external examiner who assessed one
 *     Saturday in March keeps `exams.results.record` on that session forever,
 *     and D-062's append-only results make an amendment years later the
 *     effective outcome. F-113.
 *   - window order: a `validUntil <= validFrom` grant is a data-entry accident
 *     that reads as a silently dead grant rather than as an error.
 *   - standing-grant uniqueness: duplicate open-ended grants are noise;
 *     overlapping BOUNDED grants are legitimate history and must stay possible,
 *     which is why the index is partial rather than total.
 */

const SUBJECT_ID = "test_ra_subject";
const GRANTER_ID = "test_ra_granter";
const ROLE_ID = "test_ra_role";

async function cleanup(): Promise<void> {
  await prisma.roleAssignment.deleteMany({
    where: { personId: { in: [SUBJECT_ID, GRANTER_ID] } },
  });
  await prisma.role.deleteMany({ where: { id: ROLE_ID } });
  await prisma.person.deleteMany({
    where: { id: { in: [SUBJECT_ID, GRANTER_ID] } },
  });
}

/** A grant row with every required column, overridable per test. */
function grant(overrides: Record<string, unknown> = {}) {
  return {
    personId: SUBJECT_ID,
    roleId: ROLE_ID,
    scopeType: "ORGANIZATION" as const,
    scopeId: null,
    validFrom: new Date("2026-01-01T00:00:00Z"),
    validUntil: null,
    ...overrides,
  };
}

describe("RoleAssignment database constraints (real database)", () => {
  beforeEach(async () => {
    await cleanup();
    await prisma.person.createMany({
      data: [
        { id: SUBJECT_ID, givenName: "Scope", familyName: "Subject" },
        { id: GRANTER_ID, givenName: "Scope", familyName: "Granter" },
      ],
    });
    await prisma.role.create({
      data: { id: ROLE_ID, key: "test.scope_constraints", name: "Test role" },
    });
  });

  afterEach(cleanup);

  describe("scope shape — scopeId is NULL exactly for ORGANIZATION and SELF", () => {
    it("accepts ORGANIZATION with no scopeId", async () => {
      await expect(
        prisma.roleAssignment.create({ data: grant() }),
      ).resolves.toBeTruthy();
    });

    it("accepts SELF with no scopeId (the holder is `personId`, D-146)", async () => {
      await expect(
        prisma.roleAssignment.create({ data: grant({ scopeType: "SELF" }) }),
      ).resolves.toBeTruthy();
    });

    it("REFUSES ORGANIZATION carrying a scopeId", async () => {
      await expect(
        prisma.roleAssignment.create({
          data: grant({ scopeId: "unit_zuidbad" }),
        }),
      ).rejects.toThrow(/RoleAssignment_scope_shape_check|check constraint/i);
    });

    it("REFUSES UNIT with no scopeId — it would read as 'every unit'", async () => {
      await expect(
        prisma.roleAssignment.create({ data: grant({ scopeType: "UNIT" }) }),
      ).rejects.toThrow(/RoleAssignment_scope_shape_check|check constraint/i);
    });

    it("REFUSES GROUP with no scopeId", async () => {
      await expect(
        prisma.roleAssignment.create({ data: grant({ scopeType: "GROUP" }) }),
      ).rejects.toThrow(/RoleAssignment_scope_shape_check|check constraint/i);
    });
  });

  describe("bounded window — SESSION and COURSE must carry a validUntil", () => {
    it("REFUSES a SESSION grant with no validUntil (D-144, schema-level)", async () => {
      await expect(
        prisma.roleAssignment.create({
          data: grant({ scopeType: "SESSION", scopeId: "session_thursday" }),
        }),
      ).rejects.toThrow(
        /RoleAssignment_bounded_window_check|check constraint/i,
      );
    });

    it("REFUSES a COURSE grant with no validUntil (D-170's ceiling table)", async () => {
      await expect(
        prisma.roleAssignment.create({
          data: grant({ scopeType: "COURSE", scopeId: "course_diploma_b" }),
        }),
      ).rejects.toThrow(
        /RoleAssignment_bounded_window_check|check constraint/i,
      );
    });

    it("accepts a SESSION grant that carries one", async () => {
      await expect(
        prisma.roleAssignment.create({
          data: grant({
            scopeType: "SESSION",
            scopeId: "session_thursday",
            validUntil: new Date("2026-03-21T00:00:00Z"),
          }),
        }),
      ).resolves.toBeTruthy();
    });

    it("accepts a standing GROUP grant with no validUntil", async () => {
      await expect(
        prisma.roleAssignment.create({
          data: grant({ scopeType: "GROUP", scopeId: "group_a1" }),
        }),
      ).resolves.toBeTruthy();
    });
  });

  it("REFUSES a window that ends before it starts", async () => {
    await expect(
      prisma.roleAssignment.create({
        data: grant({
          scopeType: "SESSION",
          scopeId: "session_thursday",
          validFrom: new Date("2026-03-14T00:00:00Z"),
          validUntil: new Date("2026-03-13T00:00:00Z"),
        }),
      }),
    ).rejects.toThrow(/RoleAssignment_window_order_check|check constraint/i);
  });

  describe("standing-grant uniqueness (partial index, NULLS NOT DISTINCT)", () => {
    it("REFUSES a duplicate STANDING organisation-wide grant", async () => {
      await prisma.roleAssignment.create({ data: grant() });
      await expect(
        prisma.roleAssignment.create({ data: grant() }),
      ).rejects.toThrow(/RoleAssignment_standing_grant_key|unique/i);
    });

    it("ALLOWS two BOUNDED grants over the same person, role and scope", async () => {
      // The external examiner grades Diploma B in March and again in June.
      // A total unique key would have made the second one a database error on
      // an exam Saturday.
      await prisma.roleAssignment.create({
        data: grant({
          scopeType: "COURSE",
          scopeId: "course_diploma_b",
          validFrom: new Date("2026-03-01T00:00:00Z"),
          validUntil: new Date("2026-03-21T00:00:00Z"),
        }),
      });
      await expect(
        prisma.roleAssignment.create({
          data: grant({
            scopeType: "COURSE",
            scopeId: "course_diploma_b",
            validFrom: new Date("2026-06-01T00:00:00Z"),
            validUntil: new Date("2026-06-21T00:00:00Z"),
          }),
        }),
      ).resolves.toBeTruthy();
    });
  });

  it("SEVERS the granter pointer rather than blocking the granter's erasure", async () => {
    // The Article 17 rollback this shape exists to prevent: a Restrict FK with
    // no sever step rolled back a whole erasure in the template.
    const created = await prisma.roleAssignment.create({
      data: grant({ grantedByPersonId: GRANTER_ID }),
    });

    await prisma.person.delete({ where: { id: GRANTER_ID } });

    const after = await prisma.roleAssignment.findUnique({
      where: { id: created.id },
    });
    expect(after).not.toBeNull();
    expect(after?.grantedByPersonId).toBeNull();
  });
});
