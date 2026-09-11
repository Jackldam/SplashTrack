/**
 * `ExamResult` as an append-only log (D-062), and `Award`'s revocation rule.
 *
 * Pure functions over rows. No I/O, and no clock of their own — the exact
 * `effectiveAssessmentsByCriterionSet` shape, applied a fourth time.
 */

export type ExamResultOutcomeValue = "PASS" | "FAIL";

/** One recorded result, as much of it as the derivation needs. */
export interface ExamResultEntry {
  readonly id: string;
  readonly candidateId: string;
  readonly outcome: ExamResultOutcomeValue;
  readonly recordedAt: Date;
  readonly supersedesResultId: string | null;
}

/** The current answer per candidate, and the row that gives it. */
export interface EffectiveExamResult {
  readonly resultId: string;
  readonly outcome: ExamResultOutcomeValue;
  readonly recordedAt: Date;
}

/**
 * The EFFECTIVE result per candidate, for a set of rows — D-062's own words:
 * "the effective result is the latest non-superseded row; exactly one exists
 * per candidate at any time." Ties resolve by insertion order (callers pass
 * rows ordered by `createdAt`), the `effectiveAssessmentsByCriterionSet`
 * convention.
 */
export function effectiveResultsByCandidate(
  entries: readonly ExamResultEntry[],
): Map<string, EffectiveExamResult> {
  const superseded = new Set<string>();
  for (const entry of entries) {
    if (entry.supersedesResultId !== null) {
      superseded.add(entry.supersedesResultId);
    }
  }

  const latest = new Map<string, EffectiveExamResult>();
  for (const entry of entries) {
    if (superseded.has(entry.id)) continue;
    const current = latest.get(entry.candidateId);
    if (!current || entry.recordedAt >= current.recordedAt) {
      latest.set(entry.candidateId, {
        resultId: entry.id,
        outcome: entry.outcome,
        recordedAt: entry.recordedAt,
      });
    }
  }
  return latest;
}

/** Why an exam-result or award write was refused. */
export type ExamResultRefusal =
  | "CANDIDATE_NOT_FOUND"
  | "CANDIDATE_NOT_CONFIRMED"
  | "SUPERSEDED_RESULT_MISMATCH"
  | "CORRECTION_REASON_REQUIRED"
  | "RESULT_NOT_FOUND"
  | "RESULT_NOT_PASS"
  | "RESULT_ALREADY_HAS_AWARD"
  | "AWARD_NOT_FOUND"
  | "AWARD_ALREADY_REVOKED"
  | "REVOKE_REASON_REQUIRED";

export class ExamResultError extends Error {
  constructor(public readonly reason: ExamResultRefusal) {
    super(EXAM_RESULT_MESSAGES[reason]);
    this.name = "ExamResultError";
  }
}

const EXAM_RESULT_MESSAGES: Record<ExamResultRefusal, string> = {
  CANDIDATE_NOT_FOUND: "Deze examenkandidaat bestaat niet.",
  CANDIDATE_NOT_CONFIRMED:
    "Deze kandidaat is niet bevestigd voor het examen. Een examenresultaat " +
    "wordt alleen vastgelegd voor een bevestigde kandidaat.",
  SUPERSEDED_RESULT_MISMATCH:
    "Het te corrigeren resultaat hoort niet bij deze kandidaat. Een " +
    "correctie wijst altijd naar het resultaat dat zij vervangt.",
  CORRECTION_REASON_REQUIRED:
    "Voor een correctie of herbeoordeling van een examenresultaat is een " +
    "reden verplicht.",
  RESULT_NOT_FOUND: "Dit examenresultaat bestaat niet.",
  RESULT_NOT_PASS:
    "Een diploma/certificaat wordt alleen uitgereikt tegen een geslaagd " +
    "resultaat.",
  RESULT_ALREADY_HAS_AWARD:
    "Voor dit resultaat is al een diploma/certificaat uitgereikt.",
  AWARD_NOT_FOUND: "Dit diploma/certificaat bestaat niet.",
  AWARD_ALREADY_REVOKED: "Dit diploma/certificaat is al ingetrokken.",
  REVOKE_REASON_REQUIRED:
    "Voor het intrekken van een diploma/certificaat is een reden verplicht.",
};
