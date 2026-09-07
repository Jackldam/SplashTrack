/**
 * Reads and writes over `SkillProgress` — the append-only, per-lesson teaching
 * log (`01-domain-model.md` §3.3).
 *
 * NO RECHECK-BY-REACH ON THE READ SIDE. Every function here is reached only
 * after the service has guarded `skills.read` on `{ student: studentProfileId }`
 * — the same single-resource guard `getStudentEnrolments` uses. Unlike that
 * function's `EnrolmentEntry`, this module does NOT narrow the rows returned
 * to what the caller's `Reach` covers beyond that one gate: `SkillProgress`
 * carries no `courseId` or `groupId` of its own to narrow by (§3.3 gives it
 * `studentProfileId, criterionId, state, assessedByPersonId, assessedAt,
 * sessionId?, note?`, no more), and its only relational hook — `sessionId` —
 * is OPTIONAL. See `docs/build/phase-2.1-skills-report.md` for why this is
 * recorded as an open question rather than solved by inventing a column or a
 * narrowing rule the design set does not state.
 *
 * SERVER-ONLY.
 */
import { prisma } from "@/lib/database";

import type { SkillProgressStateValue } from "../domain/skill-progress";

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

/** A pupil's full progress log, most recent first. */
export async function findSkillProgressForStudent(
  studentProfileId: string,
): Promise<SkillProgressEntry[]> {
  const rows = await prisma.skillProgress.findMany({
    where: { studentProfileId },
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
