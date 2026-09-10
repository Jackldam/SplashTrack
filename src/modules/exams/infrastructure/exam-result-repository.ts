/**
 * Reads over `ExamResult` and `Award` — the exam-day outcome and the issued
 * document (`01-domain-model.md` §3.5).
 *
 * No reach narrowing of its own: every read here is reached only after the
 * service has resolved and guarded the OWNING `ExamCandidate`
 * (`exam-candidate-repository.ts`'s own narrowing already applies), the
 * `AssessmentCriterionResult`/`CriterionWaiver` precedent — a child row
 * inherits its parent's guard rather than being narrowed a second time.
 *
 * SERVER-ONLY.
 */
import { prisma, type Prisma } from "@/lib/database";

import type { ExamResultOutcome as PrismaExamResultOutcome } from "@/generated/prisma/client";

export type ExamResultOutcomeValue = PrismaExamResultOutcome;

export interface AwardView {
  readonly id: string;
  readonly resultId: string;
  readonly awardTypeId: string;
  readonly number: string;
  readonly issuedAt: Date;
  readonly revokedAt: Date | null;
  readonly revokeReason: string | null;
}

export interface ExamResultView {
  readonly id: string;
  readonly candidateId: string;
  readonly outcome: ExamResultOutcomeValue;
  readonly recordedByPersonId: string | null;
  readonly recordedAt: Date;
  readonly supersedesResultId: string | null;
  readonly reason: string | null;
  readonly remarks: string | null;
  readonly assessmentId: string | null;
  readonly scheduledSessionId: string | null;
  readonly award: AwardView | null;
}

const AWARD_SELECT = {
  id: true,
  resultId: true,
  awardTypeId: true,
  number: true,
  issuedAt: true,
  revokedAt: true,
  revokeReason: true,
} as const;

const RESULT_SELECT = {
  id: true,
  candidateId: true,
  outcome: true,
  recordedByPersonId: true,
  recordedAt: true,
  supersedesResultId: true,
  reason: true,
  remarks: true,
  assessmentId: true,
  scheduledSessionId: true,
  award: { select: AWARD_SELECT },
} as const;

type ResultRow = Prisma.ExamResultGetPayload<{ select: typeof RESULT_SELECT }>;

function toView(row: ResultRow): ExamResultView {
  return {
    id: row.id,
    candidateId: row.candidateId,
    outcome: row.outcome,
    recordedByPersonId: row.recordedByPersonId,
    recordedAt: row.recordedAt,
    supersedesResultId: row.supersedesResultId,
    reason: row.reason,
    remarks: row.remarks,
    assessmentId: row.assessmentId,
    scheduledSessionId: row.scheduledSessionId,
    award: row.award,
  };
}

/** Every result recorded for one candidate, most recent first. */
export async function findExamResultsForCandidate(
  candidateId: string,
): Promise<ExamResultView[]> {
  const rows = await prisma.examResult.findMany({
    where: { candidateId },
    orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }],
    select: RESULT_SELECT,
  });
  return rows.map(toView);
}

export async function findExamResultById(
  id: string,
): Promise<ExamResultView | null> {
  const row = await prisma.examResult.findUnique({
    where: { id },
    select: RESULT_SELECT,
  });
  return row ? toView(row) : null;
}
