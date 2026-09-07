/**
 * Publishing a `CriterionSet` — D-081's `DRAFT -> ACTIVE` transition, and the
 * two checks that make it a real gate rather than a formality.
 *
 * Pure functions over rows. No I/O — the transaction that reads the previous
 * `ACTIVE` version and writes both rows lives in
 * `application/criterion-set-service.ts`.
 */

/** Why a `CriterionSet` could not be published, or corrected. */
export type CriterionSetRefusal = "NOT_DRAFT" | "EMPTY_SET" | "NO_PASS_FLOOR";

export class CriterionSetError extends Error {
  constructor(public readonly reason: CriterionSetRefusal) {
    super(CRITERION_SET_MESSAGES[reason]);
    this.name = "CriterionSetError";
  }
}

const CRITERION_SET_MESSAGES: Record<CriterionSetRefusal, string> = {
  NOT_DRAFT:
    "Deze eisenset is niet in concept en kan niet worden gewijzigd of " +
    "opnieuw gepubliceerd (D-081). Een correctie wordt een nieuwe versie.",
  EMPTY_SET:
    "Deze eisenset heeft nog geen enkele eis. Voeg er minstens één toe " +
    "voordat de set wordt gepubliceerd — een gepubliceerde lege set kan " +
    "nooit gehaald worden.",
  NO_PASS_FLOOR:
    "Deze eisenset heeft nog geen minimale beoordeling ingesteld " +
    "(passFloorGradeId). Zonder ondergrens kan D-080's slaag-regel niets " +
    "berekenen.",
};

/**
 * The rule for publishing, checked BEFORE the write — the
 * `assertSequenceIsFree`/`assertCanEnrol` shape: a sentence here, an index or
 * a NOT NULL check underneath for the path nobody wrote a check for.
 */
export function assertCanPublish(set: {
  readonly status: string;
  readonly passFloorGradeId: string | null;
  readonly criterionCount: number;
}): void {
  if (set.status !== "DRAFT") throw new CriterionSetError("NOT_DRAFT");
  if (set.passFloorGradeId === null) {
    throw new CriterionSetError("NO_PASS_FLOOR");
  }
  if (set.criterionCount === 0) throw new CriterionSetError("EMPTY_SET");
}

/** Refuses an edit outright when the set is not `DRAFT` (D-081). */
export function assertIsDraft(status: string): void {
  if (status !== "DRAFT") throw new CriterionSetError("NOT_DRAFT");
}

/** 1, 2, 3 ... per `AwardType`. MAX + 1, never COUNT + 1. */
export function nextVersion(versions: readonly { version: number }[]): number {
  if (versions.length === 0) return 1;
  return Math.max(...versions.map((set) => set.version)) + 1;
}
