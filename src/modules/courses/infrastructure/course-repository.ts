/**
 * Reads over `Course`, `CourseLevel` and `Enrolment`. Every list takes a
 * `Reach` as a REQUIRED argument (D-031) — there is no overload without one.
 *
 * SERVER-ONLY. Nothing here guards; the services above do, and they are the
 * only callers. What this file guarantees is that a caller cannot ask a
 * question without having resolved the authority to ask it.
 */
import type { Reach } from "@/lib/authorization";
import { prisma } from "@/lib/database";

import { inSequence } from "../domain/course-level";
import type { EnrolmentStatusValue } from "../domain/enrolment";
import { courseFilterForReach } from "./course-reach-filter";

/**
 * Thrown when a reach covers no `Course` at all — so the caller can report a
 * DENIAL rather than an empty list.
 *
 * `06-delivery.md` §2.1 makes the list case the one that must never be dropped.
 * The distinction is sharper here than anywhere so far, because the ONLY reach
 * variant that covers a course is `COURSES` (or `ORGANIZATION`): a Location
 * Manager, an instructor and an aftest assessor all resolve to no coverage of
 * this table by design (D-170's cross-unit case, §6.1's no-upward rule, §2.2's
 * "not the course"). Every one of them must be told they are not the person who
 * may read it, rather than shown a club with no courses in it.
 */
export class ReachCoversNoCourseError extends Error {
  constructor() {
    super("This principal's reach covers no course.");
    this.name = "ReachCoversNoCourseError";
  }
}

export interface CourseLevelView {
  readonly id: string;
  readonly name: string;
  readonly sequence: number;
  /**
   * How many groups are taught at this level. A COUNT and not a list of names:
   * `Group` belongs to the `groups` module, and this screen needs to know
   * whether a level is in use before somebody renames or reorders it — not who
   * is in those groups, which is a question with its own reach.
   */
  readonly groupCount: number;
}

export interface CourseListItem {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly active: boolean;
  readonly levelCount: number;
  /**
   * Open enrolments right now. A COUNT, never names: §2.2 gives a `COURSE`
   * grant the course's enrolments, and D-145 rule 2 makes coverage per
   * RELATION — the pupils behind these rows are reached through
   * `{ student }`, on the person screen, not by appearing in a course list.
   */
  readonly openEnrolments: number;
}

export interface CourseDetail extends CourseListItem {
  readonly levels: readonly CourseLevelView[];
}

/** The half-open "currently enrolled" rule, as a Prisma filter. */
function openAt(at: Date) {
  return {
    startedAt: { lte: at },
    OR: [{ endedAt: null }, { endedAt: { gt: at } }],
  };
}

/** Courses this reach permits, with their level and enrolment counts. */
export async function listCourses(
  reach: Reach,
  at: Date,
  options: { includeInactive?: boolean } = {},
): Promise<CourseListItem[]> {
  const filter = courseFilterForReach(reach);
  if (filter.kind === "DENIED") throw new ReachCoversNoCourseError();

  const rows = await prisma.course.findMany({
    where: {
      ...(filter.kind === "WHERE" ? filter.where : {}),
      ...(options.includeInactive ? {} : { active: true }),
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      active: true,
      _count: {
        select: { levels: true, enrolments: { where: openAt(at) } },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    active: row.active,
    levelCount: row._count.levels,
    openEnrolments: row._count.enrolments,
  }));
}

/**
 * One course with its levels, in order.
 *
 * `null` only when the row genuinely does not exist. A course the caller may
 * not read produces a DENIAL at the service's `requirePermission`, before this
 * is called — the two answers are different and conflating them here would hide
 * the denial from the person who needs to understand it.
 */
export async function findCourseDetail(
  courseId: string,
  at: Date,
): Promise<CourseDetail | null> {
  const row = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      name: true,
      description: true,
      active: true,
      _count: {
        select: { levels: true, enrolments: { where: openAt(at) } },
      },
      levels: {
        select: {
          id: true,
          name: true,
          sequence: true,
          _count: { select: { groups: true } },
        },
      },
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    active: row.active,
    levelCount: row._count.levels,
    openEnrolments: row._count.enrolments,
    levels: inSequence(
      row.levels.map((level) => ({
        id: level.id,
        name: level.name,
        sequence: level.sequence,
        groupCount: level._count.groups,
      })),
    ),
  };
}

/** The levels of a course, in order. Used by the level services' own checks. */
export async function findLevelsOfCourse(courseId: string): Promise<
  { id: string; name: string; sequence: number }[]
> {
  return inSequence(
    await prisma.courseLevel.findMany({
      where: { courseId },
      select: { id: true, name: true, sequence: true },
    }),
  );
}

/** Which course a level belongs to, so a guard can name a resource. */
export async function courseOfLevel(levelId: string): Promise<string | null> {
  const row = await prisma.courseLevel.findUnique({
    where: { id: levelId },
    select: { courseId: true },
  });
  return row?.courseId ?? null;
}

/**
 * Every level of every course this reach covers, flattened for a `<select>`.
 *
 * REACH-FILTERED like everything else. The one caller is the group edit form,
 * which offers a level to attach a group to: a principal who reaches no course
 * is offered nothing, and the screen says so rather than presenting an empty
 * dropdown that reads as "the club has no levels".
 */
export interface CourseLevelOption {
  readonly levelId: string;
  readonly levelName: string;
  readonly sequence: number;
  readonly courseId: string;
  readonly courseName: string;
}

export async function listCourseLevelOptions(
  reach: Reach,
): Promise<CourseLevelOption[]> {
  const filter = courseFilterForReach(reach);
  if (filter.kind === "DENIED") throw new ReachCoversNoCourseError();

  const rows = await prisma.courseLevel.findMany({
    where:
      filter.kind === "WHERE" ? { course: filter.where } : undefined,
    orderBy: [{ course: { name: "asc" } }, { sequence: "asc" }],
    select: {
      id: true,
      name: true,
      sequence: true,
      course: { select: { id: true, name: true } },
    },
  });

  return rows.map((row) => ({
    levelId: row.id,
    levelName: row.name,
    sequence: row.sequence,
    courseId: row.course.id,
    courseName: row.course.name,
  }));
}

export interface EnrolmentEntry {
  readonly id: string;
  /**
   * The enrolment's own foreign key, always present. What is withheld is the
   * course's NAME (below), never this id — a caller who cannot see the name
   * still needs the id to act on the row it owns (ending the enrolment), and
   * `endEnrolment` re-checks `enrolments.manage` on this course itself, so
   * exposing the id widens nothing.
   */
  readonly courseId: string;
  /**
   * Null when the caller does not reach the course this enrolment is in, which
   * {@link EnrolmentEntry.courseWithheld} is what distinguishes. Two very
   * different facts; a screen that rendered both as a blank would be telling
   * one of them wrongly — the same shape `GroupMoveEntry` uses.
   */
  readonly courseName: string | null;
  readonly courseWithheld: boolean;
  readonly status: EnrolmentStatusValue;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
}

/**
 * A pupil's enrolments, NARROWED TO WHAT THIS REACH COVERS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE REACH ARGUMENT IS NOT OPTIONAL
 *
 * The service guards `{ student }`, which establishes that the caller reaches
 * the PUPIL — and that is not sufficient, which is exactly D-145 rule 2:
 * *coverage is per **relation**, not per entity*, and §2.2 names "other
 * enrolments" among the things a `GROUP`-scoped instructor does NOT get. A
 * `GROUP` grant covers `{ student }` for a pupil in that group, so a version of
 * this function that took only a `studentProfileId` would hand a Tuesday
 * instructor every course the child has ever been signed up for.
 *
 * `findStudentGroupHistory` had precisely that defect and
 * `groups-scope-escape.test.ts` caught it. The narrowing is in the query here
 * from the first line, against the same filter the course list uses — one home
 * for "which courses does this reach cover".
 *
 * A WITHHELD COURSE IS SAID TO BE WITHHELD. The enrolment is still the pupil's
 * history and still belongs in the list; what is withheld is the course's NAME,
 * and the entry says so rather than rendering a blank.
 */
export async function findStudentEnrolments(
  studentProfileId: string,
  reach: Reach,
): Promise<EnrolmentEntry[]> {
  const filter = courseFilterForReach(reach);
  if (filter.kind === "DENIED") throw new ReachCoversNoCourseError();

  // NULL means "no narrowing", kept distinct from an empty object on purpose:
  // `{ course: {} }` is NOT a no-op in Prisma as a relation filter, and using
  // it for the `ALL` case would silently return an empty history to an
  // ORGANIZATION-scoped administrator. `findStudentGroupHistory` records the
  // same trap.
  const scope = filter.kind === "WHERE" ? filter.where : null;

  const rows = await prisma.enrolment.findMany({
    where: { studentProfileId },
    orderBy: [{ startedAt: "asc" }],
    select: {
      id: true,
      status: true,
      startedAt: true,
      endedAt: true,
      courseId: true,
      course: { select: { name: true } },
    },
  });

  const reachable =
    scope === null
      ? null
      : new Set(
          rows.length === 0
            ? []
            : (
                await prisma.course.findMany({
                  where: {
                    AND: [
                      { id: { in: rows.map((row) => row.courseId) } },
                      scope,
                    ],
                  },
                  select: { id: true },
                })
              ).map((row) => row.id),
        );

  return rows.map((row) => {
    const covered = reachable === null || reachable.has(row.courseId);
    return {
      id: row.id,
      courseId: row.courseId,
      courseName: covered ? row.course.name : null,
      courseWithheld: !covered,
      status: row.status,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
    };
  });
}

/**
 * The intervals of one pupil's enrolments in one course, for the domain rules
 * that decide whether a new one may start or an open one may end.
 *
 * UNGUARDED BY DESIGN and reached only through the module's own services, which
 * guard. It returns two dates and an id and names nobody.
 */
export async function findEnrolmentsFor(
  courseId: string,
  studentProfileId: string,
): Promise<{ id: string; startedAt: Date; endedAt: Date | null }[]> {
  return prisma.enrolment.findMany({
    where: { courseId, studentProfileId },
    orderBy: [{ startedAt: "asc" }],
    select: { id: true, startedAt: true, endedAt: true },
  });
}
