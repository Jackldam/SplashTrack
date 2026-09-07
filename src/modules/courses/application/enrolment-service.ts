/**
 * Signing a pupil up for a course, and ending that.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO OPERATIONS, AND THERE IS NO THIRD
 *
 * `enrolStudent` opens an interval and `endEnrolment` closes one. There is no
 * `updateEnrolment`, no `convertTrial`, and no path anywhere in this module
 * that changes a `status` after the fact.
 *
 * That is D-109 taken literally. *"What does not exist: a trial-booking flow, a
 * conversion funnel, a shortened onboarding path, a make-up entitlement
 * counter, a 'this child is owed two lessons' ledger, or a slot-booking
 * screen."* A `convertTrial` operation would be the first of those, and it
 * would arrive looking like a convenience rather than like a decision — which
 * is the shape D-108's symmetry argument warns about in the neighbouring
 * module.
 *
 * Turning a *proefzwemmer* into a pupil is therefore two ordinary acts: end the
 * `TRIAL` enrolment, start an `ENROLLED` one. That is D-059's rule
 * (*"returning creates a new period and new `Enrolment` rows — it never creates
 * a second profile"*), and it is what keeps the record that the trial happened.
 * Editing the status in place would destroy it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE GUARD NAMES, AND WHY IT IS THE COURSE
 *
 * `{ course: courseId }` with `enrolments.manage`. §2.2 puts a course's
 * enrolments inside `COURSE` coverage, so the course is the resource the act
 * belongs to — and it is the same shape `placeStudentInGroup` uses, which
 * guards `{ group }` for `groups.assign_members` and not the pupil.
 *
 * The consequence is stated rather than hidden: a principal who reaches a
 * course may enrol ANY pupil into it, including one they could not otherwise
 * read. That is inherent in a model where creating the relation is what creates
 * the coverage — the same is already true of placing a child in a group — and
 * narrowing it would need a rule the design set does not state. It is recorded
 * as an open question in `docs/build/phase-2.0-courses-report.md` rather than
 * decided here, because inventing a second reference for one operation would
 * put a coverage rule in a service instead of in §2.2.
 *
 * SERVER-ONLY.
 */
import { requirePermission } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { requiredDate, requiredEnum, requiredText } from "@/lib/validation";
import { recordAuditEvent } from "@/modules/audit";

import {
  assertCanEndEnrolment,
  assertCanEnrol,
  ENROLMENT_STATUSES,
  EnrolmentError,
  type EnrolmentStatusValue,
} from "../domain/enrolment";
import {
  findEnrolmentsFor,
  findStudentEnrolments,
  type EnrolmentEntry,
} from "../infrastructure/course-repository";
import { ensureCoursesRegistrations } from "../infrastructure/registrations";
import { instant, type ActorContext } from "./course-service";
import { TEXT_MAX } from "./input";

export { ENROLMENT_STATUSES, EnrolmentError };
export type { EnrolmentStatusValue };

export interface EnrolStudentInput {
  studentProfileId: unknown;
  status: unknown;
  startedAt: unknown;
}

/**
 * Opens an enrolment.
 *
 * ONE OPEN ENROLMENT PER PUPIL PER COURSE, refused in the domain before the
 * write and by `Enrolment_single_open_enrolment_key` at the database. A pupil
 * taking two different courses at once has two open rows and that is ordinary;
 * two open rows for ONE course would make "is this child enrolled" a question
 * with two answers, which is the failure a status flag has and the reason
 * D-059 exists.
 */
export async function enrolStudent(
  actor: ActorContext,
  courseId: string,
  input: EnrolStudentInput,
): Promise<{ id: string }> {
  ensureCoursesRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "enrolments.manage",
    { course: courseId },
    { at },
  );

  const studentProfileId = requiredText(
    "studentProfileId",
    input.studentProfileId,
    TEXT_MAX.id,
  );
  const status = requiredEnum<EnrolmentStatusValue>(
    "status",
    input.status,
    ENROLMENT_STATUSES,
  );
  const startedAt = requiredDate("startedAt", input.startedAt);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.enrolment.findMany({
      where: { courseId, studentProfileId },
      select: { id: true, startedAt: true, endedAt: true },
    });
    assertCanEnrol(existing);

    const enrolment = await tx.enrolment.create({
      data: { courseId, studentProfileId, status, startedAt },
      select: { id: true },
    });

    await recordAuditEvent(
      {
        eventType: "courses.enrolment.started",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "course",
        targetId: courseId,
        requestId: actor.requestId ?? null,
        // IDS AND ONE CLOSED-VOCABULARY TOKEN. `status` is recorded because
        // TRIAL versus ENROLLED is the fact an auditor would come here to
        // check, and it names a kind of participation rather than anything
        // about the child.
        changedFields: {
          studentProfileId,
          enrolmentId: enrolment.id,
          status,
        },
      },
      tx,
    );

    return enrolment;
  });
}

export interface EndEnrolmentInput {
  studentProfileId: unknown;
  endedAt: unknown;
}

/**
 * Closes the open enrolment.
 *
 * THE ROW STAYS. A closed enrolment is the answer to "was this child doing
 * Diploma B last March", and it is what D-066's retention clock reads through
 * `enrolmentRelationshipSource`. There is no delete path in this module.
 */
export async function endEnrolment(
  actor: ActorContext,
  courseId: string,
  input: EndEnrolmentInput,
): Promise<void> {
  ensureCoursesRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "enrolments.manage",
    { course: courseId },
    { at },
  );

  const studentProfileId = requiredText(
    "studentProfileId",
    input.studentProfileId,
    TEXT_MAX.id,
  );
  const endedAt = requiredDate("endedAt", input.endedAt);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.enrolment.findMany({
      where: { courseId, studentProfileId },
      select: { id: true, startedAt: true, endedAt: true },
    });
    const open = assertCanEndEnrolment(existing, endedAt);

    await tx.enrolment.update({ where: { id: open.id }, data: { endedAt } });

    await recordAuditEvent(
      {
        eventType: "courses.enrolment.ended",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "course",
        targetId: courseId,
        requestId: actor.requestId ?? null,
        changedFields: { studentProfileId, enrolmentId: open.id },
      },
      tx,
    );
  });
}

/**
 * A pupil's enrolments — guarded on the PUPIL, then NARROWED to the courses
 * this caller reaches.
 *
 * TWO STEPS, AND BOTH ARE NECESSARY, for exactly the reason
 * `getStudentGroupHistory` records. `{ student }` is the right reference for
 * the guard: the answer spans courses, so no single course reference could
 * authorise it. But passing that guard is not the same as being entitled to all
 * of it — a `GROUP` grant covers `{ student }` for a pupil in that group, and
 * D-145 rule 2 names *"other enrolments"* among the things such a grant does
 * NOT return. So the reach goes to the repository as a required argument and
 * the narrowing happens in the query.
 *
 * The permission is `courses.read` and not an `enrolments.read` that does not
 * exist (§2.5).
 */
export async function getStudentEnrolments(
  actor: ActorContext,
  studentProfileId: string,
): Promise<EnrolmentEntry[]> {
  ensureCoursesRegistrations();
  const at = instant(actor);

  const reach = await requirePermission(
    actor.principal,
    "courses.read",
    { student: studentProfileId },
    { at },
  );

  return findStudentEnrolments(studentProfileId, reach);
}

/**
 * Whether a pupil currently has an open enrolment in a course.
 *
 * UNGUARDED, and reached only through this module's own services and its
 * registered scope relation — it returns a boolean about two ids the caller
 * already holds. Exported for the module's own tests and for the enrolment form,
 * which uses it to decide whether to offer "enrol" or "end".
 */
export async function hasOpenEnrolment(
  courseId: string,
  studentProfileId: string,
): Promise<boolean> {
  const rows = await findEnrolmentsFor(courseId, studentProfileId);
  return rows.some((row) => row.endedAt === null);
}
