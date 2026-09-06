/**
 * Binds every Prisma model to the `DataClass` it belongs to (D-065, D-110).
 *
 * `CLAUDE.md` rule 5 requires retention to arrive with the table, not later.
 * The binding lives in TWO places that must never drift: a `/// @dataClass
 * <CLASS>` doc comment directly above `model <Name> {` in
 * `prisma/schema.prisma`, and an entry here. `tests/unit/data-class-registry-sync.test.ts`
 * checks both directions — the exact shape D-167 already uses for
 * `/// @encrypted <columnId>` and `ENCRYPTED_COLUMNS` (D-135's pattern, reused
 * a second time).
 *
 * Every model in this schema is bound, not only the ones that reference
 * `Person`. A join table with no personal data still has a retention story —
 * "configuration, kept indefinitely" is `ORGANIZATION_SETTINGS`, not an
 * unstated default — and stating it here is what makes "every personal-data
 * table carries its retention policy from the day it is created" checkable
 * rather than aspirational.
 *
 * `RETENTION_CATALOGUE` (`./catalogue.ts`) then binds each `DataClass` to its
 * actual policy. This file only answers "which class does this table belong
 * to"; `tests/unit/retention-catalogue.test.ts` checks that every `DataClass`
 * the enum defines has exactly one catalogue entry.
 */
import type { DataClass } from "@/generated/prisma/client";

export const DATA_CLASS_BY_MODEL: Readonly<Record<string, DataClass>> = {
  Organization: "ORGANIZATION_SETTINGS",
  Person: "PERSON_IDENTITY",
  UserAccount: "LOGIN_CREDENTIALS",
  Session: "LOGIN_CREDENTIALS",
  Account: "LOGIN_CREDENTIALS",
  Verification: "LOGIN_CREDENTIALS",
  RateLimitCounter: "RATE_LIMIT_COUNTERS",
  TwoFactor: "LOGIN_CREDENTIALS",
  Passkey: "LOGIN_CREDENTIALS",
  Membership: "MEMBERSHIP_PERIODS",
  MembershipPeriod: "MEMBERSHIP_PERIODS",
  // The pupil's own record and its append-only lifecycle history share one
  // class: both are held for the same purpose (administering lessons) and both
  // expire on the same trigger (`LAST_ENROLMENT_END`). Giving the history a
  // class of its own would be a second retention decision about one fact.
  StudentProfile: "STUDENT_PROFILE",
  StudentLifecycleEvent: "STUDENT_PROFILE",
  // Its own class, added by phase 1.1 — see the enum member's comment in
  // `prisma/schema.prisma` for why it is not folded into `PERSON_IDENTITY`.
  PersonRelationship: "PERSON_RELATIONSHIPS",
  // --- phase 1.6, the `groups` module -------------------------------------
  // The group itself is TEACHING CONFIGURATION and holds no personal data: a
  // name, a capacity, a unit. `ORGANIZATION_SETTINGS` is the honest class for
  // it, and it is what §5's own "Organisation settings & branding" row covers.
  Group: "ORGANIZATION_SETTINGS",
  // A pupil's placement history shares the pupil's class, on the
  // StudentProfile/StudentLifecycleEvent precedent above: same purpose
  // (`STUDENT_PROFILE`'s is literally "administering a pupil's lessons, GROUPS
  // and progress"), same trigger (`LAST_ENROLMENT_END`), same expiry. Giving
  // either its own class would be a second retention decision about one fact.
  GroupMembership: "STUDENT_PROFILE",
  GroupMove: "STUDENT_PROFILE",
  // Its own class — see the enum member in `prisma/schema.prisma` for why it is
  // not `ROLE_ASSIGNMENTS`, which is the distinction D-145 rests on.
  InstructorAssignment: "INSTRUCTOR_ASSIGNMENTS",
  // --- phase 1.6, the `sessions` module ------------------------------------
  // Facilities. A pool is a place; places hold no personal data (D-175).
  Pool: "ORGANIZATION_SETTINGS",
  Lane: "ORGANIZATION_SETTINGS",
  SessionLane: "ORGANIZATION_SETTINGS",
  // The RULE that generates a timetable, and the dates it skips: configuration
  // an administrator edits, with no personal data in either.
  SessionRecurrence: "ORGANIZATION_SETTINGS",
  ScheduleException: "ORGANIZATION_SETTINGS",
  ScheduledSession: "SCHEDULED_SESSIONS",
  // WHO WAS EXPECTED AT A LESSON is personal data about a pupil, held for the
  // same purpose and expiring on the same trigger as the attendance recorded
  // against it — so it shares that class deliberately. The roster must not
  // outlive the attendance it explains: keeping "these twelve children were
  // expected on 3 March" after the attendance is deleted would leave the more
  // re-identifying half of D-111's pair behind, which is the opposite of what
  // that decision is for.
  SessionRosterEntry: "ATTENDANCE_EVENTS",
  Role: "ORGANIZATION_SETTINGS",
  OrganizationUnit: "ORGANIZATION_SETTINGS",
  AccessGroup: "ORGANIZATION_SETTINGS",
  AccessGroupPermission: "ORGANIZATION_SETTINGS",
  RoleAccessGroup: "ORGANIZATION_SETTINGS",
  Permission: "ORGANIZATION_SETTINGS",
  RolePermission: "ORGANIZATION_SETTINGS",
  RoleAssignment: "ROLE_ASSIGNMENTS",
  ApiCredential: "API_CREDENTIALS",
  CredentialRoleAssignment: "ROLE_ASSIGNMENTS",
  AuditEvent: "AUDIT_EVENTS",
  AuditCheckpoint: "AUDIT_EVENTS",
  RetentionPolicy: "ORGANIZATION_SETTINGS",
  InstallationBootstrap: "ORGANIZATION_SETTINGS",
  BreakGlassAlert: "ORGANIZATION_SETTINGS",
};
