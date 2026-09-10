/**
 * D-080's pass rule, computed for real — `15-assessment-and-fees.md` §2.2:
 *
 * ```text
 * pass(assessment) :=
 *   ∀ c ∈ criteria(assessment.criterionSetId) :
 *       ∃ r ∈ results(assessment, c) with rank(r.grade) ≥ rank(c.minimumGrade ?? criterionSet.passFloor)
 *       ∨ ∃ w ∈ waivers(assessment, c)
 * ```
 *
 * Phase 2.1's skills report §1.1 left this unbuilt because the rows it reads
 * — `AssessmentCriterionResult`, `CriterionWaiver` — did not exist yet. They
 * do now. No `AwardType.kind` is branched on anywhere in this file or its
 * caller, per D-080's own words: *"`if (kind === CERTIFICATE)` therefore
 * never gets written."*
 *
 * Pure functions over rows. No I/O, and no clock of their own — the service
 * resolves the criterion set, its criteria, the submitted results/waivers and
 * every rank involved, and hands them here.
 */

export interface PassRuleCriterion {
  readonly criterionId: string;
  /** NULL = use the set's `passFloorGradeId`; set = a per-criterion override. */
  readonly minimumGradeId: string | null;
}

export interface PassRuleResult {
  readonly criterionId: string;
  readonly gradeValueId: string;
}

export interface PassRuleWaiver {
  readonly criterionId: string;
}

/**
 * Which criteria in this set have NEITHER a result NOR a waiver — D-086's own
 * words: *"an outcome computed over unset criteria"* is not allowed, listed
 * beside a default grade and an unconfirmed "mark all voldoende" as the three
 * things this screen must never do. Empty means the sitting is complete and
 * `computeOutcome` may run; non-empty is what the screen renders as
 * "still to grade".
 */
export function unsettledCriterionIds(input: {
  readonly criteria: readonly PassRuleCriterion[];
  readonly results: readonly PassRuleResult[];
  readonly waivers: readonly PassRuleWaiver[];
}): string[] {
  const settled = new Set([
    ...input.results.map((r) => r.criterionId),
    ...input.waivers.map((w) => w.criterionId),
  ]);
  return input.criteria
    .map((c) => c.criterionId)
    .filter((id) => !settled.has(id));
}

/**
 * Criteria carrying BOTH a result AND a waiver in the same submission — not a
 * corruption of the formula (`∃ r ... ∨ ∃ w` is satisfied either way), only a
 * confusing sitting nobody meant to produce. The service refuses these rather
 * than silently accepting one.
 */
export function doublyDisposedCriterionIds(input: {
  readonly results: readonly PassRuleResult[];
  readonly waivers: readonly PassRuleWaiver[];
}): string[] {
  const waived = new Set(input.waivers.map((w) => w.criterionId));
  return [
    ...new Set(
      input.results.map((r) => r.criterionId).filter((id) => waived.has(id)),
    ),
  ];
}

/**
 * D-080 itself. Assumes completeness already holds ({@link unsettledCriterionIds}
 * is empty) — a criterion reaching this function with neither a result nor a
 * waiver is a precondition violation, not a legitimate FAIL, and is treated as
 * FAIL defensively rather than thrown, because a pure function should not
 * throw over a state its caller was supposed to have already refused (deny by
 * default, not crash by default).
 */
export function computeOutcome(input: {
  readonly criteria: readonly PassRuleCriterion[];
  readonly results: readonly PassRuleResult[];
  readonly waivers: readonly PassRuleWaiver[];
  /** `CriterionSet.passFloorGradeId` — required: an assessable (`ACTIVE`) set
   * always has one (`publishCriterionSet` refuses to publish without it). */
  readonly passFloorGradeId: string;
  /** `GradeValue.id -> rank`. An id absent here fails the criterion — a
   * dangling or foreign grade id must never accidentally pass someone. */
  readonly rankOf: ReadonlyMap<string, number>;
}): "PASS" | "FAIL" {
  const waived = new Set(input.waivers.map((w) => w.criterionId));
  const resultByCriterion = new Map(
    input.results.map((r) => [r.criterionId, r.gradeValueId]),
  );

  for (const criterion of input.criteria) {
    if (waived.has(criterion.criterionId)) continue;

    const gradeValueId = resultByCriterion.get(criterion.criterionId);
    if (gradeValueId === undefined) return "FAIL";

    const requiredGradeId = criterion.minimumGradeId ?? input.passFloorGradeId;
    const requiredRank = input.rankOf.get(requiredGradeId);
    const achievedRank = input.rankOf.get(gradeValueId);
    if (requiredRank === undefined || achievedRank === undefined) {
      return "FAIL";
    }
    if (achievedRank < requiredRank) return "FAIL";
  }

  return "PASS";
}
