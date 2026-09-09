/**
 * The bounds this module writes within. The coercion is `@/lib/validation`'s —
 * see `@/modules/people/application/input.ts` for why the split falls there.
 */

export const TEXT_MAX = {
  /** *"Diploma B donderdag 18:00"* fits with room to spare. */
  groupName: 120,
  /**
   * A group move's reason (D-108). A sentence, not a case file — and the same
   * bound `people` gives a lifecycle reason, because it is the same kind of
   * text written by the same person about the same child.
   */
  reason: 500,
  /** The club's own word for what an instructor does with a group. */
  instructorRole: 60,
  /** A search box. */
  query: 120,
} as const;

/**
 * The largest capacity a group may be given.
 *
 * A BOUND, NOT A RULE ABOUT SWIMMING. `00-overview.md` §4.1 uses thirty as the
 * group size the product thesis and the latency NFR are written against, and
 * this is well above it. It exists to refuse the value a data-entry accident
 * actually produces — a stray digit turning 12 into 120 — while never refusing a
 * number a club might mean. The database's own
 * `Group_capacity_positive_check` holds the floor.
 */
export const CAPACITY_MAX = 500;
