/**
 * Reads and writes over `SkillProgress` — the append-only, per-lesson teaching
 * log (`01-domain-model.md` §3.3).
 *
 * READ-SIDE NARROWING, VIA `skillProgressFilterForReach`. Every read here is
 * reached only after the service has guarded `skills.read` on
 * `{ student: studentProfileId }` — the same single-resource guard
 * `getStudentEnrolments` uses — and, as of the phase 2.1 follow-up, is then
 * narrowed to what the caller's `Reach` covers per row, on the
 * `findStudentEnrolments` shape. Only the `GROUP` case narrows; see
 * `skill-progress-reach-filter.ts` for why every other variant still returns
 * the full history, deliberately.
 *
 * SERVER-ONLY.
 */
import { type Reach } from "@/lib/authorization";
import { prisma } from "@/lib/database";

import type { SkillProgressStateValue } from "../domain/skill-progress";
import { skillProgressFilterForReach } from "./skill-progress-reach-filter";

export interface SkillProgressEntry {
  readonly id: string;
  readonly criterionId: string;
  readonly criterionName: string;
  readonly criterionSetVersion: number;
  readonly awardTypeName: string;
  readonly state: SkillProgressStateValue;
  readonly assessedAt: Date;
  readonly note: string | null;
  readonly sessionId: string | null;
}

/**
 * A pupil's progress log, most recent first, narrowed to what `reach` covers.
 */
export async function findSkillProgressForStudent(
  studentProfileId: string,
  reach: Reach,
): Promise<SkillProgressEntry[]> {
  const filter = skillProgressFilterForReach(reach);
  if (filter.kind === "DENIED") return [];

  const rows = await prisma.skillProgress.findMany({
    where:
      filter.kind === "WHERE"
        ? { studentProfileId, ...filter.where }
        : { studentProfileId },
    orderBy: [{ assessedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      criterionId: true,
      state: true,
      assessedAt: true,
      note: true,
      sessionId: true,
      criterion: {
        select: {
          name: true,
          criterionSet: {
            select: { version: true, awardType: { select: { name: true } } },
          },
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    criterionId: row.criterionId,
    criterionName: row.criterion.name,
    criterionSetVersion: row.criterion.criterionSet.version,
    awardTypeName: row.criterion.criterionSet.awardType.name,
    state: row.state,
    assessedAt: row.assessedAt,
    note: row.note,
    sessionId: row.sessionId,
  }));
}
