/**
 * Membership as a SET OF INTERVALS (D-059), and the derivations that replace the
 * `status` column phase 0.3 deleted.
 *
 * *"Belonging is a set of intervals, not a status flag"* (`01-domain-model.md`
 * §3.1). Everything here follows from that one sentence:
 *
 *   - "Is this person a member?" is a QUESTION ABOUT THE ROWS, answered by
 *     whether an open period covers the instant asked about. It is never read
 *     from a column, because a column has to be written by someone who
 *     remembered, and the answer it gives is only as fresh as that.
 *   - "When were they a member?" keeps its answer forever. That is the question
 *     a flag destroys, and it is the one contributions, insurance and retention
 *     are all decided from.
 *   - Leaving and returning is a NEW PERIOD. Never a mutated row, never a second
 *     `Membership`, and never a reopened `endedAt` — the member number stays the
 *     same across the gap, which is what makes the gap visible instead of
 *     invisible.
 *
 * Pure functions over rows. No I/O, and no clock of their own: `at` is passed,
 * so one request answers every question against one instant.
 */

/** One interval of belonging, as much of it as a derivation needs. */
export interface MembershipInterval {
  readonly startedAt: Date;
  /** Null = open. The ONLY current-membership signal there is. */
  readonly endedAt: Date | null;
}

/** Does this interval cover `at`? Half-open `[startedAt, endedAt)`. */
export function coversInstant(period: MembershipInterval, at: Date): boolean {
  return (
    at >= period.startedAt && (period.endedAt === null || at < period.endedAt)
  );
}

/**
 * Is this person a member right now — the derived answer to the question the
 * deleted `status` column used to be asked.
 *
 * Any covering period suffices. A back-filled historical period that happens to
 * overlap today is still a period of belonging, and preferring the "open" one
 * would be inventing a precedence rule the domain does not have.
 */
export function isCurrentlyAMember(
  periods: readonly MembershipInterval[],
  at: Date,
): boolean {
  return periods.some((period) => coversInstant(period, at));
}

/**
 * The one OPEN period, if there is one. At most one can exist —
 * `MembershipPeriod_single_open_period_key` is a partial unique index, so this
 * returning "the first" is not a tie-break hiding an ambiguity.
 */
export function openPeriod<T extends MembershipInterval>(
  periods: readonly T[],
): T | null {
  return periods.find((period) => period.endedAt === null) ?? null;
}

/**
 * When the LAST period ended, for D-066's retention clock.
 *
 * Returns `null` when a period is still open (the clock has not started) and
 * `undefined` when there are no periods at all (this source never held them, and
 * says so rather than inventing a date).
 */
export function lastMembershipEnd(
  periods: readonly MembershipInterval[],
): Date | null | undefined {
  if (periods.length === 0) return undefined;
  if (periods.some((period) => period.endedAt === null)) return null;
  return periods.reduce<Date>(
    (latest, period) => (period.endedAt! > latest ? period.endedAt! : latest),
    periods[0]!.endedAt!,
  );
}

/** Why a request to start or end a period was refused. */
export type MembershipPeriodRefusal =
  "ALREADY_OPEN" | "NOT_OPEN" | "ENDS_BEFORE_IT_STARTS";

export class MembershipPeriodError extends Error {
  constructor(public readonly reason: MembershipPeriodRefusal) {
    super(MEMBERSHIP_PERIOD_MESSAGES[reason]);
    this.name = "MembershipPeriodError";
  }
}

const MEMBERSHIP_PERIOD_MESSAGES: Record<MembershipPeriodRefusal, string> = {
  ALREADY_OPEN:
    "This member already has an open membership period. Belonging is a set of " +
    "intervals (D-059): end the current period before starting a new one, so " +
    "the gap between them is a fact the record carries rather than one it hides.",
  NOT_OPEN:
    "This member has no open membership period to end. A closed period is " +
    "never reopened and never edited — returning starts a NEW period, which is " +
    "what keeps 'when were they a member?' answerable.",
  ENDS_BEFORE_IT_STARTS: "A membership period cannot end before it started.",
};

/**
 * The rule for starting a period, checked BEFORE the write so the caller gets a
 * domain error rather than a unique-index violation from Postgres.
 *
 * The index is still the control — this is the message. Both, deliberately: the
 * check without the index is a race, and the index without the check is a stack
 * trace where a sentence belongs.
 */
export function assertCanStartPeriod(
  periods: readonly MembershipInterval[],
): void {
  if (openPeriod(periods) !== null) {
    throw new MembershipPeriodError("ALREADY_OPEN");
  }
}

/** The rule for ending one. */
export function assertCanEndPeriod(
  periods: readonly MembershipInterval[],
  endedAt: Date,
): MembershipInterval {
  const open = openPeriod(periods);
  if (open === null) throw new MembershipPeriodError("NOT_OPEN");
  if (endedAt <= open.startedAt) {
    throw new MembershipPeriodError("ENDS_BEFORE_IT_STARTS");
  }
  return open;
}
