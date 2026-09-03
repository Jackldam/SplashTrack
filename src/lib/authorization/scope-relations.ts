/**
 * The scope-relation port — the live domain facts the reach model needs and
 * does not own.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A PORT AND NOT A QUERY
 *
 * D-145 makes coverage **per relation and evaluated live**: a `GROUP`-scoped
 * grant reaches a student only while a `GroupMembership` AND an
 * `InstructorAssignment` are both active *at query time*. Those tables belong to
 * the `groups` and `sessions` modules (`01-domain-model.md` §3.2/§3.4), and
 * modules own their tables — a module never reads another module's tables
 * directly, it calls an application service (D-057, `CLAUDE.md` §4). None of
 * those tables exists yet; this pass builds the mechanism, and the tables that
 * use it arrive with their modules.
 *
 * So the authorization layer declares WHAT it must know and each owning module
 * supplies its own answer through `configureScopeRelations`. That keeps one
 * home for each fact and makes the dependency visible instead of implicit.
 *
 * Every method is traceable to a decision; there are no speculative ones.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE DEFAULT THROWS
 *
 * An unsupplied relation must not read as "false" — a silent false is a denial
 * nobody can distinguish from a correct denial, and this is the code path D-031
 * calls the highest-risk in the application. So the default implementation
 * throws `ScopeRelationUnavailableError`, and the guard converts *any* failure
 * into a DENIAL while logging the cause at error level (§1.1 rule 2: "any
 * unexpected failure including the database being unreachable results in
 * denial"). Deny-by-default AND loud, rather than deny-by-default and quiet.
 *
 * The failure is scoped to the grant that needed it: a principal holding an
 * `ORGANIZATION` grant and a `GROUP` grant, on an instance where the groups
 * module is not wired up, still resolves their organisation reach. Only the
 * `GROUP` half drops, with a log line naming the missing method.
 */

/** Thrown by the default implementation of any relation nobody supplies. */
export class ScopeRelationUnavailableError extends Error {
  constructor(public readonly relation: keyof ScopeRelations) {
    super(
      `Scope relation \`${relation}\` has no implementation. The module that ` +
        "owns the table it reads must register one through " +
        "configureScopeRelations() at the composition root. Until it does, " +
        "every grant depending on this relation resolves to NO coverage.",
    );
    this.name = "ScopeRelationUnavailableError";
  }
}

/**
 * The live facts coverage is computed from. Each method answers as of `at`,
 * never from a cache and never from a value captured at grant time (D-145 rule
 * 1; D-068 for the roster).
 */
export interface ScopeRelations {
  /**
   * Groups this person is CURRENTLY assigned to instruct (D-145 rule 1).
   *
   * The second half of `GROUP` coverage, and the half a union-of-grants model
   * gets wrong by default: `GroupMembership` rows are kept for life (D-059), so
   * resolving group reach from the grant alone means every instructor who has
   * ever taught a child keeps read access to that child permanently. F-114.
   *
   * Owned by the `groups` module (`InstructorAssignment`).
   */
  activeInstructorGroupIds(
    personId: string,
    at: Date,
  ): Promise<readonly string[]>;

  /**
   * Is this student an ACTIVE member of this group right now (D-145 rule 1)?
   * A lapsed membership row grants nothing.
   *
   * Owned by the `groups` module (`GroupMembership`).
   */
  isActiveGroupMember(input: {
    groupId: string;
    studentProfileId: string;
    at: Date;
  }): Promise<boolean>;

  /**
   * The student's HOME unit — which governs their PROFILE, whatever other
   * units they attend in (D-145's cross-unit rule).
   *
   * A child registered at Zuidbad attending a summer course at Noordbad was
   * otherwise fully reachable by the Location Manager of both, because
   * effective reach is a union and the broader answer always wins.
   *
   * Owned by the `students` module (`StudentProfile.unitId`).
   */
  homeUnitOfStudent(studentProfileId: string): Promise<string | null>;

  /**
   * The unit a group sits in. Governs THAT GROUP'S attendance and progress
   * only — never the students' profiles (D-145).
   *
   * Owned by the `groups` module (`Group.unitId`).
   */
  unitOfGroup(groupId: string): Promise<string | null>;

  /**
   * The unit a person's membership sits in.
   *
   * §2.2 gives `UNIT` coverage as "every group, session, student and exam
   * session directly beneath it" and does not mention `Person` — but §2.4's
   * Member Administrator is `UNIT` or `ORGANIZATION` and administers people.
   * The reading implemented here, and recorded as a decision the design did not
   * settle: a bare `{ person }` under `UNIT` reach resolves through the
   * person's MEMBERSHIP unit, and denies when they have none. A child with no
   * membership — the most common person in the database (§5.1) — is addressed
   * as `{ student }`, which `UNIT` does cover through their home unit.
   *
   * Owned by the `people` module (`Membership.unitId`).
   */
  unitOfPerson(personId: string): Promise<string | null>;

  /**
   * The group a scheduled session belongs to. `UNIT` and `GROUP` reach a
   * session through it (§2.2: a unit covers "every group, session ... directly
   * beneath it"; a group covers "its scheduled sessions").
   *
   * Owned by the `sessions` module (`ScheduledSession.groupId`, D-057).
   */
  groupOfSession(sessionId: string): Promise<string | null>;

  /**
   * Is this student on that session's roster right now (D-068)?
   *
   * Resolved from `SessionRosterEntry` / the exam session's candidate list AT
   * THE TIME OF THE CHECK, never cached at grant time, so adding or removing a
   * student changes reach immediately.
   *
   * This is weekly machinery, not an exotic case (D-179): a make-up lesson is
   * an ordinary session with a GUEST on the roster, and without this the
   * receiving instructor cannot see the child standing in front of them —
   * with the 16:55 fix being an administrator minting a grant.
   *
   * Owned by the `sessions` module.
   */
  isOnSessionRoster(input: {
    sessionId: string;
    studentProfileId: string;
    at: Date;
  }): Promise<boolean>;

  /**
   * Is this student enrolled in that course right now? §2.2 gives `COURSE`
   * coverage as "that course, its levels, its **enrolments**, and all its exam
   * sessions" — this is the enrolments half.
   *
   * Owned by the `courses` module (`Enrolment`).
   */
  isEnrolledInCourse(input: {
    courseId: string;
    studentProfileId: string;
    at: Date;
  }): Promise<boolean>;

  /**
   * The groups taught under a course. Needed by `COURSE` coverage of a group,
   * and — more importantly — by D-170's containment check: a `UNIT` granter may
   * grant at `COURSE` **only when every group in that course sits in their
   * unit**. That is the exact case a scope-type RANKING waves through, and the
   * reason there is no ranking.
   *
   * Owned by the `courses` module.
   */
  groupsOfCourse(courseId: string): Promise<readonly string[]>;

  /**
   * The exam sessions of a course — "**all** its exam sessions" (§2.2).
   *
   * Owned by the `courses` module.
   */
  sessionsOfCourse(courseId: string): Promise<readonly string[]>;

  /**
   * The `Person` behind a `StudentProfile`, so `SELF` reach covers a student
   * reference to one's own record (D-146: `students.read` on one's own
   * `StudentProfile`).
   *
   * Owned by the `students` module.
   */
  personOfStudent(studentProfileId: string): Promise<string | null>;

  /**
   * The instant a scheduled session takes place, for D-170's derived `SESSION`
   * window ceiling (session date + 7 days). Null when the session does not
   * exist — which DENIES the grant rather than defaulting the ceiling.
   *
   * Owned by the `sessions` module.
   */
  sessionDate(sessionId: string): Promise<Date | null>;

  /**
   * A course's end date, for D-170's `COURSE` ceiling (end date + 7 days).
   * Null when the course does not exist, or has no end date — both DENY.
   *
   * Owned by the `courses` module.
   */
  courseEndDate(courseId: string): Promise<Date | null>;
}

const RELATION_NAMES = [
  "activeInstructorGroupIds",
  "isActiveGroupMember",
  "homeUnitOfStudent",
  "unitOfGroup",
  "unitOfPerson",
  "groupOfSession",
  "isOnSessionRoster",
  "isEnrolledInCourse",
  "groupsOfCourse",
  "sessionsOfCourse",
  "personOfStudent",
  "sessionDate",
  "courseEndDate",
] as const satisfies readonly (keyof ScopeRelations)[];

function unavailable(): ScopeRelations {
  const stub = {} as Record<string, () => Promise<never>>;
  for (const relation of RELATION_NAMES) {
    stub[relation] = () =>
      Promise.reject(new ScopeRelationUnavailableError(relation));
  }
  return stub as unknown as ScopeRelations;
}

let current: ScopeRelations = unavailable();

/**
 * Registers the relations a module owns. MERGES rather than replaces, because
 * the twelve facts above belong to five different modules and each registers
 * its own at the composition root. Anything left unregistered keeps the
 * throwing default.
 */
export function configureScopeRelations(
  partial: Partial<ScopeRelations>,
): void {
  current = { ...current, ...partial };
}

/** Restores the throwing default. Used by tests and by nothing else. */
export function resetScopeRelations(): void {
  current = unavailable();
}

/** The registry the coverage rules read. */
export function scopeRelations(): ScopeRelations {
  return current;
}

/** Every relation name, for the completeness test. */
export const SCOPE_RELATION_NAMES: readonly (keyof ScopeRelations)[] =
  RELATION_NAMES;
