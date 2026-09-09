import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/database";
import { ORGANIZATION_ID, getPublicOrganizationConfig } from "@/lib/settings";

/**
 * The organisation singleton against a REAL Postgres (D-027, D-056).
 *
 * SplashTrack is one organisation per installation. Phase 0.3 removed the
 * tenant boundary on that basis — every `organizationId` column, every
 * organisation-scoped foreign key, the platform role layer — so "there is
 * exactly one organisation" stopped being an assumption the code could hold
 * loosely and became the premise the rest of the schema rests on.
 *
 * A premise that load-bearing may not be a CONVENTION. `ORGANIZATION_ID` is a
 * constant some code imports; that constrains code that imports it and nothing
 * else. What this suite asserts is that the DATABASE refuses a second
 * organisation, so a future author who writes `prisma.organization.create()`
 * without reading a doc comment gets an error rather than a second tenant.
 *
 * Both refusal paths are covered, because they are enforced by two different
 * mechanisms and a change could plausibly remove either:
 *   - A DIFFERENT id violates the `Organization_singleton_check` CHECK
 *     constraint, hand-written in the merge migration because the Prisma DSL
 *     cannot express one. It is invisible in `schema.prisma`, which is exactly
 *     why it needs a test naming it.
 *   - THE SAME id violates the primary key.
 *
 * Remove one of those and half of this file goes red. That is the point.
 */

describe("organization singleton (real database)", () => {
  beforeEach(async () => {
    // The lazy read path creates the row if it is absent. Using it rather than
    // a raw insert also asserts the production code agrees with the constraint.
    await getPublicOrganizationConfig();
  });

  it("holds exactly one row, keyed by the constant", async () => {
    const rows = await prisma.organization.findMany({ select: { id: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(ORGANIZATION_ID);
  });

  it("REFUSES a second organisation with a different id (CHECK constraint)", async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "Organization" ("id", "name", "updatedAt") VALUES ($1, $2, NOW())`,
        "second_organization",
        "Another Swim Club",
      ),
    ).rejects.toThrow(
      /Organization_singleton_check|violates check constraint/i,
    );

    await expect(prisma.organization.count()).resolves.toBe(1);
  });

  it("REFUSES a second organisation reusing the constant id (primary key)", async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "Organization" ("id", "name", "updatedAt") VALUES ($1, $2, NOW())`,
        ORGANIZATION_ID,
        "Another Swim Club",
      ),
    ).rejects.toThrow(/duplicate key|unique constraint/i);

    await expect(prisma.organization.count()).resolves.toBe(1);
  });

  it("REFUSES a second organisation created through the Prisma client", async () => {
    // The path a future author is most likely to take, and the one no doc
    // comment protects. `id` defaults to the constant, so this collides on the
    // primary key without ever mentioning it.
    await expect(
      prisma.organization.create({ data: { name: "Another Swim Club" } }),
    ).rejects.toThrow();

    await expect(prisma.organization.count()).resolves.toBe(1);
  });
});
