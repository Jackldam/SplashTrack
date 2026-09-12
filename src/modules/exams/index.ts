/**
 * `exams` module public API.
 *
 * It owns `PersonQualification`, `ExamCandidate`, `ExamResult` and `Award`.
 * No other module reads those tables directly; it calls one of these
 * services (D-057, `CLAUDE.md` §4).
 *
 * It DEPENDS ON `assessment` (`qualifyingAftestFacts`, D-085's structured
 * fact — the "published service, never its tables" half of the promise
 * `01-domain-model.md` line ~130 makes), `groups`
 * (`activeGroupMemberIds`, to validate a candidacy's `groupId` snapshot) and
 * `sessions` (`findSessionRegisterFacts`, the `{ session }` guard's own
 * roster — the D-052/D-068 external-examiner path). Never the reverse: none
 * of `assessment`/`groups`/`sessions` imports `exams`, and `fees` (not yet
 * built) is documented to depend on neither `exams` nor this module on it —
 * the exam-fee charge (D-089) is a domain event, not a call, when `fees`
 * exists.
 *
 * WHAT IS DELIBERATELY NOT EXPORTED:
 *   - The repositories. The guard and the query are never separable (the
 *     `assessment`/`attendance` precedent).
 *   - Any way to UPDATE or DELETE an `ExamResult`. Append-only, enforced by
 *     the database (`examsGrantStatements`).
 *   - Any way to edit `Award.resultId`/`awardTypeId`/`number`/`issuedAt`.
 *     The runtime role's own grant does not permit it — see
 *     `revokeAward`'s doc comment for the one mutation that IS possible.
 *   - `ExamSession`/`ExamAssessor` and the exam-day per-criterion grading
 *     `AssessmentKind.EXAM` would need. Deliberately deferred — see the
 *     schema's own file comment and the phase 2.4 report §1.
 */

export {
  registerExamCandidate,
  confirmExamCandidate,
  withdrawExamCandidate,
  getExamCandidatesForStudent,
  ExamCandidateError,
  type ActorContext,
  type ExamCandidateView,
  type RegisterExamCandidateInput,
  type ConfirmExamCandidateInput,
  type WithdrawExamCandidateInput,
} from "./application/exam-candidate-service";

export {
  recordExamResult,
  getExamResultsForCandidate,
  issueAward,
  revokeAward,
  ExamResultError,
  type ExamResultView,
  type ExamResultOutcomeValue,
  type RecordExamResultInput,
  type IssueAwardInput,
  type RevokeAwardInput,
} from "./application/exam-result-service";

export {
  grantQualification,
  endQualification,
  listQualifications,
  hasValidQualification,
  PersonQualificationError,
  QUALIFICATION_TYPES,
  type PersonQualificationView,
  type PersonQualificationTypeValue,
  type GrantQualificationInput,
  type EndQualificationInput,
} from "./application/person-qualification-service";

export {
  firstUnmetClause,
  hasAnyValidQualificationAt,
  isQualificationValidAt,
  type ConfirmationChecks,
  type ConfirmationFailure,
  type ExamCandidateRefusal,
} from "./domain/exam-candidate";

export {
  effectiveResultsByCandidate,
  type EffectiveExamResult,
  type ExamResultEntry,
  type ExamResultRefusal,
} from "./domain/exam-result";
