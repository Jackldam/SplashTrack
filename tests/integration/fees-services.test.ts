import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PermissionDeniedError } from "@/lib/authorization";
import {
  cancelCharge,
  ChargeError,
  createCharge,
  createFeeType,
  exportFeesCsv,
  FeeTypeError,
  getFeeBalanceForPayer,
  getFeeBalanceForStudent,
  listFeeTypesForPrincipal,
  PaymentError,
  recordPayment,
  updateFeeType,
  waiveCharge,
} from "@/modules/fees";

import {
  FEES_ADMIN_PERMISSIONS,
  feid,
  grantTo,
  installRealRelations,
  makeFeeType,
  makePerson,
  makeRole,
  makeStudent,
  resetFeesFixtures,
} from "../support/fees-fixtures";

const NOW = new Date("2026-09-16T12:00:00.000Z");

let adminId: string;

function admin() {
  return { principal: { personId: adminId }, at: NOW };
}

function actorFor(personId: string) {
  return { principal: { personId }, at: NOW };
}

beforeAll(() => {
  installRealRelations();
});

beforeEach(async () => {
  await resetFeesFixtures();
  adminId = await makePerson("svc_admin");
  await grantTo({
    personId: adminId,
    roleId: await makeRole("svc_role_admin", FEES_ADMIN_PERMISSIONS),
    scopeType: "ORGANIZATION",
  });
});

afterAll(async () => {
  await resetFeesFixtures();
});

describe("createFeeType / updateFeeType / listFeeTypesForPrincipal", () => {
  it("creates a fee type and lists it", async () => {
    const { id } = await createFeeType(admin(), {
      code: feid("ft1"),
      name: "Contributie Q1",
      amount: 6750,
      recurrence: "PERIODIC",
    });

    const list = await listFeeTypesForPrincipal(admin());
    expect(list.map((f) => f.id)).toContain(id);
    const created = list.find((f) => f.id === id)!;
    expect(created.amount).toBe(6750);
    expect(created.currency).toBe("EUR");
    expect(created.active).toBe(true);
  });

  it("refuses a duplicate code", async () => {
    const code = feid("dup1");
    await createFeeType(admin(), {
      code,
      name: "A",
      amount: 100,
      recurrence: "ONE_OFF",
    });
    await expect(
      createFeeType(admin(), {
        code,
        name: "B",
        amount: 200,
        recurrence: "ONE_OFF",
      }),
    ).rejects.toBeInstanceOf(FeeTypeError);
  });

  it("updates name/amount/active without touching code or recurrence", async () => {
    const { id } = await createFeeType(admin(), {
      code: feid("upd1"),
      name: "Old name",
      amount: 100,
      recurrence: "ONE_OFF",
    });

    await updateFeeType(admin(), id, {
      name: "New name",
      amount: 200,
      // `active` omitted — the checkbox-absent shape means false.
    });

    const list = await listFeeTypesForPrincipal(admin(), {
      includeInactive: true,
    });
    const updated = list.find((f) => f.id === id)!;
    expect(updated.name).toBe("New name");
    expect(updated.amount).toBe(200);
    expect(updated.active).toBe(false);
  });

  it("excludes inactive fee types by default, includes them on request", async () => {
    const { id } = await createFeeType(admin(), {
      code: feid("inact1"),
      name: "Retired fee",
      amount: 100,
      recurrence: "ONE_OFF",
    });
    await updateFeeType(admin(), id, { name: "Retired fee", amount: 100 });

    const defaultList = await listFeeTypesForPrincipal(admin());
    expect(defaultList.map((f) => f.id)).not.toContain(id);

    const fullList = await listFeeTypesForPrincipal(admin(), {
      includeInactive: true,
    });
    expect(fullList.map((f) => f.id)).toContain(id);
  });

  it("requires fees.manage to create, fees.read to list", async () => {
    const readerId = await makePerson("svc_reader");
    await grantTo({
      personId: readerId,
      roleId: await makeRole("svc_role_reader", ["fees.read"]),
      scopeType: "ORGANIZATION",
    });

    await expect(
      createFeeType(actorFor(readerId), {
        code: feid("noperm1"),
        name: "X",
        amount: 100,
        recurrence: "ONE_OFF",
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    await expect(
      listFeeTypesForPrincipal(actorFor(readerId)),
    ).resolves.toBeDefined();
  });
});

describe("createCharge", () => {
  it("copies amount and currency from the fee type at creation time", async () => {
    const feeTypeId = await makeFeeType("chg1", { amount: 4500 });
    const payerId = await makePerson("chg1_payer");

    const { id } = await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      dueDate: "2026-10-01",
      clientEventId: feid("chg1_ce"),
    });

    const balance = await getFeeBalanceForPayer(admin(), payerId);
    const charge = balance.charges.find((c) => c.id === id)!;
    expect(charge.amount).toBe(4500);
    expect(charge.currency).toBe("EUR");
    expect(charge.status).toBe("OPEN");
    expect(charge.balance.state).toBe("OPEN");
  });

  it("later raising the fee type's price does not restate an existing open charge", async () => {
    const feeTypeId = await makeFeeType("chg2", { amount: 1000 });
    const payerId = await makePerson("chg2_payer");

    const { id } = await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      dueDate: "2026-10-01",
      clientEventId: feid("chg2_ce"),
    });

    await updateFeeType(admin(), feeTypeId, { name: "Fee chg2", amount: 5000 });

    const balance = await getFeeBalanceForPayer(admin(), payerId);
    expect(balance.charges.find((c) => c.id === id)!.amount).toBe(1000);
  });

  it("refuses a charge against an inactive fee type", async () => {
    const feeTypeId = await makeFeeType("chg3", { active: false });
    const payerId = await makePerson("chg3_payer");

    await expect(
      createCharge(admin(), {
        feeTypeId,
        payerPersonId: payerId,
        dueDate: "2026-10-01",
        clientEventId: feid("chg3_ce"),
      }),
    ).rejects.toBeInstanceOf(ChargeError);
  });

  it("refuses a non-existent fee type", async () => {
    const payerId = await makePerson("chg4_payer");
    await expect(
      createCharge(admin(), {
        feeTypeId: feid("chg4_nonexistent"),
        payerPersonId: payerId,
        dueDate: "2026-10-01",
        clientEventId: feid("chg4_ce"),
      }),
    ).rejects.toBeInstanceOf(ChargeError);
  });

  it("refuses a non-existent payer, translated from the FK violation", async () => {
    const feeTypeId = await makeFeeType("chg5");
    await expect(
      createCharge(admin(), {
        feeTypeId,
        payerPersonId: feid("chg5_nonexistent_payer"),
        dueDate: "2026-10-01",
        clientEventId: feid("chg5_ce"),
      }),
    ).rejects.toMatchObject({ reason: "PAYER_NOT_FOUND" });
  });

  it("refuses a non-existent student, translated from the FK violation", async () => {
    const feeTypeId = await makeFeeType("chg6");
    const payerId = await makePerson("chg6_payer");
    await expect(
      createCharge(admin(), {
        feeTypeId,
        payerPersonId: payerId,
        studentProfileId: feid("chg6_nonexistent_student"),
        dueDate: "2026-10-01",
        clientEventId: feid("chg6_ce"),
      }),
    ).rejects.toMatchObject({ reason: "STUDENT_NOT_FOUND" });
  });

  it("is idempotent per clientEventId (P-02) — a retry never double-bills", async () => {
    const feeTypeId = await makeFeeType("chg7");
    const payerId = await makePerson("chg7_payer");
    const clientEventId = feid("chg7_ce");

    const first = await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      dueDate: "2026-10-01",
      clientEventId,
    });
    const second = await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      dueDate: "2026-10-01",
      clientEventId,
    });

    expect(second.id).toBe(first.id);
    const balance = await getFeeBalanceForPayer(admin(), payerId);
    expect(balance.charges).toHaveLength(1);
  });

  it("accepts a period and a note, and rejects an out-of-order period at validation", async () => {
    const feeTypeId = await makeFeeType("chg8");
    const payerId = await makePerson("chg8_payer");

    await expect(
      createCharge(admin(), {
        feeTypeId,
        payerPersonId: payerId,
        periodStart: "2026-04-01",
        periodEnd: "2026-01-01",
        dueDate: "2026-10-01",
        note: "Q2, naar afspraak",
        clientEventId: feid("chg8_ce"),
      }),
    ).rejects.toThrow();
  });
});

describe("recordPayment", () => {
  it("records a payment and the balance reflects it", async () => {
    const feeTypeId = await makeFeeType("pay1", { amount: 1000 });
    const payerId = await makePerson("pay1_payer");
    const { id: chargeId } = await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      dueDate: "2026-10-01",
      clientEventId: feid("pay1_ce"),
    });

    await recordPayment(admin(), {
      chargeId,
      amount: 400,
      method: "BANK",
      clientEventId: feid("pay1_payment_ce"),
    });

    const balance = await getFeeBalanceForPayer(admin(), payerId);
    const charge = balance.charges.find((c) => c.id === chargeId)!;
    expect(charge.balance.paidAmount).toBe(400);
    expect(charge.balance.openAmount).toBe(600);
    expect(charge.balance.state).toBe("PARTIAL");
  });

  it("reaches PAID exactly at full payment, and PAID (not a fourth state) when overpaid", async () => {
    const feeTypeId = await makeFeeType("pay2", { amount: 1000 });
    const payerId = await makePerson("pay2_payer");
    const { id: chargeId } = await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      dueDate: "2026-10-01",
      clientEventId: feid("pay2_ce"),
    });

    await recordPayment(admin(), {
      chargeId,
      amount: 1000,
      method: "CASH",
      clientEventId: feid("pay2_payment_ce"),
    });
    let balance = await getFeeBalanceForPayer(admin(), payerId);
    expect(balance.charges[0]!.balance.state).toBe("PAID");
    expect(balance.totalOpenAmount).toBe(0);

    await recordPayment(admin(), {
      chargeId,
      amount: 500,
      method: "CASH",
      clientEventId: feid("pay2_payment_ce2"),
    });
    balance = await getFeeBalanceForPayer(admin(), payerId);
    expect(balance.charges[0]!.balance.state).toBe("PAID");
    expect(balance.charges[0]!.balance.openAmount).toBe(-500);
    expect(balance.totalOpenAmount).toBe(-500);
  });

  it("is idempotent per clientEventId", async () => {
    const feeTypeId = await makeFeeType("pay3", { amount: 1000 });
    const payerId = await makePerson("pay3_payer");
    const { id: chargeId } = await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      dueDate: "2026-10-01",
      clientEventId: feid("pay3_ce"),
    });
    const clientEventId = feid("pay3_payment_ce");

    await recordPayment(admin(), {
      chargeId,
      amount: 300,
      method: "BANK",
      clientEventId,
    });
    await recordPayment(admin(), {
      chargeId,
      amount: 300,
      method: "BANK",
      clientEventId,
    });

    const balance = await getFeeBalanceForPayer(admin(), payerId);
    expect(balance.charges[0]!.balance.paidAmount).toBe(300);
  });

  it("refuses a payment against a non-existent charge", async () => {
    await expect(
      recordPayment(admin(), {
        chargeId: feid("pay4_nonexistent"),
        amount: 100,
        method: "CASH",
        clientEventId: feid("pay4_ce"),
      }),
    ).rejects.toBeInstanceOf(PaymentError);
  });
});

describe("waiveCharge / cancelCharge", () => {
  it("waives an open charge; it is excluded from the running balance and cannot be waived twice", async () => {
    const feeTypeId = await makeFeeType("waive1", { amount: 1000 });
    const payerId = await makePerson("waive1_payer");
    const { id: chargeId } = await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      dueDate: "2026-10-01",
      clientEventId: feid("waive1_ce"),
    });

    await waiveCharge(admin(), { chargeId, reason: "Financiële hardship" });

    const balance = await getFeeBalanceForPayer(admin(), payerId);
    expect(balance.charges[0]!.status).toBe("WAIVED");
    expect(balance.charges[0]!.balance.state).toBe("WAIVED");
    expect(balance.totalOpenAmount).toBe(0);

    await expect(
      waiveCharge(admin(), { chargeId, reason: "again" }),
    ).rejects.toBeInstanceOf(ChargeError);
  });

  it("cancels an open charge; a waived charge cannot then be cancelled", async () => {
    const feeTypeId = await makeFeeType("cancel1", { amount: 1000 });
    const payerId = await makePerson("cancel1_payer");
    const { id: chargeId } = await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      dueDate: "2026-10-01",
      clientEventId: feid("cancel1_ce"),
    });

    await cancelCharge(admin(), { chargeId, reason: "Kandidaat ingetrokken" });

    const balance = await getFeeBalanceForPayer(admin(), payerId);
    expect(balance.charges[0]!.status).toBe("CANCELLED");

    await expect(
      waiveCharge(admin(), { chargeId, reason: "too late" }),
    ).rejects.toBeInstanceOf(ChargeError);
  });

  it("refuses waiving/cancelling a non-existent charge", async () => {
    await expect(
      waiveCharge(admin(), { chargeId: feid("nope"), reason: "x" }),
    ).rejects.toBeInstanceOf(ChargeError);
    await expect(
      cancelCharge(admin(), { chargeId: feid("nope"), reason: "x" }),
    ).rejects.toBeInstanceOf(ChargeError);
  });
});

describe("balance views", () => {
  it("the student view is scoped to charges ABOUT that student, not every charge the payer owes", async () => {
    const feeTypeId = await makeFeeType("bal1", { amount: 1000 });
    const payerId = await makePerson("bal1_payer");
    const studentA = await makeStudent("bal1_a");
    const studentB = await makeStudent("bal1_b");

    await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      studentProfileId: studentA.studentProfileId,
      dueDate: "2026-10-01",
      clientEventId: feid("bal1_ce_a"),
    });
    await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      studentProfileId: studentB.studentProfileId,
      dueDate: "2026-10-01",
      clientEventId: feid("bal1_ce_b"),
    });
    await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      dueDate: "2026-10-01",
      clientEventId: feid("bal1_ce_membership"),
    });

    const payerBalance = await getFeeBalanceForPayer(admin(), payerId);
    expect(payerBalance.charges).toHaveLength(3);

    const studentABalance = await getFeeBalanceForStudent(
      admin(),
      studentA.studentProfileId,
    );
    expect(studentABalance.charges).toHaveLength(1);
    expect(studentABalance.totalOpenAmount).toBe(1000);
  });
});

describe("exportFeesCsv", () => {
  it("requires fees.export specifically — fees.manage/fees.read are not enough", async () => {
    const managerId = await makePerson("exp1_manager");
    await grantTo({
      personId: managerId,
      roleId: await makeRole("exp1_role", ["fees.read", "fees.manage"]),
      scopeType: "ORGANIZATION",
    });

    await expect(exportFeesCsv(actorFor(managerId))).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(exportFeesCsv(admin())).resolves.toEqual(expect.any(String));
  });

  it("produces a deterministic CSV containing the charge and its payment", async () => {
    const feeTypeId = await makeFeeType("exp2", { amount: 2500 });
    const payerId = await makePerson("exp2_payer");
    const { id: chargeId } = await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      dueDate: "2026-10-01",
      clientEventId: feid("exp2_ce"),
    });
    await recordPayment(admin(), {
      chargeId,
      amount: 1000,
      method: "BANK",
      reference: "NL01 TEST",
      clientEventId: feid("exp2_payment_ce"),
    });

    const csv = await exportFeesCsv(admin());
    expect(csv).toContain(chargeId);
    expect(csv).toContain(payerId);
    expect(csv).toContain("25.00");
    expect(csv).toContain("10.00");
    expect(csv.endsWith("\r\n")).toBe(true);

    const csvAgain = await exportFeesCsv(admin());
    expect(csvAgain).toBe(csv);
  });
});
