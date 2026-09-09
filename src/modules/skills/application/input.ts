/**
 * The bounds this module writes within. The coercion is `@/lib/validation`'s —
 * see `@/modules/courses/application/input.ts` for why the split falls there.
 */

export const TEXT_MAX = {
  /** *"A"*, *"ZWEMVAARDIGHEID-1"* — an `AwardType`'s own short code. */
  awardTypeCode: 40,
  /** *"Zwemdiploma A"*, *"Survival brons"*. */
  awardTypeName: 120,
  /** *"A1"*, *"BORSTCRAWL-25"* — a `Criterion`'s own short code within its set. */
  criterionCode: 40,
  /** *"Borstcrawl 25 meter"*. */
  criterionName: 200,
  /**
   * The "normering" (`docs/glossary.md`) — what is expected of the pupil and
   * how the execution must be judged. Generous like `courseDescription`, not
   * `criterionName`'s short bound: reference prose for an instructor, not a
   * line read aloud at the poolside.
   */
  criterionStandard: 2000,
  /** An id arriving from a form field. */
  id: 40,
  /**
   * A `SkillProgress` note, in the instructor's own words. Bounded the same as
   * `GroupMove.reason` and `StudentLifecycleEvent.reason` — generous, because
   * refusing a legitimate observation for being long is the wrong failure.
   */
  note: 1000,
} as const;

/**
 * The largest position a criterion may be given — `CourseLevel`'s
 * `SEQUENCE_MAX` reasoning, unchanged: a bound against a data-entry accident,
 * never a rule about how many criteria a set may hold.
 */
export const SEQUENCE_MAX = 999;
