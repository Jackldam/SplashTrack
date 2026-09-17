/**
 * `FeeType` — the club's own catalogue of what may be charged (D-088,
 * `15-assessment-and-fees.md` §6.1). The `AwardType`/`Course` shape: an
 * administrator authors it, `active` retires an entry without deleting the
 * history of charges already created against it.
 *
 * SERVER-ONLY.
 */
import { requirePermission, type Principal } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { requiredEnum, requiredInt, requiredText } from "@/lib/validation";
import { recordAuditEvent } from "@/modules/audit";

import { FeeTypeError } from "../domain/fee-type";
import {
  findFeeTypeById,
  listFeeTypes,
  type FeeTypeView,
} from "../infrastructure/fee-type-repository";
import { SUPPORTED_CURRENCY, TEXT_MAX } from "./input";

export { FeeTypeError };
export type { FeeTypeView };

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

function isUniqueViolation(error: unknown): boolean {
  return prismaCode(error) === "P2002";
}

const RECURRENCES = ["PERIODIC", "ONE_OFF"] as const;
/** A sanity ceiling, not a business rule: €100,000 in minor units. Refuses a
 * stray extra digit rather than a legitimate large contribution. */
const MAX_AMOUNT_MINOR_UNITS = 100_000_00;

export interface CreateFeeTypeInput {
  code: unknown;
  name: unknown;
  amount: unknown;
  recurrence: unknown;
}

/** Adds a fee type. `{ organization: true }` — the catalogue belongs to the
 * club, on the `createCourse`/`createPool` precedent (coverage is resource
 * containment, D-170, and this resource is contained by the organisation). */
export async function createFeeType(
  actor: ActorContext,
  input: CreateFeeTypeInput,
): Promise<{ id: string }> {
  const at = instant(actor);
  const code = requiredText("code", input.code, TEXT_MAX.code);
  const name = requiredText("name", input.name, TEXT_MAX.name);
  const amount = requiredInt("amount", input.amount, 1, MAX_AMOUNT_MINOR_UNITS);
  const recurrence = requiredEnum("recurrence", input.recurrence, RECURRENCES);

  await requirePermission(
    actor.principal,
    "fees.manage",
    { organization: true },
    { at },
  );

  try {
    return await prisma.$transaction(async (tx) => {
      const feeType = await tx.feeType.create({
        data: { code, name, amount, currency: SUPPORTED_CURRENCY, recurrence },
        select: { id: true },
      });

      await recordAuditEvent(
        {
          eventType: "fees.fee_type.created",
          outcome: "SUCCESS",
          actorPersonId: actor.principal.personId,
          actorAuthMethod: "session",
          targetType: "fee_type",
          targetId: feeType.id,
          requestId: actor.requestId ?? null,
          changedFields: { code, amount, recurrence },
        },
        tx,
      );

      return feeType;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new FeeTypeError("DUPLICATE_CODE");
    throw error;
  }
}

export interface UpdateFeeTypeInput {
  name: unknown;
  amount: unknown;
  /** `"on"` from a checkbox, or absent — the `updateCourse` `active` shape. */
  active?: unknown;
}

/**
 * Corrects a fee type — its current price and name, and whether it may still
 * be charged. Never its `code` (a stable identifier, the `AwardType.code`
 * convention) and never its `recurrence` (changing PERIODIC/ONE_OFF after
 * charges already exist against it would make those charges' own
 * classification retroactively ambiguous).
 *
 * `amount` is an ORDINARY editable attribute, not history — the
 * `Pool.name`/`Pool.lengthMetres` reasoning (`facility-service.ts`'s own file
 * comment): a `FeeType`'s current price is not evidence of anything, and
 * `Charge.amount` already copies it at creation, so raising it here never
 * restates a single existing charge.
 */
export async function updateFeeType(
  actor: ActorContext,
  feeTypeId: string,
  input: UpdateFeeTypeInput,
): Promise<void> {
  const at = instant(actor);
  const name = requiredText("name", input.name, TEXT_MAX.name);
  const amount = requiredInt("amount", input.amount, 1, MAX_AMOUNT_MINOR_UNITS);
  const active = input.active !== undefined;

  await requirePermission(
    actor.principal,
    "fees.manage",
    { organization: true },
    { at },
  );

  const existing = await findFeeTypeById(feeTypeId);
  if (existing === null) throw new FeeTypeError("FEE_TYPE_NOT_FOUND");

  await prisma.$transaction(async (tx) => {
    await tx.feeType.update({
      where: { id: feeTypeId },
      data: { name, amount, active },
    });

    await recordAuditEvent(
      {
        eventType: "fees.fee_type.updated",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "fee_type",
        targetId: feeTypeId,
        requestId: actor.requestId ?? null,
        changedFields: { name, amount, active },
      },
      tx,
    );
  });
}

/** The catalogue. `{ organization: true }`-only, the `skills.read`/
 * `listAwardTypesForPrincipal` precedent — there is no narrower scope for
 * this catalogue. */
export async function listFeeTypesForPrincipal(
  actor: ActorContext,
  options: { includeInactive?: boolean } = {},
): Promise<FeeTypeView[]> {
  const at = instant(actor);
  await requirePermission(
    actor.principal,
    "fees.read",
    { organization: true },
    { at },
  );
  return listFeeTypes(options);
}

/** One fee type — used by the charge-creation form to confirm the current
 * price/currency it will copy. Same `{ organization: true }`-only guard. */
export async function getFeeTypeForPrincipal(
  actor: ActorContext,
  feeTypeId: string,
): Promise<FeeTypeView | null> {
  const at = instant(actor);
  await requirePermission(
    actor.principal,
    "fees.read",
    { organization: true },
    { at },
  );
  return findFeeTypeById(feeTypeId);
}
