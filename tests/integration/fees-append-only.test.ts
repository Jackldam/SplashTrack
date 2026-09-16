/**
 * `Charge` and `Payment` carry the P-07 append-only carve-out
 * (`feesGrantStatements`, phase 3.3) — the `exams-append-only.test.ts`
 * pattern, one module later, proved as the REAL runtime role rather than
 * asserted in code.
 *
 * `Payment` is the EXACT `ExamResult` shape: `SELECT, INSERT` and nothing
 * else.
 *
 * `Charge` is the `Award` shape: the runtime role may `UPDATE` exactly
 * `status`, `waivedAt`, `waivedReason`, `waivedByPersonId`, `cancelledAt`,
 * `cancelledReason`, `cancelledByPersonId` — and ONLY those — while every
 * other column (`amount`, `dueDate`, `feeTypeId`, `payerPersonId`, …) is
 * exactly as immutable as an ordinary append-only table's.
 *
 * THE SEVER, NOT CASCADE, PROOF — the property this module cares about most,
 * more than the delete-refusal above: D-092's pseudonymisation depends on
 * `Charge.payerPersonId`/`studentProfileId` being `SET NULL` when the
 * `Person`/`StudentProfile` they point at is erased, NEVER on the `Charge`
 * row itself disappearing with them. Proved directly against a real erasure
 * of both.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/database";
import { roleNameFrom } from "@/lib/database/role-model";

import {
  feid,
  grantTo,
  installRealRelations,
  makeFeeType,
  makePerson,
  makeRole,
  makeStudent,
  resetFeesFixtures,
} from "../support/fees-fixtures";
import { createCharge, recordPayment, waiveCharge } from "@/modules/fees";

const NOW = new Date("2026-09-16T12:00:00.000Z");
const APP_ROLE = roleNameFrom(process.env.DATABASE_URL as string);

let adminId: string;

function admin() {
  return { principal: { personId: adminId }, at: NOW };
}

beforeAll(() => {
  installRealRelations();
});

beforeEach(async () => {
  await resetFeesFixtures();
  adminId = await makePerson("ao_admin");
  await grantTo({
    personId: adminId,
    roleId: await makeRole("ao_role_admin", [
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

describe("Payment is pure append-only as the runtime role", () => {
  it("the runtime role holds SELECT and INSERT, and nothing else", async () => {
    const privileges = await prisma.$queryRaw<{ privilege_type: string }[]>`
      SELECT privilege_type
        FROM information_schema.role_table_grants
       WHERE table_name = 'Payment'
         AND grantee = ${APP_ROLE}
       ORDER BY privilege_type
    `;
    expect(privileges.map((row) => row.privilege_type)).toEqual([
      "INSERT",
      "SELECT",
    ]);
  });

  it("an UPDATE and a DELETE against a real Payment row are REFUSED by the database", async () => {
    const feeTypeId = await makeFeeType("ao1", { amount: 1000 });
    const payerId = await makePerson("ao1_payer");
    const { id: chargeId } = await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      dueDate: "2026-10-01",
      clientEventId: feid("ao1_ce"),
    });
    const { id: paymentId } = await recordPayment(admin(), {
      chargeId,
      amount: 500,
      method: "CASH",
      clientEventId: feid("ao1_pay_ce"),
    });
    const row = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });

    await expect(
      prisma.payment.update({
        where: { id: paymentId },
        data: { amount: 1 },
      }),
    ).rejects.toThrow(/permission denied|denied by|not permitted/i);
    await expect(
      prisma.payment.delete({ where: { id: paymentId } }),
    ).rejects.toThrow(/permission denied|denied by|not permitted/i);

    await expect(
      prisma.payment.findUniqueOrThrow({ where: { id: paymentId } }),
    ).resolves.toEqual(row);
  });
});

describe("Charge — SELECT/INSERT plus a column-restricted UPDATE, and never DELETE", () => {
  it("the runtime role holds SELECT, INSERT and a column-restricted UPDATE — never DELETE", async () => {
    const privileges = await prisma.$queryRaw<
      { privilege_type: string; column_name: string | null }[]
    >`
      SELECT privilege_type, column_name
        FROM information_schema.role_column_grants
       WHERE table_name = 'Charge'
         AND grantee = ${APP_ROLE}
       ORDER BY privilege_type, column_name
    `;
    const kinds = [...new Set(privileges.map((p) => p.privilege_type))].sort();
    expect(kinds).toEqual(["INSERT", "SELECT", "UPDATE"]);

    const updateColumns = privileges
      .filter((p) => p.privilege_type === "UPDATE")
      .map((p) => p.column_name)
      .sort();
    expect(updateColumns).toEqual(
      [
        "cancelledAt",
        "cancelledByPersonId",
        "cancelledReason",
        "status",
        "waivedAt",
        "waivedByPersonId",
        "waivedReason",
      ].sort(),
    );
  });

  it("UPDATEs the waive pair together, at the database, as the real runtime role", async () => {
    const feeTypeId = await makeFeeType("ao2", { amount: 1000 });
    const payerId = await makePerson("ao2_payer");
    const { id: chargeId } = await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      dueDate: "2026-10-01",
      clientEventId: feid("ao2_ce"),
    });

    await prisma.charge.update({
      where: { id: chargeId },
      data: {
        status: "WAIVED",
        waivedAt: NOW,
        waivedReason: "reden",
        waivedByPersonId: adminId,
      },
    });

    const row = await prisma.charge.findUniqueOrThrow({
      where: { id: chargeId },
    });
    expect(row.status).toBe("WAIVED");
    expect(row.waivedReason).toBe("reden");
  });

  it("REFUSES an UPDATE touching amount, at the database, even alongside an allowed column", async () => {
    const feeTypeId = await makeFeeType("ao3", { amount: 1000 });
    const payerId = await makePerson("ao3_payer");
    const { id: chargeId } = await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      dueDate: "2026-10-01",
      clientEventId: feid("ao3_ce"),
    });

    await expect(
      prisma.charge.update({
        where: { id: chargeId },
        // Every column the waive CHECK requires is present and consistent —
        // only `amount` is the one this update should be refused for, and
        // the refusal must be a PRIVILEGE error, not the CHECK firing first.
        data: {
          status: "WAIVED",
          waivedAt: NOW,
          waivedReason: "reden",
          waivedByPersonId: adminId,
          amount: 1,
        },
      }),
    ).rejects.toThrow(/permission denied|denied by|not permitted/i);
  });

  it("REFUSES an UPDATE touching dueDate/feeTypeId/payerPersonId, at the database", async () => {
    const feeTypeId = await makeFeeType("ao4", { amount: 1000 });
    const otherFeeType = await makeFeeType("ao4_other", { amount: 2000 });
    const payerId = await makePerson("ao4_payer");
    const otherPayer = await makePerson("ao4_other_payer");
    const { id: chargeId } = await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      dueDate: "2026-10-01",
      clientEventId: feid("ao4_ce"),
    });

    await expect(
      prisma.charge.update({
        where: { id: chargeId },
        data: { dueDate: new Date("2099-01-01T00:00:00Z") },
      }),
    ).rejects.toThrow(/permission denied|denied by|not permitted/i);
    await expect(
      prisma.charge.update({
        where: { id: chargeId },
        data: { feeTypeId: otherFeeType },
      }),
    ).rejects.toThrow(/permission denied|denied by|not permitted/i);
    await expect(
      prisma.charge.update({
        where: { id: chargeId },
        data: { payerPersonId: otherPayer },
      }),
    ).rejects.toThrow(/permission denied|denied by|not permitted/i);
  });

  it("REFUSES a DELETE against a real Charge row", async () => {
    const feeTypeId = await makeFeeType("ao5", { amount: 1000 });
    const payerId = await makePerson("ao5_payer");
    const { id: chargeId } = await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      dueDate: "2026-10-01",
      clientEventId: feid("ao5_ce"),
    });

    await expect(
      prisma.charge.delete({ where: { id: chargeId } }),
    ).rejects.toThrow(/permission denied|denied by|not permitted/i);
  });
});

describe("D-092's pseudonymisation prerequisite: erasing the payer or the student SEVERS the link, never deletes the Charge", () => {
  it("erasing the PAYER nulls payerPersonId; the charge, its amount and its payments survive", async () => {
    const feeTypeId = await makeFeeType("sev1", { amount: 1000 });
    const payerId = await makePerson("sev1_payer");
    const { id: chargeId } = await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      dueDate: "2026-10-01",
      clientEventId: feid("sev1_ce"),
    });
    await recordPayment(admin(), {
      chargeId,
      amount: 400,
      method: "BANK",
      clientEventId: feid("sev1_pay_ce"),
    });

    await prisma.person.delete({ where: { id: payerId } });

    const row = await prisma.charge.findUniqueOrThrow({
      where: { id: chargeId },
    });
    expect(row.payerPersonId).toBeNull();
    expect(row.amount).toBe(1000);
    await expect(prisma.payment.count({ where: { chargeId } })).resolves.toBe(
      1,
    );
  });

  it("erasing the STUDENT nulls studentProfileId; the charge survives", async () => {
    const feeTypeId = await makeFeeType("sev2", { amount: 1000 });
    const payerId = await makePerson("sev2_payer");
    const student = await makeStudent("sev2_student");
    const { id: chargeId } = await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      studentProfileId: student.studentProfileId,
      dueDate: "2026-10-01",
      clientEventId: feid("sev2_ce"),
    });

    await prisma.studentProfile.delete({
      where: { id: student.studentProfileId },
    });

    const row = await prisma.charge.findUniqueOrThrow({
      where: { id: chargeId },
    });
    expect(row.studentProfileId).toBeNull();
    expect(row.payerPersonId).toBe(payerId);
  });

  it("erasing the ADMINISTRATOR who waived a charge severs waivedByPersonId; the waive itself survives", async () => {
    const feeTypeId = await makeFeeType("sev3", { amount: 1000 });
    const payerId = await makePerson("sev3_payer");
    const { id: chargeId } = await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      dueDate: "2026-10-01",
      clientEventId: feid("sev3_ce"),
    });

    // A SEPARATE waiver persona, freely erasable — `adminId` carries the
    // suite's own `RoleAssignment` fixtures and is not the point of this
    // test.
    const waiverId = await makePerson("sev3_waiver");
    await grantTo({
      personId: waiverId,
      roleId: await makeRole("sev3_waiver_role", ["fees.manage"]),
      scopeType: "ORGANIZATION",
    });
    await waiveCharge(
      { principal: { personId: waiverId }, at: NOW },
      {
        chargeId,
        reason: "sev3",
      },
    );

    // The ordinary erasure shape: RoleAssignment is HARD_DELETE
    // (`PERSON_REFERENCE_CLASSIFICATION`), deleted explicitly before the
    // Person row that a Restrict FK would otherwise block.
    await prisma.roleAssignment.deleteMany({ where: { personId: waiverId } });
    await prisma.person.delete({ where: { id: waiverId } });

    const row = await prisma.charge.findUniqueOrThrow({
      where: { id: chargeId },
    });
    expect(row.status).toBe("WAIVED");
    expect(row.waivedReason).toBe("sev3");
    expect(row.waivedByPersonId).toBeNull();
  });
});
