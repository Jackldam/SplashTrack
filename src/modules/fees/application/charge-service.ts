/**
 * `Charge` — one immutable financial fact against a payer, optionally about a
 * specific student (D-088). Creation, and the two administrative decisions a
 * charge's own row may still record: `WAIVED` and `CANCELLED` (`model
 * Charge`'s own comment on why those two, and not `PAID`/`PARTIAL`, are the
 * only mutations this module ever writes).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `{ student }` WHEN A STUDENT IS NAMED, `{ person }` OTHERWISE — THE
 * `exam-result-service.ts` `{ session }`/`{ student }` SPLIT, ONE LEVEL DOWN
 *
 * A charge about a specific child (an exam fee, most often) is guarded on
 * `{ student: studentProfileId }`; a charge with no student (a membership fee
 * for an adult member) is guarded on `{ person: payerPersonId }`. Waiving,
 * cancelling and recording a payment against an EXISTING charge re-derive the
 * same choice from the row itself, never from caller-supplied input — the
 * `registerExamCandidate`/`{ group: groupId }` lesson applied here: trusting
 * a caller-supplied resource id over the charge's own stored fact would let
 * an actor name a resource they do not actually hold a grant over.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO AUTOMATIC PAYER DERIVATION (D-090's "per-charge override", WITHOUT THE
 * DEFAULT)
 *
 * `15-…` §6.1: the payer is derived from `PersonRelationship(GUARDIAN_OF)` at
 * creation, "with a per-charge override". This phase builds the override —
 * an administrator names the payer explicitly, every time — and does not
 * build the automatic default, which would require a new query surface on
 * `people` outside this phase's write scope. Flagged in the phase 3.3 report.
 *
 * SERVER-ONLY.
 */
import { requirePermission, type Principal } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import {
  optionalDate,
  optionalText,
  requiredDate,
  requiredText,
} from "@/lib/validation";
import { recordAuditEvent } from "@/modules/audit";

import { ChargeError } from "../domain/charge";
import {
  findChargeFacts,
  type ChargeFacts,
} from "../infrastructure/charge-repository";
import { findFeeTypeById } from "../infrastructure/fee-type-repository";
import { TEXT_MAX } from "./input";

export { ChargeError };

export interface ActorContext {
  readonly principal: Principal;
  readonly requestId?: string | null;
  readonly at?: Date;
}

function instant(actor: ActorContext): Date {
  return actor.at ?? new Date();
}

function prismaCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * Prisma's foreign-key violation code, and which constraint it names — a
 * `payerPersonId`/`studentProfileId` id that does not exist in `Person`/
 * `StudentProfile`. `feeTypeId` is validated proactively below (its row is
 * read before the insert), so only these two can still fail at the database.
 *
 * Reads the constraint name from `error.message` rather than a `meta` field:
 * the DRIVER-ADAPTER error shape (Prisma 7's default) nests it several levels
 * deep in an implementation-specific place (`meta.driverAdapterError.cause
 * .constraint.index`) that the classic engine's `meta.field_name` never used
 * — `message` is the one place Postgres's own constraint name
 * (`Charge_payerPersonId_fkey`) reliably appears across both shapes.
 */
function missingReferenceField(error: unknown): string | null {
  if (prismaCode(error) !== "P2003") return null;
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Charge_studentProfileId_fkey")) {
    return "studentProfileId";
  }
  if (message.includes("Charge_payerPersonId_fkey")) {
    return "payerPersonId";
  }
  return null;
}

/** Guards on the charge's OWN stored resource — never on caller-supplied
 * input — the file comment's `{ student }`/`{ person }` split. */
async function requireFeesManageOnCharge(
  actor: ActorContext,
  facts: Pick<ChargeFacts, "studentProfileId" | "payerPersonId">,
  at: Date,
): Promise<void> {
  if (facts.studentProfileId !== null) {
    await requirePermission(
      actor.principal,
      "fees.manage",
      { student: facts.studentProfileId },
      { at },
    );
    return;
  }
  if (facts.payerPersonId !== null) {
    await requirePermission(
      actor.principal,
      "fees.manage",
      { person: facts.payerPersonId },
      { at },
    );
    return;
  }
  // Both links have been severed (D-092 pseudonymisation). Only an
  // organisation-wide grant can still act on a charge with no resource left
  // to name — the same fail-closed shape `{ organization: true }` gives every
  // other whole-installation operation in this module.
  await requirePermission(
    actor.principal,
    "fees.manage",
    { organization: true },
    { at },
  );
}

export interface CreateChargeInput {
  feeTypeId: unknown;
  payerPersonId: unknown;
  studentProfileId?: unknown;
  periodStart?: unknown;
  periodEnd?: unknown;
  dueDate: unknown;
  note?: unknown;
  clientEventId: unknown;
}

/**
 * Creates a charge. `amount`/`currency` are ALWAYS copied from the fee type's
 * CURRENT values — there is no override field, on `15-…` §6.1's own words
 * ("`Charge.amount` is copied from the `FeeType` at creation, not joined at
 * read time").
 */
export async function createCharge(
  actor: ActorContext,
  input: CreateChargeInput,
): Promise<{ id: string }> {
  const at = instant(actor);
  const feeTypeId = requiredText("feeTypeId", input.feeTypeId, TEXT_MAX.id);
  const payerPersonId = requiredText(
    "payerPersonId",
    input.payerPersonId,
    TEXT_MAX.id,
  );
  const studentProfileId =
    input.studentProfileId === undefined ||
    input.studentProfileId === null ||
    input.studentProfileId === ""
      ? null
      : requiredText("studentProfileId", input.studentProfileId, TEXT_MAX.id);
  const periodStart = optionalDate("periodStart", input.periodStart);
  const periodEnd = optionalDate("periodEnd", input.periodEnd);
  const dueDate = requiredDate("dueDate", input.dueDate);
  const note = optionalText("note", input.note, TEXT_MAX.note);
  const clientEventId = requiredText(
    "clientEventId",
    input.clientEventId,
    TEXT_MAX.id,
  );

  const feeType = await findFeeTypeById(feeTypeId);
  if (feeType === null) throw new ChargeError("FEE_TYPE_NOT_FOUND");
  if (!feeType.active) throw new ChargeError("FEE_TYPE_INACTIVE");

  await requireFeesManageOnCharge(
    actor,
    { studentProfileId, payerPersonId },
    at,
  );

  try {
    return await prisma.$transaction(async (tx) => {
      const replay = await tx.charge.findUnique({
        where: { clientEventId },
        select: { id: true },
      });
      if (replay !== null) return replay;

      const charge = await tx.charge.create({
        data: {
          payerPersonId,
          studentProfileId,
          feeTypeId,
          periodStart,
          periodEnd,
          amount: feeType.amount,
          currency: feeType.currency,
          dueDate,
          note,
          createdByPersonId: actor.principal.personId,
          clientEventId,
        },
        select: { id: true },
      });

      await recordAuditEvent(
        {
          eventType: "fees.charge.created",
          outcome: "SUCCESS",
          actorPersonId: actor.principal.personId,
          actorAuthMethod: "session",
          targetType: "person",
          targetId: payerPersonId,
          requestId: actor.requestId ?? null,
          changedFields: {
            chargeId: charge.id,
            feeTypeId,
            studentProfileId,
            amount: feeType.amount,
            dueDate: dueDate.toISOString(),
          },
        },
        tx,
      );

      return charge;
    });
  } catch (error) {
    const missing = missingReferenceField(error);
    if (missing !== null) {
      throw new ChargeError(
        missing.includes("studentProfileId")
          ? "STUDENT_NOT_FOUND"
          : "PAYER_NOT_FOUND",
      );
    }
    throw error;
  }
}

async function loadAndGuard(
  actor: ActorContext,
  chargeId: string,
  at: Date,
): Promise<ChargeFacts> {
  const facts = await findChargeFacts(chargeId);
  if (facts === null) throw new ChargeError("CHARGE_NOT_FOUND");
  await requireFeesManageOnCharge(actor, facts, at);
  return facts;
}

export interface WaiveChargeInput {
  chargeId: unknown;
  reason: unknown;
}

/** "We are not collecting this" — `status -> WAIVED`, the waive pair set
 * together (`Charge_waived_fields_check`). */
export async function waiveCharge(
  actor: ActorContext,
  input: WaiveChargeInput,
): Promise<void> {
  const at = instant(actor);
  const chargeId = requiredText("chargeId", input.chargeId, TEXT_MAX.id);
  const reason = requiredText("reason", input.reason, TEXT_MAX.reason);

  const facts = await loadAndGuard(actor, chargeId, at);
  if (facts.status === "WAIVED") throw new ChargeError("ALREADY_WAIVED");
  if (facts.status === "CANCELLED") throw new ChargeError("ALREADY_CANCELLED");

  await prisma.$transaction(async (tx) => {
    const updated = await tx.charge.updateMany({
      where: { id: chargeId, status: "OPEN" },
      data: {
        status: "WAIVED",
        waivedAt: at,
        waivedReason: reason,
        waivedByPersonId: actor.principal.personId,
      },
    });
    if (updated.count === 0) {
      // Lost a race against another waive/cancel since the read above.
      const current = await tx.charge.findUnique({
        where: { id: chargeId },
        select: { status: true },
      });
      throw new ChargeError(
        current?.status === "CANCELLED"
          ? "ALREADY_CANCELLED"
          : "ALREADY_WAIVED",
      );
    }

    await recordAuditEvent(
      {
        eventType: "fees.charge.waived",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "charge",
        targetId: chargeId,
        requestId: actor.requestId ?? null,
        changedFields: { chargeId },
        reason,
      },
      tx,
    );
  });
}

export interface CancelChargeInput {
  chargeId: unknown;
  reason: unknown;
}

/** "This charge should not have existed" — `status -> CANCELLED`. D-089's own
 * trade-off: a withdrawn exam candidacy cancels its charge rather than
 * deleting it, "the correct trace". */
export async function cancelCharge(
  actor: ActorContext,
  input: CancelChargeInput,
): Promise<void> {
  const at = instant(actor);
  const chargeId = requiredText("chargeId", input.chargeId, TEXT_MAX.id);
  const reason = requiredText("reason", input.reason, TEXT_MAX.reason);

  const facts = await loadAndGuard(actor, chargeId, at);
  if (facts.status === "WAIVED") throw new ChargeError("ALREADY_WAIVED");
  if (facts.status === "CANCELLED") throw new ChargeError("ALREADY_CANCELLED");

  await prisma.$transaction(async (tx) => {
    const updated = await tx.charge.updateMany({
      where: { id: chargeId, status: "OPEN" },
      data: {
        status: "CANCELLED",
        cancelledAt: at,
        cancelledReason: reason,
        cancelledByPersonId: actor.principal.personId,
      },
    });
    if (updated.count === 0) {
      const current = await tx.charge.findUnique({
        where: { id: chargeId },
        select: { status: true },
      });
      throw new ChargeError(
        current?.status === "WAIVED" ? "ALREADY_WAIVED" : "ALREADY_CANCELLED",
      );
    }

    await recordAuditEvent(
      {
        eventType: "fees.charge.cancelled",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "charge",
        targetId: chargeId,
        requestId: actor.requestId ?? null,
        changedFields: { chargeId },
        reason,
      },
      tx,
    );
  });
}

export { requireFeesManageOnCharge };
