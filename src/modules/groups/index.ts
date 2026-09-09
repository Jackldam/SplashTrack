/**
 * `groups` module public API.
 *
 * It owns `Group`, `GroupMembership`, `GroupMove` and `InstructorAssignment`.
 * No other module reads those tables directly; it calls one of these services
 * (D-057, `CLAUDE.md` §4). `sessions` is the first consumer — it asks
 * {@link activeGroupMemberIds} who is in a group when it builds a roster.
 *
 * WHAT IS DELIBERATELY NOT EXPORTED:
 *   - The repository. A caller reaching `listGroups` directly would have to
 *     supply a `Reach` of its own, and the point of the service layer is that
 *     the guard and the query are never separable.
 *   - Any way to DELETE a `GroupMembership`, a `GroupMove` or an
 *     `InstructorAssignment`. All three are history: a placement is CLOSED, a
 *     move is a record of a decision, and an assignment that ended is the answer
 *     to "who taught this group in 2026". There is no update path for a move at
 *     all.
 *   - A second move operation. `moveStudent` handles every direction, and
 *     D-108's rule that moving down is ordinary history is enforced by there
 *     being nowhere else to go.
 */

export {
  createGroup,
  getGroupForPrincipal,
  listGroupsForPrincipal,
  updateGroup,
  type ActorContext,
  type CreateGroupInput,
  type UpdateGroupInput,
} from "./application/group-service";

export {
  endGroupMembership,
  getStudentGroupHistory,
  moveStudent,
  placeStudentInGroup,
  GroupFullError,
  GroupMoveError,
  GROUP_MOVE_DIRECTIONS,
  type GroupMoveDirectionValue,
  type MoveStudentInput,
  type PlaceStudentInput,
} from "./application/membership-service";

export {
  assignInstructor,
  endInstructorAssignment,
  IntervalError,
  type AssignInstructorInput,
  type EndInstructorAssignmentInput,
} from "./application/instructor-service";

export {
  assertMoveIsCoherent,
  type GroupMoveIntent,
} from "./domain/group-move";

export {
  assertHasRoom,
  hasRoom,
  placesRemaining,
  type CapacityState,
} from "./domain/capacity";

export { isActiveAt, openIntervals, type Interval } from "./domain/interval";

export {
  ensureGroupsRegistrations,
  resetGroupsRegistrations,
} from "./infrastructure/registrations";

export {
  groupFilterForReach,
  type GroupReachFilter,
} from "./infrastructure/group-reach-filter";

export {
  ReachCoversNoGroupError,
  type GroupDetail,
  type GroupListItem,
  type GroupMemberView,
  type GroupMoveEntry,
  type GroupHistoryEntry,
} from "./infrastructure/group-repository";

export { instructorAssignmentSource } from "./infrastructure/instructor-relationship-source";

/**
 * Who is in this group at this instant — the published answer `sessions` builds
 * a roster from.
 *
 * UNGUARDED, and that is correct: it returns `StudentProfile` ids and nothing
 * about anybody. The caller is `sessions`, which has already guarded the
 * operation the roster is part of. Making it a permission check here would mean
 * the scheduling job — which acts as an administrator generating a term —
 * resolving reach per group per session, for ids it then only counts.
 */
export { activeMemberIds as activeGroupMemberIds } from "./infrastructure/group-repository";
