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
} from "./application/membership-service";

export {
  createStudentProfile,
  recordLifecycleEvent,
  LIFECYCLE_EVENT_TYPES,
} from "./application/student-service";

export {
  describeRelationshipAuthority,
  endRelationship,
  recordRelationship,
  revealRelationshipEvidence,
  RELATIONSHIP_TYPES,
  type RecordRelationshipInput,
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
