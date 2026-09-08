/**
 * Creating and correcting a course's levels.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A LEVEL IS PART OF ITS COURSE, AND IS GUARDED AS ONE
 *
 * Both operations reference `{ course: courseId }` rather than inventing a
 * level-shaped resource. §2.2 gives a `COURSE` grant *"that course, **its
 * levels**, its enrolments"* — the level is inside the course's coverage, and
 * `ResourceRef` has no `level` member because the design set does not name one.
 * The permission is `courses.manage` for the same reason: §2.5's catalogue has
 * no `levels.*` key, and *"a permission referenced anywhere in the design set
 * and absent here is a defect, not a shorthand"*.
 *
 * `updateCourseLevel` therefore reads the level's `courseId` BEFORE it guards,
 * which is not a hole: it reads one join key to learn which resource to ask
 * about, and the guard then decides. A level id that names no row resolves to
 * null and the operation ends without touching anything.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THERE IS NO `deleteCourseLevel`
 *
 * A level is pointed at by every group taught at it and — once `AwardType`
 * exists — by what that level prepares for. `Restrict` on both edges refuses
 * the delete at the database, and removing a level a group still sits at would
 * silently orphan the answer to "what was this group taught". Correcting a
 * level is renaming or repositioning it; retiring a whole course is
 * `Course.active = false`, which keeps everything underneath.
 *
 * SERVER-ONLY.
 */
import { requirePermission } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { optionalText, requiredInt, requiredText } from "@/lib/validation";
import { recordAuditEvent } from "@/modules/audit";

import {
  assertSequenceIsFree,
  CourseLevelError,
  nextSequence,
} from "../domain/course-level";
import { courseOfLevel } from "../infrastructure/course-repository";
import { ensureCoursesRegistrations } from "../infrastructure/registrations";
import { instant, type ActorContext } from "./course-service";
import { SEQUENCE_MAX, TEXT_MAX } from "./input";

export { CourseLevelError };

export interface CreateCourseLevelInput {
  name: unknown;
  /**
   * Where the level sits in the course's order. OPTIONAL, and the ordinary case
   * leaves it empty: {@link nextSequence} allocates the next free position, so
   * adding "Diploma C" after A and B needs no decision from the person adding
   * it. Supplying one is for inserting a level between two that exist.
   */
  sequence?: unknown;
}

/** Adds a level to a course. */
export async function createCourseLevel(
  actor: ActorContext,
  courseId: string,
  input: CreateCourseLevelInput,
): Promise<{ id: string }> {
  ensureCoursesRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "courses.manage",
    { course: courseId },
    { at },
  );

  const name = requiredText("name", input.name, TEXT_MAX.levelName);
  const supplied =
    input.sequence === undefined ||
    input.sequence === null ||
    input.sequence === ""
      ? null
      : requiredInt("sequence", input.sequence, 1, SEQUENCE_MAX);

  return prisma.$transaction(async (tx) => {
    const siblings = await tx.courseLevel.findMany({
      where: { courseId },
      select: { id: true, sequence: true },
    });

    const sequence = supplied ?? nextSequence(siblings);
    // The unique index is the control; this is the sentence. Both,
    // deliberately — the check without the index is a race, the index without
    // the check is a Postgres error code where an explanation belongs.
    assertSequenceIsFree(siblings, sequence, null);

    const level = await tx.courseLevel.create({
      data: { courseId, name, sequence },
      select: { id: true },
    });

    await recordAuditEvent(
      {
        eventType: "courses.level.created",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        // The COURSE is the target, because the course is the resource the
        // guard named and the thing an auditor searches by. The level id is in
        // `changedFields`, where the other identifiers in this module's events
        // are.
        targetType: "course",
        targetId: courseId,
        requestId: actor.requestId ?? null,
        changedFields: { levelId: level.id, sequence, fields: "name,sequence" },
      },
      tx,
    );

    return level;
  });
}

export interface UpdateCourseLevelInput {
  name: unknown;
  sequence: unknown;
  /**
   * What this level trains towards — an `AwardType` id, or empty to clear it.
   * OPTIONAL: `undefined` leaves the column alone (a form with no field for it
   * posts nothing), while an empty string writes `null` explicitly — the same
   * three-way reading `updateGroup` gives `courseLevelId`. Not validated
   * against `AwardType` here: `courses` does not own that table
   * (`CLAUDE.md` §4), and a dangling id left by a later `AwardType` correction
   * is not a case this module invents machinery for — `skills` never corrects
   * one in place (D-081/D-164), so the id an administrator picks from a live
   * `<select>` never goes stale under them.
   */
  awardTypeId?: unknown;
}

/** Renames a level, or moves it in the order. */
export async function updateCourseLevel(
  actor: ActorContext,
  levelId: string,
  input: UpdateCourseLevelInput,
): Promise<void> {
  ensureCoursesRegistrations();
  const at = instant(actor);

  const courseId = await courseOfLevel(levelId);
  // A level id naming no row is not a denial and not an error: there is nothing
  // to guard and nothing to change. Reporting it as a permission failure would
  // teach an administrator to distrust the one message that must stay
  // meaningful.
  if (courseId === null) return;

  await requirePermission(
    actor.principal,
    "courses.manage",
    { course: courseId },
    { at },
  );

  const name = requiredText("name", input.name, TEXT_MAX.levelName);
  const sequence = requiredInt("sequence", input.sequence, 1, SEQUENCE_MAX);
  const awardTypeId =
    input.awardTypeId === undefined
      ? undefined
      : optionalText("awardTypeId", input.awardTypeId, TEXT_MAX.id);

  await prisma.$transaction(async (tx) => {
    const siblings = await tx.courseLevel.findMany({
      where: { courseId },
      select: { id: true, sequence: true },
    });
    assertSequenceIsFree(siblings, sequence, levelId);

    const before = await tx.courseLevel.findUnique({
      where: { id: levelId },
      select: { name: true, sequence: true, awardTypeId: true },
    });
    if (!before) return;

    const changed = [
      ...(before.name === name ? [] : ["name"]),
      ...(before.sequence === sequence ? [] : ["sequence"]),
      ...(awardTypeId === undefined || before.awardTypeId === awardTypeId
        ? []
        : ["awardTypeId"]),
    ];
    if (changed.length === 0) return;

    await tx.courseLevel.update({
      where: { id: levelId },
      data: { name, sequence, awardTypeId },
    });

    await recordAuditEvent(
      {
        eventType: "courses.level.updated",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "course",
        targetId: courseId,
        requestId: actor.requestId ?? null,
        changedFields: { levelId, fields: changed.join(",") },
      },
      tx,
    );
  });
}
