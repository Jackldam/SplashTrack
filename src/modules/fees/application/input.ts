/**
 * The bounds this module writes within. The coercion is `@/lib/validation`'s
 * — see `@/modules/exams/application/input.ts` for the precedent the split
 * follows here.
 */

export const TEXT_MAX = {
  /** An id arriving from a form field. */
  id: 40,
  /** `FeeType.code` — the club's own short identifier, the `AwardType.code`
   * bound. */
  code: 40,
  /** `FeeType.name` — *"Contributie"*, *"Examengeld Diploma A"*. */
  name: 120,
  /** `Charge.note`/`Payment.reference` — plain, unprotected administration
   * text about the money, never about the child (`model Charge`'s own
   * comment). */
  note: 1000,
  /** A waive/cancel reason, in the actor's own words — the
   * `GroupMove.reason`/`CriterionWaiver.reason` bound. */
  reason: 500,
  /** `Payment.reference` shares `note`'s bound; kept as its own name so a
   * future divergence does not have to touch both call sites. */
  reference: 1000,
} as const;

/** The single currency this phase supports — see `model FeeType`'s own
 * comment for why the column exists without a picker. */
export const SUPPORTED_CURRENCY = "EUR";
