/**
 * `sessions` module public API — the owner of `ScheduledSession` (D-057).
 *
 * It owns `ScheduledSession`, `SessionRosterEntry`, `SessionLane`,
 * `RecurrenceLane`, `Pool`, `Lane`, `SessionRecurrence` and
 * `ScheduleException`. No other module reads
 * those tables directly. An earlier draft of the design had `planning` writing
 * the session table and `attendance` reading it — *"one table, two owners"* —
 * which D-057 calls the first boundary that would have eroded; both are
 * consumers, and this is the owner.
 *
 * It depends on `groups` (the DAG points downward: `sessions → groups →
 * students → people`) and asks it who is in a group through
 * `activeGroupMemberIds`. It never reads `GroupMembership` itself.
 *
 * WHAT IS DELIBERATELY NOT EXPORTED:
 *   - The repositories. A caller reaching `listSessions` directly would supply a
 *     `Reach` of its own, and the point of the service layer is that the guard
 *     and the query are never separable.
 *   - Any way to DELETE a `ScheduledSession`. Cancelling is a status and a
 *     reason; the row stays, because "the lesson was called off" and "there was
 *     no lesson" are different answers to a parent's question.
 *   - Any way to delete a `SessionRecurrence`. Deactivating it is the operation
 *     — the sessions it produced point at it, and that pointer is half the
 *     idempotency key.
 *   - Attendance, in any form. That is a different module against these rows
 *     (D-057), and it is out of scope for this pass.
 */

export {
  cancelSession,
  generateSessions,
  getSessionForPrincipal,
  listSessionsForPrincipal,
  ScheduleError,
  type ActorContext,
  type GenerateSessionsInput,
  type GenerationReport,
} from "./application/schedule-service";

export {
  createClosure,
  createRecurrence,
  deactivateRecurrence,
  listClosuresForGroup,
  listRecurrencesForGroup,
  updateClosure,
  updateRecurrence,
  type ClosureView,
  type CreateClosureInput,
  type CreateRecurrenceInput,
  type RecurrenceUpdateReport,
  type RecurrenceView,
  type UpdateClosureInput,
  type UpdateRecurrenceInput,
} from "./application/recurrence-service";

export {
  clearSessionLaneOverride,
  overrideSessionLanes,
  resolveLaneSource,
  setRecurrenceLanes,
  type OverrideSessionLanesInput,
  type SessionLaneSourceView,
  type SetRecurrenceLanesInput,
} from "./application/lane-assignment-service";

export {
  addGuestToSession,
  removeGuestFromSession,
  type AddGuestInput,
} from "./application/roster-service";

export {
  createLane,
  createPool,
  FacilityError,
  listPoolsForPrincipal,
  updateLane,
  updatePool,
  type CreateLaneInput,
  type CreatePoolInput,
  type UpdateLaneInput,
  type UpdatePoolInput,
} from "./application/facility-service";

export {
  expandAll,
  expandRecurrence,
  occurrenceKey,
  type ClosureWindow,
  type ExpansionResult,
  type PlannedOccurrence,
  type RecurrenceRule,
  type SkippedOccurrence,
} from "./domain/recurrence";

export {
  addDays,
  calendarDate,
  isoWeekday,
  resolveTimeZone,
  toIsoDate,
  wallClockToInstant,
} from "./domain/zoned-time";

export {
  ensureSessionsRegistrations,
  resetSessionsRegistrations,
} from "./infrastructure/registrations";

export {
  sessionFilterForReach,
  type SessionReachFilter,
} from "./infrastructure/session-reach-filter";

export {
  ReachCoversNoSessionError,
  type AssignedLane,
  type LaneAssignment,
  type PoolView,
  type RosterMember,
  type ScheduledSessionListItem,
  type SessionDetail,
} from "./infrastructure/session-repository";
