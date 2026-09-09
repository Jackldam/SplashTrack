/**
 * `assessment` module public API.
 *
 * It owns `Assessment`, `AssessmentCriterionResult` and `CriterionWaiver`. No
 * other module reads those tables directly; it calls one of these services
 * (D-057, `CLAUDE.md` §4).
 *
 * It DEPENDS ON `skills` (the pinned `CriterionSet`/`Criterion`/`GradeValue`
 * catalogue — D-084's "one criterion catalogue, not two"), on `sessions`
 * (`findSessionRegisterFacts`, the roster/status a `{ session }` guard
 * writes against), on `groups` (`isActiveInstructorOfStudent`, D-085's
 * checkable independence clause, and `courseLevelOfGroup`), and on `courses`
 * (`awardTypeOfCourseLevel`) — the same `group -> course -> skills`
 * resolution chain `skills`' own `listCriteriaForGroup` already uses,
 * reused rather than re-derived. Never the reverse, and none of the four
 * imports `assessment`.
 *
 * WHAT IS DELIBERATELY NOT EXPORTED:
 *   - The repositories. The guard and the query are never separable (the
 *     `skills`/`attendance` precedent).
 *   - Any way to UPDATE or DELETE an `Assessment`, an
 *     `AssessmentCriterionResult` or a `CriterionWaiver`. All three are
 *     append-only, enforced by the database itself from this phase's first
 *     migration (`assessmentGrantStatements`) rather than retrofitted later.
 *   - A separate "amend" verb. A correction is `recordAssessment` again, with
 *     `supersedesAssessmentId` set — see that function's own doc comment for
 *     why this differs from attendance/skills.
 *   - Anything that checks `AwardType.kind`. D-080's pass rule is one
 *     function over `CriterionSet`/`Criterion`/`GradeValue` rows; no award
 *     type is branched on anywhere in this module.
 *   - The full D-085 gate (refusing `ExamCandidate → CONFIRMED`). That is
 *     `exams`' write, against a table this phase does not build — see
 *     {@link qualifyingAftestFacts}'s own doc comment and the phase 2.3
 *     report.
 */

export {
  criteriaForSessionAftest,
  getAssessmentsForStudent,
  getEffectiveAssessmentsForStudent,
  qualifyingAftestFacts,
  recordAssessment,
  AssessmentError,
  type ActorContext,
  type CriteriaForAftest,
  type CriteriaForAftestReason,
  type QualifyingAftestFacts,
  type RecordAssessmentInput,
  type RecordAssessmentResultInput,
  type RecordAssessmentWaiverInput,
  type RevealedAssessment,
} from "./application/assessment-service";

export {
  ASSESSMENT_OUTCOMES,
  effectiveAssessmentsByCriterionSet,
  type AssessmentEntry,
  type AssessmentOutcomeValue,
  type AssessmentRefusal,
  type EffectiveAssessment,
} from "./domain/assessment";

export {
  computeOutcome,
  doublyDisposedCriterionIds,
  unsettledCriterionIds,
  type PassRuleCriterion,
  type PassRuleResult,
  type PassRuleWaiver,
} from "./domain/pass-rule";
