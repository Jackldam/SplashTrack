/**
 * The bounds this module writes within. The coercion is `@/lib/validation`'s —
 * see `@/modules/courses/application/input.ts` for why the split falls there.
 */

export const TEXT_MAX = {
  /** An id arriving from a form field. */
  id: 40,
  /**
   * A client-generated idempotency key (P-02). A UUID is 36 characters; the
   * bound is a data-entry accident guard, not a format rule — the FORMAT is
   * whatever the client generates, as long as it is unique.
   */
  clientEventId: 64,
  /**
   * An attendance note, in the recorder's own words — *"opgehaald door oma om
   * 17:30"*. Bounded like `SkillProgress.note`, and carrying the same D-148
   * open question (see the schema comment).
   */
  note: 1000,
} as const;

/**
 * The most pupils one registration will accept in one transaction. A group
 * holds around twelve children (D-111's own number); a register arriving with
 * hundreds of entries is a defect or an attack, not a lesson.
 */
export const REGISTER_MAX_ENTRIES = 200;
