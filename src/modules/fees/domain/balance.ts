/**
 * Balance derivation — R-32's "balance is derived from immutable financial
 * facts, not maintained as a mutable cached total", made a pure function.
 *
 * `Charge.status` stores only three states in this schema — `OPEN`, `WAIVED`,
 * `CANCELLED` (see `prisma/schema.prisma`'s own comment on `model Charge` for
 * why `15-assessment-and-fees.md` §6.1's `PAID`/`PARTIAL` are NOT stored
 * columns). This file computes them, every time, from the charge's `amount`
 * and its `Payment` rows — never from a cache, never written back.
 *
 * Pure. No I/O, no clock.
 */

/** `Charge.status`'s three stored values, spelled out so this file needs no
 * Prisma import. */
export type StoredChargeStatus = "OPEN" | "WAIVED" | "CANCELLED";

/**
 * The five states a person administering fees actually needs to see —
 * `15-…` §6.1's own vocabulary, computed rather than stored.
 */
export type DerivedChargeState =
  "OPEN" | "PARTIAL" | "PAID" | "WAIVED" | "CANCELLED";

export interface ChargeBalance {
  /** Sum of every `Payment.amount` recorded against this charge. */
  readonly paidAmount: number;
  /** `amount - paidAmount`. Zero once paid in full; NEGATIVE when the payer
   * has overpaid — rendered honestly rather than floored at zero, because an
   * overpayment is a fact (paid twice, or paid ahead of a future charge), not
   * an error (`model Payment`'s own comment). */
  readonly openAmount: number;
  readonly state: DerivedChargeState;
}

/**
 * Derives one charge's balance from its own `amount`/`status` and the
 * `amount`s of the payments recorded against it.
 *
 * `WAIVED`/`CANCELLED` are administrative decisions and take priority over
 * whatever has been paid — a waived charge reads as `WAIVED` even if a
 * payment somehow exists against it (the service layer does not prevent
 * recording a payment against a waived/cancelled charge in the general case,
 * because a payment received BEFORE a late cancellation is exactly the kind
 * of history D-134's append-only spirit says must not be hidden retroactively;
 * see `recordPayment`'s own comment).
 */
export function deriveChargeBalance(
  charge: { readonly amount: number; readonly status: StoredChargeStatus },
  payments: readonly { readonly amount: number }[],
): ChargeBalance {
  const paidAmount = sumAmounts(payments);
  const openAmount = charge.amount - paidAmount;

  if (charge.status === "WAIVED") {
    return { paidAmount, openAmount, state: "WAIVED" };
  }
  if (charge.status === "CANCELLED") {
    return { paidAmount, openAmount, state: "CANCELLED" };
  }
  if (paidAmount <= 0) {
    return { paidAmount, openAmount, state: "OPEN" };
  }
  if (openAmount <= 0) {
    return { paidAmount, openAmount, state: "PAID" };
  }
  return { paidAmount, openAmount, state: "PARTIAL" };
}

function sumAmounts(payments: readonly { readonly amount: number }[]): number {
  return payments.reduce((total, payment) => total + payment.amount, 0);
}

/**
 * The running balance across a set of charges — "openstaand" on the payer/
 * student view. `WAIVED`/`CANCELLED` charges contribute nothing (nothing is
 * owed on them, by decision); every other charge contributes its
 * `openAmount` — zero once paid in full, negative when overpaid, exactly the
 * per-charge figure this function sums.
 */
export function runningBalance(balances: readonly ChargeBalance[]): number {
  return balances
    .filter(
      (balance) => balance.state !== "WAIVED" && balance.state !== "CANCELLED",
    )
    .reduce((total, balance) => total + balance.openAmount, 0);
}
