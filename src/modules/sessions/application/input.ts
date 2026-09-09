/**
 * The bounds this module writes within. The coercion is `@/lib/validation`'s.
 */

export const TEXT_MAX = {
  /** *"Instructiebad"*, *"Wedstrijdbad 25m"*. */
  poolName: 80,
  /** *"baan 1"*, *"ondiep"*. */
  laneName: 40,
  /** A closure's reason, a cancellation's reason, a guest's reason. */
  reason: 500,
} as const;

/**
 * The widest window `generateSessions` will expand in one call.
 *
 * A BOUND ON WORK, not on how far ahead a club may plan. A recurrence with no
 * `endsOn` plus a `to` of the year 2400 is one mistyped field away, and it would
 * ask the database to insert a hundred and forty thousand lessons inside one
 * transaction. Eighteen months comfortably covers "generate next season" — the
 * only thing anybody actually does — and a club that wants more runs it twice,
 * which is safe precisely because generation is idempotent.
 */
export const MAX_GENERATION_DAYS = 550;

/** A lane's presentation order. A bound to refuse a mistyped value, nothing more. */
export const SEQUENCE_MAX = 999;

/** Pool lengths that exist. 12.5m paddling pools to 50m Olympic. */
export const POOL_LENGTH_MAX = 100;
