/**
 * `people` module public API — the first domain module, and the one every other
 * module depends on.
 *
 * It owns `Person`, `Membership`, `MembershipPeriod`, `StudentProfile`,
 * `StudentLifecycleEvent` and `PersonRelationship`. No other module reads those
 * tables directly; it calls one of these services (D-057, `CLAUDE.md` §4).
 *
 * WHAT IS DELIBERATELY NOT EXPORTED:
 *   - The repository. A caller reaching `listPeople` directly would have to
 *     supply a `Reach` of its own, and the point of the service layer is that
 *     the guard and the query are never separable.
 *   - Anything that decrypts. `revealRelationshipEvidence` is the only path to
 *     the authority evidence, and it audits before it discloses.
 *   - Any way to update or delete a `StudentLifecycleEvent`. The log is
 *     append-only; a correction is a new event (`CLAUDE.md` rule 4).
 */

export {
  createPerson,
  getPersonForPrincipal,
  listPeopleForPrincipal,
  updatePerson,
  type ActorContext,
  type CreatePersonInput,
  type UpdatePersonInput,
} from "./application/people-service";

export {
  createMembership,
  endMembershipPeriod,
  startMembershipPeriod,
  updateMembership,
  type UpdateMembershipInput,
} from "./application/membership-service";

export {
  createStudentProfile,
  listStudentCandidatesForPrincipal,
  recordLifecycleEvent,
  updateStudentProfile,
  LIFECYCLE_EVENT_TYPES,
  type UpdateStudentProfileInput,
} from "./application/student-service";

/**
 * The guest picker's row shape (phase 2.2) — identity basics only, on D-145
 * rule 2's field-level reading; the reach story is
 * `student-candidate-filter.ts`'s.
 */
export type { StudentCandidate } from "./infrastructure/student-candidate-repository";

export {
  describeRelationshipAuthority,
  endRelationship,
  recordRelationship,
  revealRelationshipEvidence,
  RelationshipAuthorityError,
  RELATIONSHIP_TYPES,
  type RecordRelationshipInput,
  type RelationshipAuthorityRefusal,
  type RelationshipType,
} from "./application/relationship-service";

export {
  ageThresholdDate,
  hasReachedAgeOfConsent,
  resolveGuardianAuthority,
  type GuardianAuthority,
  type GuardianAuthorityInput,
  type GuardianAuthorityStatus,
} from "./domain/guardian-authority";

export {
  coversInstant,
  isCurrentlyAMember,
  lastMembershipEnd,
  openPeriod,
  MembershipPeriodError,
  type MembershipInterval,
} from "./domain/membership";

export {
  currentLifecycleState,
  lifecycleEndedAt,
  type LifecycleEvent,
  type StudentLifecycleEventType,
  type StudentLifecycleState,
} from "./domain/student-lifecycle";

export {
  MEMBER_NUMBER_PREFIX,
  STUDENT_NUMBER_PREFIX,
  nextAllocatedNumber,
  normaliseSuppliedNumber,
  DuplicateNumberError,
  InvalidNumberError,
} from "./domain/numbering";

export {
  ensurePeopleRegistrations,
  resetPeopleRegistrations,
} from "./infrastructure/registrations";

export {
  personFilterForReach,
  type PersonReachFilter,
} from "./infrastructure/person-reach-filter";

export {
  ReachCoversNoPersonError,
  type PersonDetail,
  type PersonListItem,
  type PersonRelationshipView,
} from "./infrastructure/person-repository";

export {
  guardianRelationshipSource,
  membershipPeriodSource,
  studentProfileSource,
} from "./infrastructure/relationship-sources";
