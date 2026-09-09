/**
 * Enrolment as an INTERVAL, and the vocabulary that goes with it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * "IS THIS PUPIL ENROLLED?" IS A QUESTION ABOUT THE ROWS
 *
 * D-059's rule, applied to a third table: belonging is a set of intervals, not
 * a status flag. `Enrolment.status` says what KIND of participation this is —
 * an ordinary pupil or a *proefzwemmer* — and says nothing about whether it is
 * running. That is `endedAt IS NULL`, and it is the only signal there is.
 *
 * The alternative was an `ACTIVE`/`ENDED` pair inside the status enum, which
 * would have been a second answer to one question (D-134) and would have gone
 * stale the first time somebody closed a row without updating the column. It is
 * the same reason `Membership` has no flag and `GroupMembership` has none.
 *
 * `15-assessment-and-fees.md` §6 reads *"active `Enrolment`"* when it generates
 * a contribution charge, and gets it from here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS DUPLICATES `people`'s `coversInstant` AND `groups`' `isActiveAt`
 *
 * It does not, quite: those are the same SHAPE over different columns
 * (`startedAt/endedAt`, `fromDate/toDate`) answering questions about different
 * tables, and each module owns the rule for its own. Importing one module's
 * domain function into another to save four lines would put "when is an
 * enrolment running" in a file the `courses` module does not own, which is what
 * `CLAUDE.md` §4 forbids and what makes a rule drift when one caller needs a
 * boundary the other does not. The SHAPE is shared; the RULE has one home each.
 *
 * Pure functions over rows. No I/O, and no clock of their own: `at` is passed,
 * so one request answers every question against one instant.
 */

import type { EnrolmentStatus } from "@/lib/database";

/**
 * The status vocabulary, in the order a form offers it.
 *
 * `ENROLLED` first because it is the ordinary case; `TRIAL` is D-109's
 * *proefzwemmer* and is a model with no workflow behind it — there is no
 * booking flow, no conversion funnel and no entitlement counter anywhere in
 * this module, and adding one is not a small change but a different decision.
 *
 * Typed against the generated Prisma enum rather than restating it, so a member
 * added to the schema and not to this list fails to compile.
 */
export const ENROLMENT_STATUSES = [
  "ENROLLED",
  "TRIAL",
] as const satisfies readonly EnrolmentStatus[];

export type EnrolmentStatusValue = (typeof ENROLMENT_STATUSES)[number];

/** One enrolment interval, as much of it as a derivation needs. */
export interface EnrolmentInterval {
  readonly startedAt: Date;
  /** Null = still enrolled. The ONLY signal there is. */
  readonly endedAt: Date | null;
}

/**
 * Is this enrolment running at `at`? Half-open `[startedAt, endedAt)`.
 *
 * END EXCLUSIVE, the same reading `groups/domain/interval.ts` argues for: an
 * inclusive end makes the last day of one enrolment and the first day of the
 * next the same day, so a pupil moving from one course to another is in both
 * for twenty-four hours — and this interval is an ACCESS decision
 * (`isEnrolledInCourse`, §2.2), so that ambiguity is a day on which two
 * principals reach the child and neither is wrong.
 */
export function isEnrolledAt(enrolment: EnrolmentInterval, at: Date): boolean {
  return (
    at >= enrolment.startedAt &&
    (enrolment.endedAt === null || at < enrolment.endedAt)
  );
}

/**
 * The one OPEN enrolment for a course, if there is one.
 *
 * At most one can exist per (course, pupil) —
 * `Enrolment_single_open_enrolment_key` is a partial unique index — so
 * returning "the first" is not a tie-break hiding an ambiguity.
 */
export function openEnrolment<T extends EnrolmentInterval>(
  enrolments: readonly T[],
): T | null {
  return enrolments.find((enrolment) => enrolment.endedAt === null) ?? null;
}

/**
 * When the LAST enrolment ended, for D-066's retention clock.
 *
 * `null` when one is still open (the clock has not started) and `undefined`
 * when there are none at all — this source never held the person, and says so
 * rather than inventing a date. The same three-valued answer
 * `lastMembershipEnd` gives, because `resolveLastRelationshipEnd` distinguishes
 * all three.
 */
export function lastEnrolmentEnd(
  enrolments: readonly EnrolmentInterval[],
): Date | null | undefined {
  if (enrolments.length === 0) return undefined;
  if (enrolments.some((enrolment) => enrolment.endedAt === null)) return null;
  return enrolments.reduce<Date>(
    (latest, enrolment) =>
      enrolment.endedAt! > latest ? enrolment.endedAt! : latest,
    enrolments[0]!.endedAt!,
  );
}

/** Why a request to start or end an enrolment was refused. */
export type EnrolmentRefusal =
  "ALREADY_ENROLLED" | "NOT_ENROLLED" | "ENDS_BEFORE_IT_STARTS";

export class EnrolmentError extends Error {
  constructor(public readonly reason: EnrolmentRefusal) {
    super(ENROLMENT_MESSAGES[reason]);
    this.name = "EnrolmentError";
  }
}

const ENROLMENT_MESSAGES: Record<EnrolmentRefusal, string> = {
  ALREADY_ENROLLED:
    "This pupil already has an open enrolment in this course. Enrolment is a " +
    "set of intervals (D-059): end the current one before starting another, " +
    "so the gap between them is a fact the record carries rather than one it " +
    "hides. Converting a trial works the same way — close the TRIAL, then " +
    "open an ENROLLED one, and the record that the trial happened survives.",
  NOT_ENROLLED:
    "This pupil has no open enrolment in this course to end. A closed " +
    "enrolment is never reopened and never edited — returning starts a NEW " +
    "one, which is what keeps 'was this child enrolled last March?' " +
    "answerable.",
  ENDS_BEFORE_IT_STARTS:
    "An enrolment cannot end before it started. An interval that ends before " +
    "it begins is running for no instant at all, which reads as a silently " +
    "dead enrolment — and this one decides what a COURSE-scoped principal may " +
    "see.",
};

/**
 * The rule for starting an enrolment, checked BEFORE the write so the caller
 * gets a sentence rather than a unique-index violation from Postgres.
 *
 * The index is still the control — this is the message. Both, deliberately: the
 * check without the index is a race, and the index without the check is a stack
 * trace where an explanation belongs.
 */
export function assertCanEnrol(enrolments: readonly EnrolmentInterval[]): void {
  if (openEnrolment(enrolments) !== null) {
    throw new EnrolmentError("ALREADY_ENROLLED");
  }
}

/** The rule for ending one. Returns the open enrolment it will close. */
export function assertCanEndEnrolment<T extends EnrolmentInterval>(
  enrolments: readonly T[],
  endedAt: Date,
): T {
  const open = openEnrolment(enrolments);
  if (open === null) throw new EnrolmentError("NOT_ENROLLED");
  if (endedAt <= open.startedAt) {
    throw new EnrolmentError("ENDS_BEFORE_IT_STARTS");
  }
  return open;
}
