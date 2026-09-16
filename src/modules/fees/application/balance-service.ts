/**
 * The balance views — R-32's "a balance view per payer and per student":
 * open charges, recorded payments and a running balance, derived fresh from
 * `Charge`/`Payment` on every read (`domain/balance.ts`), never a cached
 * total.
 *
 * Both are SINGLE-RESOURCE reads, the `getCourseForPrincipal`/
 * `getExamResultsForCandidate` shape: one `requirePermission` call naming the
 * one payer or one student, then a plain query — there is no list to narrow
 * by reach, so this file needs no `*-reach-filter.ts`.
 *
 * SERVER-ONLY.
 */
import { requirePermission, type Principal } from "@/lib/authorization";

import {
  deriveChargeBalance,
  runningBalance,
  type ChargeBalance,
} from "../domain/balance";
import {
  listChargesForPayer,
  listChargesForStudent,
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

export interface ChargeWithBalance extends ChargeView {
  readonly balance: ChargeBalance;
}

export interface FeeBalanceView {
  readonly charges: readonly ChargeWithBalance[];
  /** The running balance across every non-waived, non-cancelled charge —
   * zero or negative when nothing is owed, positive when something is. */
  readonly totalOpenAmount: number;
  /** The single currency every charge in this view is stated in — `null`
   * only when there are no charges at all to read it from. */
  readonly currency: string | null;
}

function toBalanceView(charges: readonly ChargeView[]): FeeBalanceView {
  const withBalance = charges.map((charge) => ({
    ...charge,
    balance: deriveChargeBalance(charge, charge.payments),
  }));
  return {
    charges: withBalance,
    totalOpenAmount: runningBalance(withBalance.map((c) => c.balance)),
    currency: charges[0]?.currency ?? null,
  };
}

/** One payer's balance — *"Sanne de Vries — contributie Q3 €67,50 open"*. */
export async function getFeeBalanceForPayer(
  actor: ActorContext,
  payerPersonId: string,
): Promise<FeeBalanceView> {
  const at = instant(actor);
  await requirePermission(
    actor.principal,
    "fees.read",
    { person: payerPersonId },
    { at },
  );
  return toBalanceView(await listChargesForPayer(payerPersonId));
}

/** One student's balance — the same view, filtered to charges ABOUT this
 * child rather than owed BY this payer (a family with two children sees two
 * different student balances against one payer balance). */
export async function getFeeBalanceForStudent(
  actor: ActorContext,
  studentProfileId: string,
): Promise<FeeBalanceView> {
  const at = instant(actor);
  await requirePermission(
    actor.principal,
    "fees.read",
    { student: studentProfileId },
    { at },
  );
  return toBalanceView(await listChargesForStudent(studentProfileId));
}
