/**
 * The `courses` module's application service for `Course` itself.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE THINGS EVERY OPERATION IN THIS MODULE DOES, IN THIS ORDER
 *
 * 1. **Register what this module supplies.** `ensureCoursesRegistrations()` —
 *    idempotent, one boolean. It matters here for the reason it matters in
 *    `groups`: without it, all four `COURSE` coverage relations stay on the
 *    throwing default and every `COURSE`-scoped grant in the installation
 *    resolves to no coverage of a group, a session or a pupil. Safe, and wrong.
 *
 * 2. **`requirePermission`, resource-referenced.** Never a bare permission
 *    check (D-030). Lists resolve a `Reach` instead and hand it to the
 *    repository as a required argument (D-031) — the same authority,
 *    translated rather than re-derived.
 *
 * 3. **Audit the write.** Identifiers and field NAMES only, never a value.
 *
 * Every write below is inside a transaction that has NOT yet committed when the
 * event is recorded, so `recordAuditEvent` (the throwing variant) is correct
 * everywhere: a failed append aborts the write rather than losing its record.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PERMISSIONS ARE §2.5'S, AND THERE ARE ONLY THREE OF THEM
 *
 * `courses.read`, `courses.manage`, `enrolments.manage`. §2.5's own rule is
 * that *"a permission referenced anywhere in the design set and absent here is
 * a defect, not a shorthand"*, and the catalogue has no `enrolments.read` and
 * no `levels.*`. So reading an enrolment is `courses.read` — §2.2 puts a
 * course's enrolments inside `COURSE` coverage — and creating a level is
 * `courses.manage`, because a level is part of the course rather than a thing
 * with a permission of its own. Phase 1.6 made the same reading when it used
 * `planning.manage` for scheduling rather than inventing `sessions.manage`.
 *
 * SERVER-ONLY.
 */
import {
  PermissionDeniedError,
  requirePermission,
  resolveReach,
  type Principal,
} from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { optionalText, requiredText } from "@/lib/validation";
import { recordAuditEvent } from "@/modules/audit";

import {
  findCourseDetail,
  listCourses,
  listCourseLevelOptions,
  ReachCoversNoCourseError,
  type CourseDetail,
  type CourseLevelOption,
  type CourseListItem,
} from "../infrastructure/course-repository";
import { ensureCoursesRegistrations } from "../infrastructure/registrations";
import { TEXT_MAX } from "./input";

/** What identifies the acting principal and the request they act in. */
export interface ActorContext {
  readonly principal: Principal;
  /** Request correlation id, when in a request (`@/lib/api/request-id`). */
  readonly requestId?: string | null;
  /** The instant the whole operation is evaluated at. */
  readonly at?: Date;
}

export function instant(actor: ActorContext): Date {
  return actor.at ?? new Date();
}

/**
 * The course list.
 *
 * A `PermissionDeniedError` when the principal's reach covers no course — NOT
 * an empty list. That case is broader here than in any module so far, and
 * deliberately: the only reach that covers a course is `COURSES` or
 * `ORGANIZATION`, so a Location Manager, an instructor and an aftest assessor
 * are all refused (§2.1's "one course across groups", §6.1's no-upward rule,
 * §2.2's "not the course"). Every one of them needs to be told that this is a
 * permissions question somebody can answer, not that the club teaches nothing.
 */
export async function listCoursesForPrincipal(
  actor: ActorContext,
  options: { includeInactive?: boolean } = {},
): Promise<CourseListItem[]> {
  ensureCoursesRegistrations();
  const at = instant(actor);

  // No `requirePermission`: a list names no single resource, so there is
  // nothing for D-030's required reference to point at. The authority is the
  // same — this `Reach` is the only thing the repository accepts.
  const reach = await resolveReach(actor.principal, "courses.read", { at });

  try {
    return await listCourses(reach, at, options);
  } catch (error) {
    if (error instanceof ReachCoversNoCourseError) {
      throw new PermissionDeniedError("courses.read", "course list");
    }
    throw error;
  }
}

/** One course with its levels, in order. Guarded per resource. */
export async function getCourseForPrincipal(
  actor: ActorContext,
  courseId: string,
): Promise<CourseDetail | null> {
  ensureCoursesRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "courses.read",
    { course: courseId },
    { at },
  );

  return findCourseDetail(courseId, at);
}

/**
 * Every level of every course this principal reaches, for a `<select>`.
 *
 * The one caller is the group edit form, which attaches a group to a level.
 * It is a READ of this module's data by another module's screen, so it is
 * guarded here on `courses.read` rather than being trusted to the screen —
 * §1.1 rule 1: hiding a dropdown is not authorization.
 */
export async function listCourseLevelsForPrincipal(
  actor: ActorContext,
): Promise<CourseLevelOption[]> {
  ensureCoursesRegistrations();
  const at = instant(actor);

  const reach = await resolveReach(actor.principal, "courses.read", { at });

  try {
    return await listCourseLevelOptions(reach);
  } catch (error) {
    if (error instanceof ReachCoversNoCourseError) {
      throw new PermissionDeniedError("courses.read", "course level list");
    }
    throw error;
  }
}

export interface CreateCourseInput {
  name: unknown;
  description?: unknown;
}

/**
 * Creates a course.
 *
 * The resource reference is `{ organization: true }`, for the reason
 * `createGroup` and `createPerson` give: a course that does not exist yet has
 * no id to name, so there is nothing narrower to point at. The consequence is
 * stated rather than hidden — creating a course needs an
 * `ORGANIZATION`-scoped `courses.manage`. That is the honest reading of a model
 * in which coverage is resource containment (D-170) and the resource does not
 * exist; the alternative is a create path that names no resource at all, which
 * D-030 forbids for exactly this reason.
 */
export async function createCourse(
  actor: ActorContext,
  input: CreateCourseInput,
): Promise<{ id: string }> {
  ensureCoursesRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "courses.manage",
    { organization: true },
    { at },
  );

  const data = {
    name: requiredText("name", input.name, TEXT_MAX.courseName),
    description: optionalText(
      "description",
      input.description,
      TEXT_MAX.courseDescription,
    ),
  };

  return prisma.$transaction(async (tx) => {
    const course = await tx.course.create({ data, select: { id: true } });

    await recordAuditEvent(
      {
        eventType: "courses.course.created",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "course",
        targetId: course.id,
        requestId: actor.requestId ?? null,
        // FIELD NAMES, never values. A course name is not personal data, but
        // recording values here would still start a habit this trail cannot
        // afford — it is append-only and cannot be corrected.
        changedFields: {
          fields: "name,description",
          describedStated: data.description !== null,
        },
      },
      tx,
    );

    return course;
  });
}

export interface UpdateCourseInput {
  name: unknown;
  description?: unknown;
  active?: unknown;
}

/**
 * An ordinary edit, audited like every other write.
 *
 * `active` is a RETIREMENT flag and there is no delete beside it. A course the
 * club has stopped running keeps its levels, its enrolments and the record of
 * what every pupil was signed up for; deleting it would take a child's history
 * with it, and the `Restrict` foreign keys in the schema refuse it anyway.
 */
export async function updateCourse(
  actor: ActorContext,
  courseId: string,
  input: UpdateCourseInput,
): Promise<void> {
  ensureCoursesRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "courses.manage",
    { course: courseId },
    { at },
  );

  const data = {
    name: requiredText("name", input.name, TEXT_MAX.courseName),
    description: optionalText(
      "description",
      input.description,
      TEXT_MAX.courseDescription,
    ),
    // Not `?? undefined`: an unchecked box posts nothing, and reading that as
    // "leave it alone" would make the flag one-way. `updateGroup` reads it the
    // same way.
    active: input.active === undefined ? undefined : input.active === "on",
  };

  await prisma.$transaction(async (tx) => {
    const before = await tx.course.findUnique({
      where: { id: courseId },
      select: { name: true, description: true, active: true },
    });
    if (!before) return;

    const changed = (["name", "description", "active"] as const).filter(
      (field) => data[field] !== undefined && before[field] !== data[field],
    );
    if (changed.length === 0) return;

    await tx.course.update({ where: { id: courseId }, data });

    await recordAuditEvent(
      {
        eventType: "courses.course.updated",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "course",
        targetId: courseId,
        requestId: actor.requestId ?? null,
        changedFields: { fields: changed.join(",") },
      },
      tx,
    );
  });
}
