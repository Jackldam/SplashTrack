/**
 * The bounds this module writes within. The coercion is `@/lib/validation`'s —
 * see `@/modules/people/application/input.ts` for why the split falls there.
 */

export const TEXT_MAX = {
  /** *"Zwem-ABC"*, *"Snorkelduiken"*. The same bound a group name gets. */
  courseName: 120,
  /** *"Diploma B"*, *"Niveau 3 — schoolslag"*. */
  levelName: 120,
  /**
   * What a course is, for the administrator choosing between two of them. A
   * paragraph, not a syllabus: the requirements themselves belong to an award's
   * `CriterionSet` (`15-assessment-and-fees.md` §2.6), which is a module that
   * does not exist yet, and a bound generous enough to invite one here would
   * start a second home for them.
   */
  courseDescription: 2000,
  /** An id arriving from a form field. */
  id: 40,
} as const;

/**
 * The largest position a level may be given.
 *
 * A BOUND, NOT A RULE ABOUT SWIMMING, on exactly the reasoning `CAPACITY_MAX`
 * records: it exists to refuse the value a data-entry accident produces — a
 * stray digit turning 4 into 400 — while never refusing a number a club might
 * mean. No course has a thousand levels; the Zwem-ABC has three. The database's
 * own `CourseLevel_sequence_positive_check` holds the floor.
 */
export const SEQUENCE_MAX = 999;
