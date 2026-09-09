/**
 * The bounds this module writes within. The coercion is `@/lib/validation`'s —
 * see `@/modules/skills/application/input.ts` for why the split falls there.
 */

export const TEXT_MAX = {
  /** An id arriving from a form field. */
  id: 40,
  /**
   * A protected-free-text remark (D-087/D-148), in the assessor's own words.
   * Bounded the same as `SkillProgress.note`/`GroupMove.reason` — generous,
   * because refusing a legitimate observation for being long is the wrong
   * failure. Applies to `Assessment.remark` and
   * `AssessmentCriterionResult.remark` alike.
   */
  remark: 1000,
  /** `CriterionWaiver.reason` — why a criterion was not required. */
  waiverReason: 500,
};

/**
 * The largest number of criteria one sitting may carry results/waivers for —
 * a bound against a data-entry accident (a malformed bulk submission), never
 * a rule about how large a criterion set may be. `SEQUENCE_MAX`'s reasoning.
 */
export const RESULTS_MAX_ENTRIES = 200;
