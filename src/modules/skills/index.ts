/**
 * `skills` module public API.
 *
 * It owns `AwardType`, `GradeScale`, `GradeValue`, `CriterionSet`,
 * `Criterion` and `SkillProgress`. No other module reads those tables
 * directly; it calls one of these services (D-057, `CLAUDE.md` §4).
 *
 * It DEPENDS ON `courses` (`awardTypeOfCourseLevel`, for
 * `listCriteriaForGroup`) and on `groups` (`courseLevelOfGroup`,
 * `activeGroupMemberIds`) — the reverse of nothing, since neither of those
 * modules imports `skills`. See `docs/build/phase-2.1-skills-report.md` for
 * where this sits against `06-delivery.md` §5's stated DAG
 * (`... groups → courses → skills → sessions ...`), which this build's actual
 * dependency direction does not quite match — `sessions` already existed
 * before this phase, built in the same slice as `groups`.
 *
 * WHAT IS DELIBERATELY NOT EXPORTED:
 *   - The repositories. The point of the service layer is that the guard and
 *     the query are never separable (the `courses`/`groups` precedent).
 *   - Any way to DELETE an `AwardType`, a `CriterionSet` or a `Criterion`. The
 *     catalogue is append/version-only (D-081, D-164) — a correction inside a
 *     still-`DRAFT` set is an edit; a correction to a published one is a new
 *     version.
 *   - Any way to EDIT a published (`ACTIVE`/`RETIRED`) `CriterionSet` or the
 *     criteria inside it (D-081: "an ACTIVE set is never edited").
 *   - Anything that UPDATES an existing `SkillProgress` row. It is
 *     append-only, like every other event log in this schema — a correction
 *     is a new row, `REVOKED` included.
 *   - `AwardType.code`/`AwardType.kind` correction. Still out of scope — see
 *     the phase 2.1 report's open questions. The D-188 JSON import/export
 *     surface itself is now built; see `catalogue-json-service.ts` and
 *     `docs/build/phase-2.1b-catalogue-json-import-report.md`.
 */

export {
  createAwardType,
  getAwardTypeForPrincipal,
  listAwardTypesForPrincipal,
  updateAwardType,
  type ActorContext,
  type CreateAwardTypeInput,
  type UpdateAwardTypeInput,
} from "./application/award-type-service";

export { listGradeScalesForPrincipal } from "./application/grade-scale-service";

/**
 * The seeded grade scale(s), values in rank order, unguarded — the published
 * answer `assessment` (phase 2.3) renders the grade picker from. On the
 * `criterionSetDetailForAssessment` precedent: the catalogue has no scope
 * narrower than `ORGANIZATION`, and an assessor grading a sitting needs the
 * grade vocabulary exactly as much as the criteria themselves.
 */
export { listGradeScales } from "./infrastructure/catalogue-repository";

export {
  createCriterionSet,
  getCriterionSetForPrincipal,
  publishCriterionSet,
  updateCriterionSet,
  CriterionSetError,
  type CreateCriterionSetInput,
  type UpdateCriterionSetInput,
} from "./application/criterion-set-service";

export {
  createCriterion,
  updateCriterion,
  CriterionError,
  type CreateCriterionInput,
  type UpdateCriterionInput,
} from "./application/criterion-service";

export {
  getSkillProgressForStudent,
  listCriteriaForGroup,
  recordSkillProgress,
  SKILL_PROGRESS_STATES,
  SkillProgressError,
  type CriteriaForGroup,
  type CriteriaForGroupReason,
  type RecordSkillProgressInput,
  type SkillProgressStateValue,
} from "./application/skill-progress-service";

export {
  effectiveStateByCriterion,
  permissionFor,
  type ProgressEntry,
} from "./domain/skill-progress";

export {
  assertSequenceIsFree as assertCriterionSequenceIsFree,
  inSequence as criteriaInSequence,
  nextSequence as nextCriterionSequence,
} from "./domain/criterion";

export { assertCanPublish, nextVersion } from "./domain/criterion-set";

export type {
  AwardTypeDetail,
  AwardTypeListItem,
  CriterionSetDetail,
  CriterionSetSummary,
  CriterionView,
  GradeScaleView,
  GradeValueView,
} from "./infrastructure/catalogue-repository";

/**
 * The pinned criterion set an `Assessment.criterionSetId` points at — its
 * status, pass floor and criteria (each with its own override, D-080) — the
 * published answer `assessment` (phase 2.3) reads to compute the pass rule
 * and to refuse recording against a set that is not `ACTIVE`. Reused
 * verbatim from the catalogue's own detail view (D-081: the version is
 * pinned by id, never resolved by date) rather than a second query shape.
 */
export { findCriterionSetDetail as criterionSetDetailForAssessment } from "./infrastructure/catalogue-repository";

/**
 * The rank of every requested `GradeValue`, by id — see the repository
 * function's own doc comment.
 */
export { gradeValuesByIds } from "./infrastructure/catalogue-repository";

/**
 * The current `ACTIVE` criterion set of an `AwardType`, if one exists — the
 * published answer `assessment` (phase 2.3) resolves which set a candidate
 * must have passed, and the future `exams` module will resolve the same way
 * (D-081: never by date).
 */
export { findActiveCriterionSet as activeCriterionSetOfAwardType } from "./infrastructure/catalogue-repository";

export type { SkillProgressEntry } from "./infrastructure/skill-progress-repository";

/**
 * D-188's second surface — the catalogue as one JSON document, validated and
 * written through exactly the services above (`catalogue-json-service.ts`'s
 * own file comment explains how). `parseCatalogueDocument` is exported apart
 * from `importCatalogue` so a caller (an upload route) can report a shape
 * problem before touching the database at all.
 */
export {
  exportCatalogue,
  importCatalogue,
  parseCatalogueDocument,
  CatalogueImportError,
  type CatalogueAwardTypeDocument,
  type CatalogueCriterionDocument,
  type CatalogueCriterionSetDocument,
  type CatalogueDocument,
  type CatalogueGradeRef,
  type ImportCatalogueResult,
} from "./application/catalogue-json-service";
