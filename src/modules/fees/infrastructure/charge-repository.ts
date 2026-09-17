import { prisma } from "@/lib/database";
import type { ChargeStatus, PaymentMethod } from "@/generated/prisma/client";

/** The lean shape a write path loads before guarding/mutating a charge —
 * never rendered directly. */
export interface ChargeFacts {
  readonly id: string;
  readonly payerPersonId: string | null;
  readonly studentProfileId: string | null;
  readonly status: ChargeStatus;
  readonly amount: number;
}

export async function findChargeFacts(
  chargeId: string,
): Promise<ChargeFacts | null> {
  return prisma.charge.findUnique({
    where: { id: chargeId },
    select: {
      id: true,
      payerPersonId: true,
      studentProfileId: true,
      status: true,
      amount: true,
    },
  });
}

export interface PaymentView {
  readonly id: string;
  readonly amount: number;
  readonly receivedAt: Date;
  readonly method: PaymentMethod;
  readonly reference: string | null;
  readonly createdAt: Date;
}

export interface ChargeView {
  readonly id: string;
  readonly payerPersonId: string | null;
  readonly studentProfileId: string | null;
  readonly feeTypeId: string;
  readonly feeTypeCode: string;
  readonly feeTypeName: string;
  readonly periodStart: Date | null;
  readonly periodEnd: Date | null;
  readonly amount: number;
  readonly currency: string;
  readonly dueDate: Date;
  readonly status: ChargeStatus;
  readonly note: string | null;
  readonly waivedAt: Date | null;
  readonly waivedReason: string | null;
  readonly cancelledAt: Date | null;
  readonly cancelledReason: string | null;
  readonly createdAt: Date;
  readonly payments: readonly PaymentView[];
}

const VIEW_SELECT = {
  id: true,
  payerPersonId: true,
  studentProfileId: true,
  feeTypeId: true,
  feeType: { select: { code: true, name: true } },
  periodStart: true,
  periodEnd: true,
  amount: true,
  currency: true,
  dueDate: true,
  status: true,
  note: true,
  waivedAt: true,
  waivedReason: true,
  cancelledAt: true,
  cancelledReason: true,
  createdAt: true,
  payments: {
    select: {
      id: true,
      amount: true,
      receivedAt: true,
      method: true,
      reference: true,
      createdAt: true,
    },
    orderBy: { receivedAt: "asc" as const },
  },
} as const;

type ChargeRow = {
  id: string;
  payerPersonId: string | null;
  studentProfileId: string | null;
  feeTypeId: string;
  feeType: { code: string; name: string };
  periodStart: Date | null;
  periodEnd: Date | null;
  amount: number;
  currency: string;
  dueDate: Date;
  status: ChargeStatus;
  note: string | null;
  waivedAt: Date | null;
  waivedReason: string | null;
  cancelledAt: Date | null;
  cancelledReason: string | null;
  createdAt: Date;
  payments: PaymentView[];
};

function toView(row: ChargeRow): ChargeView {
  return {
    id: row.id,
    payerPersonId: row.payerPersonId,
    studentProfileId: row.studentProfileId,
    feeTypeId: row.feeTypeId,
    feeTypeCode: row.feeType.code,
    feeTypeName: row.feeType.name,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    amount: row.amount,
    currency: row.currency,
    dueDate: row.dueDate,
    status: row.status,
    note: row.note,
    waivedAt: row.waivedAt,
    waivedReason: row.waivedReason,
    cancelledAt: row.cancelledAt,
    cancelledReason: row.cancelledReason,
    createdAt: row.createdAt,
    payments: row.payments,
  };
}

/** Every charge for one payer, oldest due date first — the payer balance
 * view. Guarded by the caller's `requirePermission({ person: payerPersonId })`
 * before this runs; a single-resource read, so there is no reach-narrowed
 * `WHERE` to add here (`getCourseForPrincipal`'s precedent, not
 * `listCourses`'s). */
export async function listChargesForPayer(
  payerPersonId: string,
): Promise<ChargeView[]> {
  const rows = await prisma.charge.findMany({
    where: { payerPersonId },
    select: VIEW_SELECT,
    orderBy: { dueDate: "asc" },
  });
  return rows.map(toView);
}

/** Every charge about one student, oldest due date first — the student
 * balance view. Same single-resource guard shape as
 * {@link listChargesForPayer}. */
export async function listChargesForStudent(
  studentProfileId: string,
): Promise<ChargeView[]> {
  const rows = await prisma.charge.findMany({
    where: { studentProfileId },
    select: VIEW_SELECT,
    orderBy: { dueDate: "asc" },
  });
  return rows.map(toView);
}

/** Every charge in the installation, oldest due date first — the CSV export's
 * source. Guarded by `{ organization: true }`, which is the only reach that
 * ever passes, so there is nothing to narrow. */
export async function listAllCharges(): Promise<ChargeView[]> {
  const rows = await prisma.charge.findMany({
    select: VIEW_SELECT,
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toView);
}
