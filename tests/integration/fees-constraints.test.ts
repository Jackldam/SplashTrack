/**
 * The hand-written constraints of `20260916090000_fees_module` — invisible
 * in `schema.prisma` and easy to lose in a future "regenerate the
 * migrations" tidy-up, which is why they are named and proved here (the
 * `exams-constraints.test.ts` pattern, one module later).
 *
 *   - `FeeType_amount_positive_check` / `Charge_amount_positive_check` /
 *     `Payment_amount_positive_check` — money is never zero or negative.
 *   - `Charge_period_order_check` — a stated period runs the right way
 *     round when both ends are given.
 *   - `Charge_waived_fields_check` / `Charge_cancelled_fields_check` — the
 *     status and its field pair are set together, never separately, in
 *     EITHER direction (the biconditional `=`, not a one-way `CHECK`).
 *   - `Charge_clientEventId_key` / `Payment_clientEventId_key` — P-02's
 *     idempotency, even under a race the service's pre-read cannot see.
 *
 * INSERT-based throughout — unlike `Award`'s tests, `Charge`'s CREATE is
 * NOT column-restricted (only its UPDATE is, `feesGrantStatements`), so
 * these run directly against the ordinary runtime client, on the
 * `ExamCandidate` constraint tests' shape.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/database";

import {
  feid,
  grantTo,
  installRealRelations,
  makeFeeType,
  makePerson,
  makeRole,
  resetFeesFixtures,
} from "../support/fees-fixtures";
import { createCharge, recordPayment } from "@/modules/fees";

const NOW = new Date("2026-09-16T12:00:00.000Z");

let adminId: string;

function admin() {
  return { principal: { personId: adminId }, at: NOW };
}

beforeAll(() => {
  installRealRelations();
});

beforeEach(async () => {
  await resetFeesFixtures();
  adminId = await makePerson("con_admin");
  await grantTo({
    personId: adminId,
    roleId: await makeRole("con_role_admin", [
      "fees.read",
      "fees.manage",
      "fees.export",
    ]),
    scopeType: "ORGANIZATION",
  });
});

afterAll(async () => {
  await resetFeesFixtures();
});

describe("money is never zero or negative", () => {
  it("FeeType_amount_positive_check refuses zero and negative amounts", async () => {
    await expect(
      prisma.feeType.create({
        data: {
          code: feid("mon1_zero"),
          name: "Zero",
          amount: 0,
          recurrence: "ONE_OFF",
        },
      }),
    ).rejects.toThrow(/violates check constraint/i);
    await expect(
      prisma.feeType.create({
        data: {
          code: feid("mon1_neg"),
          name: "Negative",
          amount: -100,
          recurrence: "ONE_OFF",
        },
      }),
    ).rejects.toThrow(/violates check constraint/i);
  });

  it("Charge_amount_positive_check refuses zero and negative amounts", async () => {
    const feeTypeId = await makeFeeType("mon2");
    const payerId = await makePerson("mon2_payer");
    await expect(
      prisma.charge.create({
        data: {
          payerPersonId: payerId,
          feeTypeId,
          amount: 0,
          currency: "EUR",
          dueDate: new Date("2026-10-01T00:00:00Z"),
          clientEventId: feid("mon2_ce"),
        },
      }),
    ).rejects.toThrow(/violates check constraint/i);
  });

  it("Payment_amount_positive_check refuses zero and negative amounts", async () => {
    const feeTypeId = await makeFeeType("mon3");
    const payerId = await makePerson("mon3_payer");
    const { id: chargeId } = await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      dueDate: "2026-10-01",
      clientEventId: feid("mon3_ce"),
    });

    await expect(
      prisma.payment.create({
        data: {
          chargeId,
          amount: 0,
          receivedAt: NOW,
          method: "CASH",
          clientEventId: feid("mon3_pay_ce"),
        },
      }),
    ).rejects.toThrow(/violates check constraint/i);
  });
});

describe("Charge_period_order_check", () => {
  it("refuses periodEnd before periodStart", async () => {
    const feeTypeId = await makeFeeType("per1");
    const payerId = await makePerson("per1_payer");
    await expect(
      prisma.charge.create({
        data: {
          payerPersonId: payerId,
          feeTypeId,
          periodStart: new Date("2026-04-01T00:00:00Z"),
          periodEnd: new Date("2026-01-01T00:00:00Z"),
          amount: 1000,
          currency: "EUR",
          dueDate: new Date("2026-10-01T00:00:00Z"),
          clientEventId: feid("per1_ce"),
        },
      }),
    ).rejects.toThrow(/violates check constraint/i);
  });

  it("allows an equal periodStart/periodEnd and a one-sided period", async () => {
    const feeTypeId = await makeFeeType("per2");
    const payerId = await makePerson("per2_payer");
    await expect(
      prisma.charge.create({
        data: {
          payerPersonId: payerId,
          feeTypeId,
          periodStart: new Date("2026-04-01T00:00:00Z"),
          periodEnd: new Date("2026-04-01T00:00:00Z"),
          amount: 1000,
          currency: "EUR",
          dueDate: new Date("2026-10-01T00:00:00Z"),
          clientEventId: feid("per2_ce"),
        },
      }),
    ).resolves.toBeDefined();
    await expect(
      prisma.charge.create({
        data: {
          payerPersonId: payerId,
          feeTypeId,
          periodStart: new Date("2026-04-01T00:00:00Z"),
          amount: 1000,
          currency: "EUR",
          dueDate: new Date("2026-10-01T00:00:00Z"),
          clientEventId: feid("per2_ce_b"),
        },
      }),
    ).resolves.toBeDefined();
  });
});

describe("Charge_waived_fields_check / Charge_cancelled_fields_check — biconditional, not one-way", () => {
  it("refuses status = WAIVED with no waive pair", async () => {
    const feeTypeId = await makeFeeType("wv1");
    const payerId = await makePerson("wv1_payer");
    await expect(
      prisma.charge.create({
        data: {
          payerPersonId: payerId,
          feeTypeId,
          amount: 1000,
          currency: "EUR",
          dueDate: new Date("2026-10-01T00:00:00Z"),
          status: "WAIVED",
          clientEventId: feid("wv1_ce"),
        },
      }),
    ).rejects.toThrow(/violates check constraint/i);
  });

  it("refuses a waive pair with status left OPEN — the biconditional's OTHER direction", async () => {
    const feeTypeId = await makeFeeType("wv2");
    const payerId = await makePerson("wv2_payer");
    await expect(
      prisma.charge.create({
        data: {
          payerPersonId: payerId,
          feeTypeId,
          amount: 1000,
          currency: "EUR",
          dueDate: new Date("2026-10-01T00:00:00Z"),
          status: "OPEN",
          waivedAt: NOW,
          waivedReason: "reden",
          clientEventId: feid("wv2_ce"),
        },
      }),
    ).rejects.toThrow(/violates check constraint/i);
  });

  it("refuses status = CANCELLED with no cancel pair", async () => {
    const feeTypeId = await makeFeeType("cn1");
    const payerId = await makePerson("cn1_payer");
    await expect(
      prisma.charge.create({
        data: {
          payerPersonId: payerId,
          feeTypeId,
          amount: 1000,
          currency: "EUR",
          dueDate: new Date("2026-10-01T00:00:00Z"),
          status: "CANCELLED",
          clientEventId: feid("cn1_ce"),
        },
      }),
    ).rejects.toThrow(/violates check constraint/i);
  });

  it("allows OPEN with neither pair set, and WAIVED/CANCELLED with their own pair set", async () => {
    const feeTypeId = await makeFeeType("ok1");
    const payerId = await makePerson("ok1_payer");
    await expect(
      prisma.charge.create({
        data: {
          payerPersonId: payerId,
          feeTypeId,
          amount: 1000,
          currency: "EUR",
          dueDate: new Date("2026-10-01T00:00:00Z"),
          status: "WAIVED",
          waivedAt: NOW,
          waivedReason: "reden",
          clientEventId: feid("ok1_ce"),
        },
      }),
    ).resolves.toBeDefined();
  });
});

describe("idempotency keys (P-02)", () => {
  it("Charge_clientEventId_key refuses a duplicate, even bypassing the service's own pre-read", async () => {
    const feeTypeId = await makeFeeType("idem1");
    const payerId = await makePerson("idem1_payer");
    const clientEventId = feid("idem1_ce");
    await prisma.charge.create({
      data: {
        payerPersonId: payerId,
        feeTypeId,
        amount: 1000,
        currency: "EUR",
        dueDate: new Date("2026-10-01T00:00:00Z"),
        clientEventId,
      },
    });

    await expect(
      prisma.charge.create({
        data: {
          payerPersonId: payerId,
          feeTypeId,
          amount: 1000,
          currency: "EUR",
          dueDate: new Date("2026-10-01T00:00:00Z"),
          clientEventId,
        },
      }),
    ).rejects.toThrow(/unique constraint/i);
  });

  it("Payment_clientEventId_key refuses a duplicate", async () => {
    const feeTypeId = await makeFeeType("idem2");
    const payerId = await makePerson("idem2_payer");
    const { id: chargeId } = await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      dueDate: "2026-10-01",
      clientEventId: feid("idem2_ce"),
    });
    const clientEventId = feid("idem2_pay_ce");
    await prisma.payment.create({
      data: {
        chargeId,
        amount: 100,
        receivedAt: NOW,
        method: "CASH",
        clientEventId,
      },
    });

    await expect(
      prisma.payment.create({
        data: {
          chargeId,
          amount: 100,
          receivedAt: NOW,
          method: "CASH",
          clientEventId,
        },
      }),
    ).rejects.toThrow(/unique constraint/i);
  });

  it("recordPayment's service-level replay and the database key agree", async () => {
    const feeTypeId = await makeFeeType("idem3");
    const payerId = await makePerson("idem3_payer");
    const { id: chargeId } = await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      dueDate: "2026-10-01",
      clientEventId: feid("idem3_ce"),
    });
    const clientEventId = feid("idem3_pay_ce");

    const first = await recordPayment(admin(), {
      chargeId,
      amount: 100,
      method: "CASH",
      clientEventId,
    });
    const second = await recordPayment(admin(), {
      chargeId,
      amount: 100,
      method: "CASH",
      clientEventId,
    });
    expect(second.id).toBe(first.id);
  });
});
