/**
 * Reads and writes over `ExamCandidate` — the candidacy state machine
 * (`01-domain-model.md` §3.5).
 *
 * READ-SIDE NARROWING, VIA `examCandidateFilterForReach` — the
 * `findAssessmentsForStudent` shape (phase 2.3).
 *
 * SERVER-ONLY.
 */
import { type Reach } from "@/lib/authorization";
import { prisma, type Prisma } from "@/lib/database";

import type { ExamCandidateStatus as PrismaExamCandidateStatus } from "@/generated/prisma/client";
import { examCandidateFilterForReach } from "./exam-reach-filter";

export type ExamCandidateStatusValue = PrismaExamCandidateStatus;

export interface ExamCandidateView {
  readonly id: string;
  readonly studentProfileId: string;
  readonly awardTypeId: string;
  readonly awardTypeName: string;
  readonly groupId: string;
  readonly status: ExamCandidateStatusValue;
  readonly confirmedAt: Date | null;
  readonly confirmedByPersonId: string | null;
  readonly qualifyingAssessmentId: string | null;
  readonly overrideUsed: boolean;
  readonly overrideReason: string | null;
  readonly withdrawnAt: Date | null;
  readonly withdrawnReason: string | null;
  readonly createdAt: Date;
}

const SELECT = {
  id: true,
  studentProfileId: true,
  awardTypeId: true,
  awardType: { select: { name: true } },
  groupId: true,
  status: true,
  confirmedAt: true,
  confirmedByPersonId: true,
  qualifyingAssessmentId: true,
  overrideUsed: true,
  overrideReason: true,
  withdrawnAt: true,
  withdrawnReason: true,
  createdAt: true,
} as const;

type CandidateRow = Prisma.ExamCandidateGetPayload<{ select: typeof SELECT }>;

function toView(row: CandidateRow): ExamCandidateView {
  return {
    id: row.id,
    studentProfileId: row.studentProfileId,
    awardTypeId: row.awardTypeId,
    awardTypeName: row.awardType.name,
    groupId: row.groupId,
    status: row.status,
    confirmedAt: row.confirmedAt,
    confirmedByPersonId: row.confirmedByPersonId,
    qualifyingAssessmentId: row.qualifyingAssessmentId,
    overrideUsed: row.overrideUsed,
    overrideReason: row.overrideReason,
    withdrawnAt: row.withdrawnAt,
    withdrawnReason: row.withdrawnReason,
    createdAt: row.createdAt,
  };
}

/** A pupil's candidacies, most recent first, narrowed to what `reach` covers. */
export async function findExamCandidatesForStudent(
  studentProfileId: string,
  reach: Reach,
): Promise<ExamCandidateView[]> {
  const filter = examCandidateFilterForReach(reach);
  if (filter.kind === "DENIED") return [];

  const rows = await prisma.examCandidate.findMany({
    where:
      filter.kind === "WHERE"
        ? { studentProfileId, ...filter.where }
        : { studentProfileId },
    orderBy: [{ createdAt: "desc" }],
    select: SELECT,
  });
  return rows.map(toView);
}

/** One candidate by id, unfiltered — the write path's own re-reads. */
export async function findExamCandidateById(
  id: string,
): Promise<ExamCandidateView | null> {
  const row = await prisma.examCandidate.findUnique({
    where: { id },
    select: SELECT,
  });
  return row ? toView(row) : null;
}
