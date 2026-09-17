/**
 * The CSV export — R-32's "CSV export is permission-gated with fees.export,
 * audited, deterministic, safely escaped, and contains no fields beyond the
 * specified financial view" (`15-…` §6.1: "A CSV of open charges and
 * recorded payments; the treasurer keeps whatever tool they already use").
 *
 * `{ organization: true }`-only — the export is a full dump of the
 * installation's fees, so the only reach that may ever request it is the one
 * that covers everything (the same reasoning `skills`' catalogue export
 * uses, one level stricter: `fees.export` rather than `fees.read`, because
 * compiling every family's balance into one downloadable file is a materially
 * bigger disclosure than reading one).
 *
 * ONE ROW PER CHARGE, not one row per payment — a considered simplification,
 * flagged in the phase report: `15-…` §6.1 asks for "charges AND payments" in
 * one CSV, and this file answers that by summarising each charge's payments
 * into one column (`paymentsSummary`) rather than doubling the row grain.
 * Every figure a payment carries (date, amount, method, reference) is still
 * present, just concatenated rather than repeated as its own row.
 *
 * DETERMINISM: charges are always read in the same order
 * (`listAllCharges` — `dueDate`, then `createdAt`), every date is ISO-8601, no
 * locale-dependent formatting anywhere in this file. Two exports taken back
 * to back over an unchanged database produce byte-identical output.
 *
 * SERVER-ONLY.
 */
import { requirePermission, type Principal } from "@/lib/authorization";
import { recordAuditEvent } from "@/modules/audit";

import { deriveChargeBalance } from "../domain/balance";
import { toCsv } from "../domain/csv";
import { formatMinorUnitsAsDecimalString } from "../domain/money";
import {
  listAllCharges,
  type ChargeView,
} from "../infrastructure/charge-repository";

export interface ActorContext {
  readonly principal: Principal;
  readonly requestId?: string | null;
  readonly at?: Date;
}

function instant(actor: ActorContext): Date {
  return actor.at ?? new Date();
}

const HEADER = [
  "chargeId",
  "payerPersonId",
  "studentProfileId",
  "feeTypeCode",
  "feeTypeName",
  "periodStart",
  "periodEnd",
  "amount",
  "currency",
  "dueDate",
  "storedStatus",
  "state",
  "paidAmount",
  "openAmount",
  "paymentsSummary",
  "note",
  "createdAt",
] as const;

function isoDate(value: Date | null): string {
  return value === null ? "" : value.toISOString().slice(0, 10);
}

function chargeRow(charge: ChargeView): string[] {
  const balance = deriveChargeBalance(charge, charge.payments);
  const paymentsSummary = charge.payments
    .map(
      (payment) =>
        `${isoDate(payment.receivedAt)}:${formatMinorUnitsAsDecimalString(payment.amount)}:${payment.method}${payment.reference ? `:${payment.reference}` : ""}`,
    )
    .join("; ");

  return [
    charge.id,
    charge.payerPersonId ?? "",
    charge.studentProfileId ?? "",
    charge.feeTypeCode,
    charge.feeTypeName,
    isoDate(charge.periodStart),
    isoDate(charge.periodEnd),
    formatMinorUnitsAsDecimalString(charge.amount),
    charge.currency,
    isoDate(charge.dueDate),
    charge.status,
    balance.state,
    formatMinorUnitsAsDecimalString(balance.paidAmount),
    formatMinorUnitsAsDecimalString(balance.openAmount),
    paymentsSummary,
    charge.note ?? "",
    charge.createdAt.toISOString(),
  ];
}

/**
 * Builds the CSV document and audits the export — in that order, and the
 * audit write is NOT best-effort: if it fails, the export fails with it
 * (fail closed), because an unaudited export of every family's balance is
 * exactly the exfiltration primitive D-042 names.
 */
export async function exportFeesCsv(actor: ActorContext): Promise<string> {
  const at = instant(actor);
  await requirePermission(
    actor.principal,
    "fees.export",
    { organization: true },
    { at },
  );

  const charges = await listAllCharges();
  const csv = toCsv(HEADER, charges.map(chargeRow));

  await recordAuditEvent({
    eventType: "fees.export.downloaded",
    outcome: "SUCCESS",
    actorPersonId: actor.principal.personId,
    actorAuthMethod: "session",
    targetType: "organization",
    targetId: null,
    requestId: actor.requestId ?? null,
    changedFields: { chargeCount: charges.length },
  });

  return csv;
}
