/**
 * `ExamCandidate`'s state machine, and D-085's formula as a pure function over
 * the facts the service resolves.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * D-085, RESTATED AT THE MOMENT THIS MODULE CAN FINALLY CHECK ALL OF IT
 *
 * `15-…` §3: `CONFIRMED` requires a non-superseded `PRE_EXAM` `Assessment`
 * with `outcome = PASS`, graded by a `PersonQualification` holder who is not
 * an `InstructorAssignment` holder for the student's group. Overridable, with
 * an audited reason.
 *
 * The assessment phase built the checkable HALF of this (independence, at
 * `recordAssessment`'s own write time) and published `qualifyingAftestFacts` —
 * a structured fact, not a boolean, carrying an explicit
 * `qualificationVerified: false` that this module must never mistake for a
 * real check (`docs/build/phase-2.3-assessment-report.md` §1.1). This module
 * is what makes `qualificationVerified` become `true`: `PersonQualification`
 * now exists, so the service resolves it and this function folds it in.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY INDEPENDENCE IS RE-CHECKED HERE TOO, NOT TRUSTED FROM ASSESSMENT'S WRITE
 *
 * `qualifyingAftestFacts.independentOfStudentGroup` is computed FRESH, live,
 * on every call — never cached from the moment the aftest was recorded. So
 * calling it again here, at confirmation time, is a genuine re-verification
 * against the CURRENT `InstructorAssignment` state, not a rubber stamp of
 * assessment's write-time decision: a pupil can move groups, or an instructor
 * assignment can end, between the aftest and the confirmation, and this
 * module's own call sees the world as it is NOW. If assessment's write was
 * itself an override (`independentAssessor: false` in its own audit trail),
 * this module's fresh check returns the same `false` unless the underlying
 * group assignment has since changed — so a write-time override does not
 * silently launder into a confirmation-time pass; `exams` must apply its OWN
 * override (`exams.candidacy.override`) to confirm anyway. See the phase 2.4
 * report §1 for the tension this resolves and why it is flagged, not assumed.
 */

/** Every reason `confirmExamCandidate` may refuse, or the state it moves to. */
export type ExamCandidateRefusal =
  | "CANDIDATE_NOT_FOUND"
  | "ALREADY_CONFIRMED"
  | "ALREADY_WITHDRAWN"
  | "NO_QUALIFYING_ASSESSMENT"
  | "NOT_INDEPENDENT"
  | "ASSESSOR_NOT_QUALIFIED"
  | "OVERRIDE_REASON_REQUIRED"
  | "STUDENT_NOT_IN_GROUP"
  | "GROUP_NOT_FOUND";

export class ExamCandidateError extends Error {
  constructor(public readonly reason: ExamCandidateRefusal) {
    super(EXAM_CANDIDATE_MESSAGES[reason]);
    this.name = "ExamCandidateError";
  }
}

const EXAM_CANDIDATE_MESSAGES: Record<ExamCandidateRefusal, string> = {
  CANDIDATE_NOT_FOUND: "Deze examenkandidaat bestaat niet.",
  ALREADY_CONFIRMED: "Deze kandidaat is al bevestigd voor het examen.",
  ALREADY_WITHDRAWN: "Deze kandidatuur is teruggetrokken.",
  NO_QUALIFYING_ASSESSMENT:
    "Er is geen geldige, geslaagde aftest voor deze leerling en dit diploma/" +
    "certificaat. Een kandidaat kan alleen worden bevestigd na een geslaagde " +
    "aftest (het vier-ogen-principe, D-085).",
  NOT_INDEPENDENT:
    "De beoordelaar van de aftest is de eigen instructeur van deze leerling — " +
    "opnieuw gecontroleerd op het moment van bevestigen. Een aftest die " +
    "meetelt voor het examen wordt afgenomen door een andere, bevoegde " +
    "instructeur. Alleen met de bijbehorende uitzonderingsbevoegdheid kan dit " +
    "toch worden bevestigd.",
  ASSESSOR_NOT_QUALIFIED:
    "De beoordelaar van de aftest heeft geen geldige bevoegdheid " +
    "(PersonQualification) op het moment van de aftest. Alleen met de " +
    "bijbehorende uitzonderingsbevoegdheid kan dit toch worden bevestigd.",
  OVERRIDE_REASON_REQUIRED:
    "Voor een uitzondering op het vier-ogen-principe is een reden verplicht.",
  STUDENT_NOT_IN_GROUP:
    "Deze leerling is geen actief lid van de opgegeven groep.",
  GROUP_NOT_FOUND: "Deze groep bestaat niet.",
};

/** The three checkable clauses of D-085, resolved to booleans by the service. */
export interface ConfirmationChecks {
  readonly hasQualifyingAssessment: boolean;
  readonly independentOfStudentGroup: boolean | null;
  readonly assessorHoldsValidQualification: boolean;
}

/** Which of D-085's clauses failed, in the order the design states them. */
export type ConfirmationFailure = Exclude<
  ExamCandidateRefusal,
  | "CANDIDATE_NOT_FOUND"
  | "ALREADY_CONFIRMED"
  | "ALREADY_WITHDRAWN"
  | "OVERRIDE_REASON_REQUIRED"
  | "STUDENT_NOT_IN_GROUP"
  | "GROUP_NOT_FOUND"
>;

/**
 * D-085's formula, evaluated. Returns the FIRST unmet clause in the order the
 * design states them (qualifying assessment, then independence, then
 * qualification), or `null` when every clause holds. A pure decision over
 * already-resolved facts — no I/O, no clock.
 */
export function firstUnmetClause(
  checks: ConfirmationChecks,
): ConfirmationFailure | null {
  if (!checks.hasQualifyingAssessment) return "NO_QUALIFYING_ASSESSMENT";
  if (checks.independentOfStudentGroup !== true) return "NOT_INDEPENDENT";
  if (!checks.assessorHoldsValidQualification) return "ASSESSOR_NOT_QUALIFIED";
  return null;
}

/** Is a `PersonQualification` valid AT a given instant — D-085's own words. */
export function isQualificationValidAt(
  qualification: { readonly validFrom: Date; readonly validTo: Date | null },
  at: Date,
): boolean {
  return (
    qualification.validFrom <= at &&
    (qualification.validTo === null || at < qualification.validTo)
  );
}

/** Does ANY of these qualifications cover the instant — see the model comment
 * on why `type` is not filtered: D-085 asks only "does one exist", never "of
 * which type". */
export function hasAnyValidQualificationAt(
  qualifications: readonly {
    readonly validFrom: Date;
    readonly validTo: Date | null;
  }[],
  at: Date,
): boolean {
  return qualifications.some((q) => isQualificationValidAt(q, at));
}
