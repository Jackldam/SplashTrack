/**
 * The order of a criterion set's criteria — on the exact
 * `@/modules/courses/domain/course-level.ts` pattern this module duplicates
 * rather than imports.
 *
 * WHY THIS DUPLICATES `courses`' `nextSequence`/`assertSequenceIsFree`
 *
 * It does not, quite: those are the same SHAPE (a position, allocated
 * MAX + 1, unique per parent) over a different table answering a different
 * question, and each module owns the rule for its own — the reasoning
 * `courses/domain/enrolment.ts` gives for not importing `groups`' `isActiveAt`
 * applies here in the other direction. Importing `courses`' version would also
 * put a dependency the wrong way round: `skills` may depend on `courses`
 * (it already does, for `awardTypeOfCourseLevel`), but a criterion's ordering
 * rule has nothing to do with a course's, and collapsing them would make a
 * future change to one silently require checking the other.
 *
 * Pure functions over rows. No I/O.
 */

/** As much of a criterion as an ordering decision needs. */
export interface SequencedCriterion {
  readonly sequence: number;
}

/** The next free position in a set, 1-based. MAX + 1, never COUNT + 1. */
export function nextSequence(criteria: readonly SequencedCriterion[]): number {
  if (criteria.length === 0) return 1;
  return Math.max(...criteria.map((criterion) => criterion.sequence)) + 1;
}

/** Criteria in the order the set states them. */
export function inSequence<T extends SequencedCriterion>(
  criteria: readonly T[],
): T[] {
  return [...criteria].sort((left, right) => left.sequence - right.sequence);
}

/** Why a criterion could not be created or corrected. */
export type CriterionRefusal = "SEQUENCE_TAKEN" | "SET_NOT_DRAFT";

export class CriterionError extends Error {
  constructor(public readonly reason: CriterionRefusal) {
    super(CRITERION_MESSAGES[reason]);
    this.name = "CriterionError";
  }
}

const CRITERION_MESSAGES: Record<CriterionRefusal, string> = {
  SEQUENCE_TAKEN:
    "Er staat al een eis op die plek in de volgorde van deze set. Kies een " +
    "andere plek.",
  SET_NOT_DRAFT:
    "Deze eisenset is gepubliceerd of ingetrokken en kan niet meer worden " +
    "gewijzigd (D-081). Een fout wordt rechtgezet in een nieuwe versie, nooit " +
    "in deze.",
};

/** Refuses a position the unique index would refuse anyway. */
export function assertSequenceIsFree(
  criteria: readonly (SequencedCriterion & { readonly id: string })[],
  sequence: number,
  exceptCriterionId: string | null,
): void {
  const clash = criteria.some(
    (criterion) =>
      criterion.sequence === sequence && criterion.id !== exceptCriterionId,
  );
  if (clash) throw new CriterionError("SEQUENCE_TAKEN");
}

/** Refuses the write outright when the parent set is not `DRAFT` (D-081). */
export function assertSetIsDraft(status: string): void {
  if (status !== "DRAFT") throw new CriterionError("SET_NOT_DRAFT");
}
