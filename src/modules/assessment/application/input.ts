/**
 * The bounds this module writes within. The coercion is `@/lib/validation`'s —
 * see `@/modules/skills/application/input.ts` for why the split falls there.
 */

export const TEXT_MAX = {
  /** An id arriving from a form field. */
  id: 40,
  /**
   * A remark in the assessor's own words. Bounded the same as
   * `SkillProgress.note`/`GroupMove.reason` — generous, because refusing a
   * legitimate observation for being long is the wrong failure. Applies to
   * both `Assessment.remark` (sitting-level, unprotected — decided
   * 2026-09-10, `docs/build/phase-2.3-assessment-report.md` §1.5) and
   * `AssessmentCriterionResult.remark` (criterion-level, still protected
   * free text under D-087/D-148) — the bound is about typing effort, not
   * about which protection regime the column carries.
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
