/**
 * A group's capacity, and what it counts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT COUNTS IS A DECISION THE DESIGN DID NOT MAKE
 *
 * D-180 needs capacity to exist — *"placement is a matching decision: a human
 * looks for a group at the right level with room"*, so "with room" must be
 * answerable — and no chapter says what the number counts. The question went to
 * the domain expert and was not answered inside the build window.
 *
 * **The reading implemented: places in the GROUP.** The ceiling is checked
 * against open `GroupMembership` rows, and a make-up guest does not consume one.
 *
 * That is the reading that keeps the two governing decisions coherent with each
 * other. D-180 makes capacity an input to a *placement* decision, and placement
 * writes a `GroupMembership`. D-179 says a make-up guest is *not in the group* —
 * their attendance and the instructor's sight of them come from participation in
 * one session — so a guest who consumed a place would be occupying something
 * they explicitly do not hold, and a full group would start refusing make-up
 * lessons, which is the opposite of what a make-up lesson is for.
 *
 * If the club means "bodies in the water at one lesson", the check moves to the
 * session roster and this file is where it moves from. Recorded in
 * `docs/glossary.md` and in the phase 1.6 report as the one of the three
 * unanswered questions worth correcting early.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS A CEILING AN ADMINISTRATOR MAY EXCEED
 *
 * Enforced in the service and NOT by a CHECK constraint, deliberately. A club
 * puts a thirteenth child in a group of twelve because the family moved and the
 * other evening is full, and a rule that cannot be overridden gets worked around
 * — by raising the capacity to 13 and forgetting, which destroys the number's
 * meaning permanently. So the ceiling REFUSES by default and takes an explicit,
 * recorded override; the audit event carries which happened.
 */

export interface CapacityState {
  /** Null when nobody has stated one — unknown, never unlimited. */
  readonly capacity: number | null;
  /** Open `GroupMembership` rows right now. */
  readonly occupied: number;
}

export class GroupFullError extends Error {
  constructor(
    public readonly capacity: number,
    public readonly occupied: number,
  ) {
    super(
      `This group holds ${capacity} and already has ${occupied}. Placing ` +
        "another needs an explicit override with a reason — raising the " +
        "capacity instead would destroy what the number means.",
    );
    this.name = "GroupFullError";
  }
}

/** Places left, or null when no capacity is stated. */
export function placesRemaining(state: CapacityState): number | null {
  if (state.capacity === null) return null;
  return Math.max(0, state.capacity - state.occupied);
}

/**
 * Is there room? **Null capacity answers `true`** — an unstated ceiling cannot
 * refuse anybody, and the screen shows it as unknown rather than as unlimited so
 * the administrator knows which of the two they are looking at.
 */
export function hasRoom(state: CapacityState): boolean {
  const remaining = placesRemaining(state);
  return remaining === null || remaining > 0;
}

/** Refuses a placement into a full group unless the caller overrides. */
export function assertHasRoom(state: CapacityState, override: boolean): void {
  if (override || hasRoom(state)) return;
  throw new GroupFullError(state.capacity!, state.occupied);
}
