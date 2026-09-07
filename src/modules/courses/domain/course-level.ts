/**
 * The order of a course's levels — Diploma A, then B, then C.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `sequence` IS A POSITION, AND NOTHING READS IT TO DECIDE ANYTHING
 *
 * §3.2 gives `CourseLevel` a `sequence` and says only that levels run "e.g.
 * Diploma A → B → C". It orders a list. It is deliberately NOT:
 *
 *   - a level NUMBER the club types on a form. It is allocated by
 *     {@link nextSequence} when a level is added, so the ordinary case needs no
 *     decision from the person adding it;
 *   - an input to a group move's direction. D-108 requires the direction to be
 *     RECORDED rather than derived, precisely so that a lateral move — a
 *     different evening at the same level — is not reported as a demotion. That
 *     rule does not change now that the levels it could have been derived from
 *     exist. `groups-move-symmetry.test.ts` holds it;
 *   - a progression rule. Nothing in this module says a pupil must finish A
 *     before starting B, and inventing one would be a workflow the design set
 *     does not describe.
 *
 * UNIQUE PER COURSE, at the database (`CourseLevel_courseId_sequence_key`). A
 * tie makes "what comes after this one" a question with two answers, and the
 * screens that render a course read the order as though it were single-valued.
 *
 * Pure functions over rows. No I/O.
 */

/** As much of a level as an ordering decision needs. */
export interface SequencedLevel {
  readonly sequence: number;
}

/**
 * The next free position in a course, 1-based.
 *
 * MAX + 1 rather than COUNT + 1: levels are never renumbered when one is
 * removed or reordered by hand, so a count would collide with an existing row
 * and refuse an ordinary "add another level". The database's unique index is
 * still the control — this is what makes the common path not need it.
 */
export function nextSequence(levels: readonly SequencedLevel[]): number {
  if (levels.length === 0) return 1;
  return Math.max(...levels.map((level) => level.sequence)) + 1;
}

/** Levels in the order the course teaches them; ties broken by nothing. */
export function inSequence<T extends SequencedLevel>(
  levels: readonly T[],
): T[] {
  return [...levels].sort((left, right) => left.sequence - right.sequence);
}

/** Why a level could not be created or corrected. */
export type CourseLevelRefusal = "SEQUENCE_TAKEN";

export class CourseLevelError extends Error {
  constructor(public readonly reason: CourseLevelRefusal) {
    super(COURSE_LEVEL_MESSAGES[reason]);
    this.name = "CourseLevelError";
  }
}

const COURSE_LEVEL_MESSAGES: Record<CourseLevelRefusal, string> = {
  SEQUENCE_TAKEN:
    "Another level of this course already sits at that position. Two levels " +
    "at one position make 'what comes next' a question with two answers, and " +
    "every screen that renders the course reads the order as if it had one.",
};

/**
 * Refuses a position the unique index would refuse anyway.
 *
 * IN THE SERVICE **AND** AT THE DATABASE, on the pattern
 * `assertCanStartPeriod` established: the index is the control — it holds
 * against a path nobody has written yet — and this is what turns the refusal
 * into a sentence an administrator can act on rather than a Prisma error code
 * in a log.
 */
export function assertSequenceIsFree(
  levels: readonly (SequencedLevel & { readonly id: string })[],
  sequence: number,
  exceptLevelId: string | null,
): void {
  const clash = levels.some(
    (level) => level.sequence === sequence && level.id !== exceptLevelId,
  );
  if (clash) throw new CourseLevelError("SEQUENCE_TAKEN");
}
