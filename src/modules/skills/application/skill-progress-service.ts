/**
 * `SkillProgress` — the informal, per-lesson teaching log
 * (`01-domain-model.md` §3.3). What an instructor writes; it decides nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WRITES GUARD `{ group: groupId }` — THE DESIGN'S OWN EXAMPLE, ALMOST VERBATIM
 *
 * `02-security-privacy.md` §2.2 opens with `requirePermission(session,
 * 'attendance.record', { group: groupId })` as THE illustration of a guarded
 * write. `recordSkillProgress` is the same shape for the same reason: a
 * per-lesson observation is recorded from the group's own roster, by whoever
 * currently teaches it (or a broader grant that covers the group). The pupil
 * is validated as an ACTIVE member of that group (`activeGroupMemberIds`,
 * published by `groups`) before anything is written — a domain check, not an
 * authorization one, so the message is a sentence rather than a foreign-key
 * failure.
 *
 * `skills.assess` for INTRODUCED/PRACTISING/ACHIEVED, `skills.revoke` for
 * REVOKED — `permissionFor()` in the domain module, the
 * `attendance.record`/`attendance.amend` split applied to §2.5's actual pair.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READS GUARD `{ student: studentProfileId }`, THEN NARROW BY `Reach` —
 * THE `findStudentEnrolments` SHAPE, AS OF THE PHASE 2.1 FOLLOW-UP
 *
 * `getSkillProgressForStudent` guards the same single resource
 * `getStudentEnrolments` does, then passes the `Reach` that satisfied the
 * guard down to the repository, which narrows per row — the
 * `findStudentEnrolments` shape. Only the `GROUP` case narrows: a
 * `GROUP`-scoped reach's rows are limited to the group(s) it holds, via the
 * `groupId` snapshot this phase added to `SkillProgress`. Every other reach
 * (`ORGANIZATION`, `UNIT`, `COURSE`, `SESSION`, `SELF`) still sees the full
 * history, unchanged — narrowing those was never asked for, and doing so
 * would risk the exact defect the phase 2.1 report's §1.5 already declined:
 * a `COURSE`-scoped aftest assessor going blind. See
 * `skill-progress-reach-filter.ts` and the report §1.5 for the reasoning.
 *
 * SERVER-ONLY.
 */
import { requirePermission } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import {
  optionalText,
  requiredDate,
  requiredEnum,
  requiredText,
} from "@/lib/validation";
import { recordAuditEvent } from "@/modules/audit";
import { awardTypeOfCourseLevel } from "@/modules/courses";
import { activeGroupMemberIds, courseLevelOfGroup } from "@/modules/groups";

import {
  permissionFor,
  SKILL_PROGRESS_STATES,
  SkillProgressError,
  type SkillProgressStateValue,
} from "../domain/skill-progress";
import {
  criterionSetOfCriterion,
  listActiveCriteria,
  type CriterionView,
} from "../infrastructure/catalogue-repository";
import {
  findSkillProgressForStudent,
  type SkillProgressEntry,
} from "../infrastructure/skill-progress-repository";
import { TEXT_MAX } from "./input";
import { instant, type ActorContext } from "./award-type-service";

export { SKILL_PROGRESS_STATES, SkillProgressError };
export type { SkillProgressStateValue };

export interface RecordSkillProgressInput {
  studentProfileId: unknown;
  criterionId: unknown;
  state: unknown;
  note?: unknown;
  sessionId?: unknown;
  assessedAt?: unknown;
}

/** Appends one observation. Never updates a row that already exists. */
export async function recordSkillProgress(
  actor: ActorContext,
  groupId: string,
  input: RecordSkillProgressInput,
): Promise<{ id: string }> {
  const at = instant(actor);

  const studentProfileId = requiredText(
    "studentProfileId",
    input.studentProfileId,
    TEXT_MAX.id,
  );
  const criterionId = requiredText(
    "criterionId",
    input.criterionId,
    TEXT_MAX.id,
  );
  const state = requiredEnum<SkillProgressStateValue>(
    "state",
    input.state,
    SKILL_PROGRESS_STATES,
  );
  const note = optionalText("note", input.note, TEXT_MAX.note);
  const sessionId = optionalText("sessionId", input.sessionId, TEXT_MAX.id);
  const assessedAt =
    input.assessedAt === undefined ||
    input.assessedAt === null ||
    input.assessedAt === ""
      ? at
      : requiredDate("assessedAt", input.assessedAt);

  await requirePermission(
    actor.principal,
    permissionFor(state),
    { group: groupId },
    { at },
  );

  const members = await activeGroupMemberIds(groupId, at);
  if (!members.includes(studentProfileId)) {
    throw new SkillProgressError("NOT_A_GROUP_MEMBER");
  }

  const criterionSet = await criterionSetOfCriterion(criterionId);
  if (criterionSet === null || criterionSet.status !== "ACTIVE") {
    throw new SkillProgressError("CRITERION_NOT_ACTIVE");
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.skillProgress.create({
      data: {
        studentProfileId,
        criterionId,
        state,
        assessedByPersonId: actor.principal.personId,
        assessedAt,
        sessionId,
        // The read-side narrowing snapshot (phase 2.1 follow-up): the group
        // this observation was recorded in is exactly the `groupId` the
        // guard above already checked, so it is stamped here rather than
        // re-derived.
        groupId,
        note,
      },
      select: { id: true },
    });

    await recordAuditEvent(
      {
        eventType: "skills.progress.recorded",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "student_profile",
        targetId: studentProfileId,
        requestId: actor.requestId ?? null,
        // IDS AND ONE CLOSED-VOCABULARY TOKEN — `state` is the fact an
        // instructor or an auditor comes here to check; the `note`, if any,
        // never appears in an audit event (D-148-adjacent restraint — see the
        // schema comment on `SkillProgress.note` for the open question this
        // rests on).
        changedFields: {
          criterionId,
          progressId: created.id,
          state,
          noteGiven: note !== null,
        },
      },
      tx,
    );

    return created;
  });
}

/**
 * A pupil's progress log, most recent observation first, narrowed to what the
 * caller's `Reach` covers. See the file comment for which reaches narrow.
 */
export async function getSkillProgressForStudent(
  actor: ActorContext,
  studentProfileId: string,
): Promise<SkillProgressEntry[]> {
  const at = instant(actor);
  const reach = await requirePermission(
    actor.principal,
    "skills.read",
    { student: studentProfileId },
    { at },
  );
  return findSkillProgressForStudent(studentProfileId, reach);
}

/** Why a group has no criteria to pick from — rendered as a sentence, not a blank list. */
export type CriteriaForGroupReason =
  "NO_LEVEL" | "NO_AWARD_TYPE" | "NO_ACTIVE_SET";

export interface CriteriaForGroup {
  readonly criteria: readonly CriterionView[];
  /** `null` when `criteria` is the real answer; a reason otherwise. */
  readonly reason: CriteriaForGroupReason | null;
}

/**
 * The criteria a group's own level trains towards, in order — what the
 * per-lesson recording form on the group screen offers.
 *
 * `CourseLevel.awardTypeId` (this phase's wiring) IS THE LINK. Resolved
 * through TWO published cross-module calls rather than a query of either
 * table: `groups` owns `Group.courseLevelId`
 * ({@link courseLevelOfGroup}) and `courses` owns `CourseLevel.awardTypeId`
 * ({@link awardTypeOfCourseLevel}) — `skills` owns neither (`CLAUDE.md` §4).
 * `groups -> courses -> skills` is the dependency direction this creates;
 * nothing in `groups` or `courses` imports `skills`, so it is not a cycle —
 * see `docs/build/phase-2.1-skills-report.md` for where this sits against the
 * design set's stated build-order DAG.
 *
 * THREE WAYS TO COME BACK EMPTY, AND THEY ARE DIFFERENT FACTS: no level
 * recorded for the group; a level recorded with no award type; an award type
 * with no `ACTIVE` criterion set yet (still `DRAFT`, or never authored). The
 * screen renders each as its own sentence, on the `group.courseLevelId`
 * three-state precedent in `src/app/groups/[groupId]/page.tsx`.
 */
export async function listCriteriaForGroup(
  actor: ActorContext,
  groupId: string,
): Promise<CriteriaForGroup> {
  const at = instant(actor);
  await requirePermission(
    actor.principal,
    "skills.read",
    { group: groupId },
    { at },
  );

  const courseLevelId = await courseLevelOfGroup(groupId);
  if (courseLevelId === null) return { criteria: [], reason: "NO_LEVEL" };

  const awardTypeId = await awardTypeOfCourseLevel(courseLevelId);
  if (awardTypeId === null) return { criteria: [], reason: "NO_AWARD_TYPE" };

  const criteria = await listActiveCriteria(awardTypeId);
  if (criteria.length === 0) return { criteria: [], reason: "NO_ACTIVE_SET" };

  return { criteria, reason: null };
}
