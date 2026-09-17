/**
 * `Payment` — one immutable financial fact against exactly one `Charge`
 * (D-088). TRUE append-only: no service in this module ever updates a
 * `Payment` row (`model Payment`'s own comment on why a mis-recorded payment
 * is reversed by a second row, never corrected in place).
 *
 * Guarded the same way `charge-service.ts` guards waive/cancel: on the
 * CHARGE's own stored payer/student, never on caller-supplied input.
 *
 * SERVER-ONLY.
 */
import {
  optionalText,
  requiredDate,
  requiredEnum,
  requiredInt,
  requiredText,
} from "@/lib/validation";
import { prisma } from "@/lib/database";
import { recordAuditEvent } from "@/modules/audit";

import { PaymentError } from "../domain/payment";
import { findChargeFacts } from "../infrastructure/charge-repository";
import { TEXT_MAX } from "./input";
import {
  requireFeesManageOnCharge,
  type ActorContext as ChargeActorContext,
} from "./charge-service";

export { PaymentError };
export type ActorContext = ChargeActorContext;

function instant(actor: ActorContext): Date {
  return actor.at ?? new Date();
}

const PAYMENT_METHODS = ["BANK", "CASH", "OTHER"] as const;
/** A sanity ceiling on one payment: €100,000 in minor units — the
 * `fee-type-service.ts` `MAX_AMOUNT_MINOR_UNITS` bound, restated here rather
 * than imported across application files for one shared constant. */
const MAX_AMOUNT_MINOR_UNITS = 100_000_00;

export interface RecordPaymentInput {
  chargeId: unknown;
  amount: unknown;
  receivedAt?: unknown;
  method: unknown;
  reference?: unknown;
  clientEventId: unknown;
}

/**
 * Records a payment against a charge. Never validated against the charge's
 * remaining balance — see `model Payment`'s own comment: an overpayment is a
 * fact, not an error, and the balance view renders it honestly.
 */
export async function recordPayment(
  actor: ActorContext,
  input: RecordPaymentInput,
): Promise<{ id: string }> {
  const at = instant(actor);
  const chargeId = requiredText("chargeId", input.chargeId, TEXT_MAX.id);
  const amount = requiredInt("amount", input.amount, 1, MAX_AMOUNT_MINOR_UNITS);
  const receivedAt =
    input.receivedAt === undefined ||
    input.receivedAt === null ||
    input.receivedAt === ""
      ? at
      : requiredDate("receivedAt", input.receivedAt);
  const method = requiredEnum("method", input.method, PAYMENT_METHODS);
  const reference = optionalText(
    "reference",
    input.reference,
    TEXT_MAX.reference,
  );
  const clientEventId = requiredText(
    "clientEventId",
    input.clientEventId,
    TEXT_MAX.id,
  );

  const facts = await findChargeFacts(chargeId);
  if (facts === null) throw new PaymentError("CHARGE_NOT_FOUND");
  await requireFeesManageOnCharge(actor, facts, at);

  return prisma.$transaction(async (tx) => {
    const replay = await tx.payment.findUnique({
      where: { clientEventId },
      select: { id: true },
    });
    if (replay !== null) return replay;

    const payment = await tx.payment.create({
      data: {
        chargeId,
        amount,
        receivedAt,
        method,
        reference,
        recordedByPersonId: actor.principal.personId,
        clientEventId,
      },
      select: { id: true },
    });

    await recordAuditEvent(
      {
        eventType: "fees.payment.recorded",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "charge",
        targetId: chargeId,
        requestId: actor.requestId ?? null,
        changedFields: {
          paymentId: payment.id,
          chargeId,
          amount,
          method,
        },
      },
      tx,
    );

    return payment;
  });
}
