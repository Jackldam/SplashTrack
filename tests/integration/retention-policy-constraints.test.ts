import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/database";

/**
 * `RetentionPolicy`'s three hand-written CHECK constraints
 * (`prisma/migrations/20260903132751_retention_policy_per_data_class/migration.sql`),
 * invisible in `schema.prisma` for the same reason
 * `role-assignment-constraints.test.ts` names one: the Prisma DSL cannot
 * express a CHECK, so a future "regenerate the migrations" tidy-up could lose
 * one silently. This file names each so that losing one goes red here.
 *
 * The one that matters most: `RetentionPolicy_anonymise_requires_aggregate_check`
 * is D-155 made mechanical. D-155 exists because the design itself once
 * prescribed `ANONYMISE` for attendance by stripping a foreign key while
 * keeping enough context to re-identify most of the stripped rows by a join —
 * pseudonymisation wearing anonymisation's name. This constraint is what would
 * have caught that: a policy cannot claim `ANONYMISE` by merely deleting
 * columns from a live row ("a row-level scrub") — it must NAME a pre-computed
 * aggregate, and naming one you have not built is a lie a reviewer can at
 * least go looking for.
 */

const CLASS_ID = "AUDIT_EVENTS" as const; // any DataClass value; PK collision is the only constraint on the choice
const CONFIRMER_IDS = ["test_rp_confirmer", "test_rp_confirmer_erasure"];

async function cleanup(): Promise<void> {
  await prisma.retentionPolicy.deleteMany({ where: { dataClass: CLASS_ID } });
  await prisma.person.deleteMany({ where: { id: { in: CONFIRMER_IDS } } });
}

/** A row with every required column, overridable per test. */
function policy(overrides: Record<string, unknown> = {}) {
  return {
    dataClass: CLASS_ID,
    purpose: "Test policy",
    proposedLawfulBasis: "LEGITIMATE_INTEREST" as const,
    trigger: "EVENT_DATE" as const,
    onExpiry: "REVIEW" as const,
    ...overrides,
  };
}

describe("RetentionPolicy database constraints (real database)", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  describe("ANONYMISE requires a named aggregate (D-155)", () => {
    it("REFUSES ANONYMISE with no anonymisedAggregate — a row-level scrub is not anonymisation", async () => {
      await expect(
        prisma.retentionPolicy.create({
          data: policy({ onExpiry: "ANONYMISE" }),
        }),
      ).rejects.toThrow(
        /RetentionPolicy_anonymise_requires_aggregate_check|check constraint/i,
      );
    });

    it("accepts ANONYMISE when a pre-computed aggregate is named", async () => {
      await expect(
        prisma.retentionPolicy.create({
          data: policy({
            onExpiry: "ANONYMISE",
            anonymisedAggregate: "monthly_attendance_rate_by_group",
          }),
        }),
      ).resolves.toBeTruthy();
    });

    it("accepts DELETE and REVIEW with no aggregate named", async () => {
      await expect(
        prisma.retentionPolicy.create({ data: policy({ onExpiry: "DELETE" }) }),
      ).resolves.toBeTruthy();
      await cleanup();
      await expect(
        prisma.retentionPolicy.create({ data: policy({ onExpiry: "REVIEW" }) }),
      ).resolves.toBeTruthy();
    });
  });

  describe("confirmation shape — all three confirmation columns, or none (F-27)", () => {
    it("accepts an unconfirmed policy (all three null — the correct shipped default)", async () => {
      await expect(
        prisma.retentionPolicy.create({ data: policy() }),
      ).resolves.toBeTruthy();
    });

    it("REFUSES a lawful basis with no confirmedAt / confirmedByPersonId", async () => {
      await expect(
        prisma.retentionPolicy.create({
          data: policy({ confirmedLawfulBasis: "LEGITIMATE_INTEREST" }),
        }),
      ).rejects.toThrow(
        /RetentionPolicy_confirmation_shape_check|check constraint/i,
      );
    });

    it("REFUSES confirmedLawfulBasis: UNRESOLVED — 'we confirm we have not decided' is not a confirmation", async () => {
      await expect(
        prisma.retentionPolicy.create({
          data: policy({
            confirmedLawfulBasis: "UNRESOLVED",
            confirmedAt: new Date(),
          }),
        }),
      ).rejects.toThrow(
        /RetentionPolicy_confirmation_shape_check|check constraint/i,
      );
    });

    it("accepts a fully confirmed policy — all three columns set together", async () => {
      const person = await prisma.person.create({
        data: {
          id: "test_rp_confirmer",
          givenName: "Retention",
          familyName: "Confirmer",
        },
      });
      await expect(
        prisma.retentionPolicy.create({
          data: policy({
            confirmedLawfulBasis: "LEGITIMATE_INTEREST",
            confirmedAt: new Date(),
            confirmedByPersonId: person.id,
          }),
        }),
      ).resolves.toBeTruthy();
      await prisma.person.delete({ where: { id: person.id } });
    });
  });

  describe("retainForDays is positive when stated (a zero would mean 'delete on write')", () => {
    it("REFUSES retainForDays: 0", async () => {
      await expect(
        prisma.retentionPolicy.create({ data: policy({ retainForDays: 0 }) }),
      ).rejects.toThrow(/RetentionPolicy_retain_for_check|check constraint/i);
    });

    it("REFUSES a negative retainForDays", async () => {
      await expect(
        prisma.retentionPolicy.create({ data: policy({ retainForDays: -1 }) }),
      ).rejects.toThrow(/RetentionPolicy_retain_for_check|check constraint/i);
    });

    it("accepts a null retainForDays ('as long as needed for the purpose')", async () => {
      await expect(
        prisma.retentionPolicy.create({
          data: policy({ retainForDays: null }),
        }),
      ).resolves.toBeTruthy();
    });

    it("accepts a positive retainForDays", async () => {
      await expect(
        prisma.retentionPolicy.create({
          data: policy({ retainForDays: 365 }),
        }),
      ).resolves.toBeTruthy();
    });
  });

  it("SEVERS the confirmer pointer rather than blocking the confirmer's erasure", async () => {
    const person = await prisma.person.create({
      data: {
        id: "test_rp_confirmer_erasure",
        givenName: "Retention",
        familyName: "Confirmer",
      },
    });
    await prisma.retentionPolicy.create({
      data: policy({
        confirmedLawfulBasis: "LEGITIMATE_INTEREST",
        confirmedAt: new Date(),
        confirmedByPersonId: person.id,
      }),
    });

    await prisma.person.delete({ where: { id: person.id } });

    const after = await prisma.retentionPolicy.findUnique({
      where: { dataClass: CLASS_ID },
    });
    expect(after).not.toBeNull();
    expect(after?.confirmedByPersonId).toBeNull();
    // The sever, not a cascade: the policy row and its confirmation SURVIVE —
    // only the identity pointer is nulled (SEVER_AND_RETAIN, F-27's "a
    // confirmation stands after its confirmer leaves").
    expect(after?.confirmedLawfulBasis).toBe("LEGITIMATE_INTEREST");
  });
});
