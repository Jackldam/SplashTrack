/**
 * The half-open interval every time-bounded relation in this module is.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE SHAPE, TWO TABLES, AND ONE SECURITY CONSEQUENCE
 *
 * `GroupMembership` and `InstructorAssignment` are the same shape — a
 * `fromDate` and a nullable `toDate` — and D-145 rule 1 turns BOTH into an
 * access decision: a `GROUP`-scoped instructor reaches a pupil only while their
 * own assignment AND that pupil's membership are open *at query time*. So
 * "is this interval active right now" is not a display convenience; it is the
 * predicate. It gets one definition, here, rather than one per call site.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HALF-OPEN, AND THE END IS EXCLUSIVE
 *
 * `from <= at < to`. The alternative — an inclusive end — makes the last day of
 * one placement and the first day of the next the same day, so a child moving
 * groups is in both at once for twenty-four hours. That is not a rounding
 * error: it is a day on which two instructors can read the child's record and
 * neither of them is wrong, and it is exactly the ambiguity D-145 exists to
 * remove.
 *
 * The database agrees, in `GroupMembership_window_order_check` and its sibling:
 * `toDate > fromDate`, so a zero-length interval — which under this rule is
 * active for no instant at all — cannot be written and then puzzled over.
 */

/** Any row with an open-ended validity window. */
export interface Interval {
  readonly fromDate: Date;
  /** NULL = still open. The only "currently" signal there is. */
  readonly toDate: Date | null;
}

/** Is this interval running at `at`? `from <= at < to`. */
export function isActiveAt(interval: Interval, at: Date): boolean {
  if (interval.fromDate.getTime() > at.getTime()) return false;
  if (interval.toDate === null) return true;
  return interval.toDate.getTime() > at.getTime();
}

/** The interval, or intervals, that are open — `toDate === null`. */
export function openIntervals<T extends Interval>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.toDate === null);
}

/** Thrown when a caller asks for an interval the database would refuse. */
export class IntervalError extends Error {
  constructor(
    public readonly reason:
      "endsBeforeItStarts" | "alreadyClosed" | "noOpenInterval",
    message: string,
  ) {
    super(message);
    this.name = "IntervalError";
  }
}

/**
 * Refuses a close that the `*_window_order_check` constraint would refuse
 * anyway.
 *
 * IN THE SERVICE **AND** AT THE DATABASE, deliberately. The constraint is the
 * control — it holds against a path nobody has written yet — and this is what
 * turns the refusal into a sentence an administrator can act on rather than a
 * Prisma error code in a log.
 */
export function assertClosable(interval: Interval, toDate: Date): void {
  if (interval.toDate !== null) {
    throw new IntervalError(
      "alreadyClosed",
      "This has already been ended. Ending it again would rewrite history " +
        "rather than record something new.",
    );
  }
  if (toDate.getTime() <= interval.fromDate.getTime()) {
    throw new IntervalError(
      "endsBeforeItStarts",
      "An end date must fall after the start date. An interval that ends " +
        "before it begins is active for no instant at all, which reads as a " +
        "silently dead placement.",
    );
  }
}
