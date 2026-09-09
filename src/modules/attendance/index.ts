/**
 * `attendance` module public API.
 *
 * It owns `AttendanceEvent` — and nothing else. `ScheduledSession` belongs to
 * `sessions` (D-057): this module writes rows AGAINST lessons it reaches
 * through `sessions`' published `findSessionRegisterFacts`, and never reads
 * `ScheduledSession`, `SessionRosterEntry` or `GroupMembership` itself
 * beyond the joins its own rows carry. The DAG points downward
 * (`attendance → sessions → groups → …`, `01-domain-model.md` §1.2), and the
 * one upward signal the design names — *"attendance was registered, update
 * progress"* (D-003, a domain event consumed by `skills`) — is NOT published
 * here, because no domain-event mechanism exists in this codebase yet; the
 * phase 2.2 report records that as an open item rather than inventing a bus.
 *
 * WHAT IS DELIBERATELY NOT EXPORTED:
 *   - The repositories. The guard and the query are never separable (the
 *     `courses`/`groups`/`skills` precedent).
 *   - Anything that UPDATES or DELETES an `AttendanceEvent`. D-061: a
 *     correction is a NEW event carrying `supersedesEventId` — and unlike any
 *     domain table before this one, the database itself refuses the rest
 *     (`attendanceGrantStatements`: the runtime role holds `SELECT, INSERT`
 *     only).
 *   - A derived `AttendanceStatus` table or view. §3.4: *"materialised only
 *     if measurement demands it"* — the derivation is
 *     `effectiveAttendanceByStudent`, computed per read.
 */

export {
  amendAttendance,
  getAttendanceForStudent,
  getSessionRegister,
  registerSessionAttendance,
  ATTENDANCE_STATES,
  AttendanceError,
  type ActorContext,
  type AmendAttendanceInput,
  type AttendanceStateValue,
  type RegisterAttendanceEntry,
  type RegisterLine,
  type RegisterSessionAttendanceInput,
  type RegistrationReport,
  type SessionRegister,
} from "./application/attendance-service";

export {
  effectiveAttendanceByStudent,
  type AttendanceEntry,
  type EffectiveAttendance,
} from "./domain/attendance-event";

export {
  attendanceFilterForReach,
  type AttendanceReachFilter,
} from "./infrastructure/attendance-reach-filter";

export type {
  SessionAttendanceEvent,
  StudentAttendanceEntry,
} from "./infrastructure/attendance-repository";
