/**
 * `courses` module public API.
 *
 * It owns `Course`, `CourseLevel` and `Enrolment`. No other module reads those
 * tables directly; it calls one of these services (D-057, `CLAUDE.md` §4).
 *
 * It also supplies the last four `ScopeRelations` — `isEnrolledInCourse`,
 * `groupsOfCourse`, `sessionsOfCourse` and `courseEndDate`. Until this module
 * existed all four were on the throwing default, so every branch of
 * `coversResource`'s `COURSES` case denied and logged a warning. Registering
 * them is what makes a `COURSE` grant mean anything at all.
 *
 * WHAT IS DELIBERATELY NOT EXPORTED:
 *   - The repository. A caller reaching `listCourses` directly would have to
 *     supply a `Reach` of its own, and the point of the service layer is that
 *     the guard and the query are never separable.
 *   - Any way to DELETE a `Course`, a `CourseLevel` or an `Enrolment`. A course
 *     is retired with `active = false`; a level is pointed at by every group
 *     taught at it; an enrolment is a pupil's history and is CLOSED, never
 *     removed. The `Restrict` foreign keys refuse the first two at the database
 *     as well.
 *   - Anything that changes an `Enrolment.status` after the fact. Converting a
 *     trial is closing one interval and opening another (D-059), which is what
 *     keeps the record that the trial happened. See `enrolment-service.ts`.
 */

export {
  createCourse,
  getCourseForPrincipal,
  listCoursesForPrincipal,
  listCourseLevelsForPrincipal,
  updateCourse,
  type ActorContext,
  type CreateCourseInput,
  type UpdateCourseInput,
} from "./application/course-service";

export {
  createCourseLevel,
  updateCourseLevel,
  CourseLevelError,
  type CreateCourseLevelInput,
  type UpdateCourseLevelInput,
} from "./application/level-service";

export {
  endEnrolment,
  enrolStudent,
  getStudentEnrolments,
  hasOpenEnrolment,
  ENROLMENT_STATUSES,
  EnrolmentError,
  type EndEnrolmentInput,
  type EnrolStudentInput,
  type EnrolmentStatusValue,
} from "./application/enrolment-service";

export {
  assertCanEndEnrolment,
  assertCanEnrol,
  isEnrolledAt,
  lastEnrolmentEnd,
  openEnrolment,
  type EnrolmentInterval,
} from "./domain/enrolment";

export {
  assertSequenceIsFree,
  inSequence,
  nextSequence,
  type SequencedLevel,
} from "./domain/course-level";

export {
  ensureCoursesRegistrations,
  resetCoursesRegistrations,
} from "./infrastructure/registrations";

export {
  courseFilterForReach,
  type CourseReachFilter,
} from "./infrastructure/course-reach-filter";

export {
  ReachCoversNoCourseError,
  type CourseDetail,
  type CourseLevelOption,
  type CourseLevelView,
  type CourseListItem,
  type EnrolmentEntry,
} from "./infrastructure/course-repository";

export { enrolmentRelationshipSource } from "./infrastructure/enrolment-relationship-source";
