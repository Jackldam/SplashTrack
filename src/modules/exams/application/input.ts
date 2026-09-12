/**
 * The bounds this module writes within. The coercion is `@/lib/validation`'s —
 * see `@/modules/assessment/application/input.ts` for the precedent the split
 * follows here.
 */

export const TEXT_MAX = {
  /** An id arriving from a form field. */
  id: 40,
  /** A correction/withdrawal/override/revocation reason, in the actor's own
   * words. The `GroupMove.reason`/`CriterionWaiver.reason` bound. */
  reason: 500,
  /** `ExamResult.remarks` — plain, unprotected text, the `Assessment.remark`
   * bound (phase 2.3 report §1.5). */
  remarks: 1000,
  /** The physical certificate/diploma number an administrator types in. */
  awardNumber: 60,
};
