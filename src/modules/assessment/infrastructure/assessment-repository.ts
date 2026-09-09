/**
 * Reads over `Assessment`, `AssessmentCriterionResult` and `CriterionWaiver`
 * — the formal aftest record (`15-assessment-and-fees.md` §2-5).
 *
 * READ-SIDE NARROWING, VIA `assessmentFilterForReach`. Every read here is
 * reached only after the service has guarded `assessment.read` on
 * `{ student: studentProfileId }`, then narrowed to what the caller's
 * `Reach` covers per row — the `findSkillProgressForStudent` shape.
 *
 * REMARKS ARE RETURNED SEALED, NEVER DECRYPTED. `remarkSealed` is the raw
 * D-096 envelope string or `null`; decrypting it needs the row's own id as
 * the AAD primary key AND a separate `students.notes.read` check the service
 * performs once for the whole call, together with the audited-read event
 * (D-148). Doing that here would smear the permission check and the audit
 * write across a repository that has neither `requirePermission` nor
 * `recordAuditEvent` in scope, on the same "guard and query are never
 * separable" discipline the module boundary elsewhere enforces.
 *
 * SERVER-ONLY.
 */
import { type Reach } from "@/lib/authorization";
import { prisma, type Prisma } from "@/lib/database";

import type { AssessmentOutcomeValue } from "../domain/assessment";
import { assessmentFilterForReach } from "./assessment-reach-filter";

export interface AssessmentCriterionResultView {
  readonly id: string;
  readonly criterionId: string;
  readonly criterionName: string;
  readonly gradeValueId: string;
  readonly gradeLabel: string;
  readonly gradeRank: number;
  readonly remarkSealed: string | null;
}

export interface CriterionWaiverView {
  readonly id: string;
  readonly criterionId: string;
  readonly criterionName: string;
  readonly reason: string;
}

export interface AssessmentView {
  readonly id: string;
  readonly criterionSetId: string;
  readonly criterionSetVersion: number;
  readonly awardTypeId: string;
  readonly awardTypeName: string;
  readonly assessorPersonId: string | null;
  readonly assessedAt: Date;
  readonly scheduledSessionId: string | null;
  readonly outcome: AssessmentOutcomeValue;
  readonly supersedesAssessmentId: string | null;
  readonly groupId: string;
  readonly remarkSealed: string | null;
  readonly results: readonly AssessmentCriterionResultView[];
  readonly waivers: readonly CriterionWaiverView[];
}

const ASSESSMENT_SELECT = {
  id: true,
  criterionSetId: true,
  assessorPersonId: true,
  assessedAt: true,
  scheduledSessionId: true,
  outcome: true,
  supersedesAssessmentId: true,
  groupId: true,
  remark: true,
  criterionSet: {
    select: { version: true, awardType: { select: { id: true, name: true } } },
  },
  criterionResults: {
    select: {
      id: true,
      criterionId: true,
      gradeValueId: true,
      remark: true,
      criterion: { select: { name: true } },
      gradeValue: { select: { label: true, rank: true } },
    },
  },
  waivers: {
    select: {
      id: true,
      criterionId: true,
      reason: true,
      criterion: { select: { name: true } },
    },
  },
} as const;

type AssessmentRow = Prisma.AssessmentGetPayload<{
  select: typeof ASSESSMENT_SELECT;
}>;

function toView(row: AssessmentRow): AssessmentView {
  return {
    id: row.id,
    criterionSetId: row.criterionSetId,
    criterionSetVersion: row.criterionSet.version,
    awardTypeId: row.criterionSet.awardType.id,
    awardTypeName: row.criterionSet.awardType.name,
    assessorPersonId: row.assessorPersonId,
    assessedAt: row.assessedAt,
    scheduledSessionId: row.scheduledSessionId,
    outcome: row.outcome,
    supersedesAssessmentId: row.supersedesAssessmentId,
    groupId: row.groupId,
    remarkSealed: row.remark,
    results: row.criterionResults.map((result) => ({
      id: result.id,
      criterionId: result.criterionId,
      criterionName: result.criterion.name,
      gradeValueId: result.gradeValueId,
      gradeLabel: result.gradeValue.label,
      gradeRank: result.gradeValue.rank,
      remarkSealed: result.remark,
    })),
    waivers: row.waivers.map((waiver) => ({
      id: waiver.id,
      criterionId: waiver.criterionId,
      criterionName: waiver.criterion.name,
      reason: waiver.reason,
    })),
  };
}

/**
 * A pupil's assessment history, most recent sitting first, narrowed to what
 * `reach` covers.
 */
export async function findAssessmentsForStudent(
  studentProfileId: string,
  reach: Reach,
): Promise<AssessmentView[]> {
  const filter = assessmentFilterForReach(reach);
  if (filter.kind === "DENIED") return [];

  const rows = await prisma.assessment.findMany({
    where:
      filter.kind === "WHERE"
        ? { studentProfileId, ...filter.where }
        : { studentProfileId },
    orderBy: [{ assessedAt: "desc" }, { createdAt: "desc" }],
    select: ASSESSMENT_SELECT,
  });

  return rows.map(toView);
}

export interface AssessmentFactRow {
  readonly id: string;
  readonly outcome: AssessmentOutcomeValue;
  readonly assessedAt: Date;
  readonly assessorPersonId: string | null;
  readonly supersedesAssessmentId: string | null;
}

/**
 * Every `PRE_EXAM` assessment for one student against one PINNED criterion
 * set, unfiltered by reach — the published fact `assessment` builds
 * `qualifyingAftestFacts` from (below), for the future `exams` module's D-085
 * check. UNGUARDED: the caller (this module's own service) has already
 * decided this read needs no `Reach`, on the `findSessionRegisterFacts`
 * precedent — ids and outcomes, nothing a reach would narrow further that
 * this specific, already-scoped lookup does not already narrow by
 * `(studentProfileId, criterionSetId)`.
 */
export async function findAssessmentsForStudentAndCriterionSet(
  studentProfileId: string,
  criterionSetId: string,
): Promise<AssessmentFactRow[]> {
  return prisma.assessment.findMany({
    where: { studentProfileId, criterionSetId },
    orderBy: [{ assessedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      outcome: true,
      assessedAt: true,
      assessorPersonId: true,
      supersedesAssessmentId: true,
    },
  });
}

/** One assessment by id, unfiltered — the write path's own re-reads. */
export async function findAssessmentById(
  assessmentId: string,
): Promise<AssessmentView | null> {
  const row = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: ASSESSMENT_SELECT,
  });
  return row ? toView(row) : null;
}
