/**
 * The permission catalogue (`02-security-privacy.md` §2.5), and the two closed
 * subsets other rules bind to.
 *
 * **This is the catalogue.** §2.5 states the rule this file makes checkable: *a
 * permission referenced anywhere in the design set and absent here is a defect,
 * not a shorthand.* That rule exists because `roles.assign` was cited as a
 * high-risk permission in `07-operations.md` §1.3 while existing nowhere
 * (F-109) — role assignment, the highest-privilege operation in the product,
 * had no permission at all. Several others were referenced by chapters 07, 13,
 * 14 and 15 and never defined.
 *
 * `PermissionKey` being a union rather than `string` is what turns the next
 * such shorthand into a compile error at the call site instead of a permission
 * check that silently never matches a row. A misspelled `string` permission
 * resolves to no grant, which DENIES — safe, and invisible until the day an
 * examiner cannot record a result.
 *
 * Nothing here binds to a ROLE NAME, ever (D-130). Roles are user-definable —
 * a school that invents *Hulpinstructeur* and *Stagiair* must not thereby fall
 * off a security control — so the MFA mandate, the alert rules, the elevated
 * idle window and the high-risk set all bind to permissions.
 */

/**
 * Every permission, grouped as §2.5 groups them. The catalogue is
 * ORDER-INSENSITIVE and the grouping is documentation; `PERMISSIONS` below is
 * the flat set the rest of the code uses.
 */
export const PERMISSION_CATALOGUE = {
  people: [
    "people.read",
    "people.create",
    "people.update",
    "people.delete",
    "people.export",
  ],
  students: [
    "students.read",
    "students.create",
    "students.update",
    "students.archive",
    "students.notes.read",
    "students.notes.write",
    // Special category — separately gated (D-010), and everything it gates is
    // in the protected free-text class (D-148).
    "students.medical.read",
    "students.medical.write",
  ],
  groupsAndCourses: [
    "groups.read",
    "groups.manage",
    "groups.assign_members",
    "courses.read",
    "courses.manage",
    "enrolments.manage",
  ],
  skills: [
    "skills.read",
    "skills.manage_catalogue",
    "skills.assess",
    "skills.revoke",
  ],
  attendance: ["attendance.read", "attendance.record", "attendance.amend"],
  exams: [
    "exams.read",
    "exams.manage",
    "exams.assess",
    "exams.results.record",
    // D-085's four-eyes gate on exam candidacy is "overridable only with an
    // explicit permission". This is it, and its override RATE is the number a
    // chair can act on.
    "exams.candidacy.override",
    "certificates.issue",
    "certificates.revoke",
  ],
  planning: ["planning.read", "planning.manage"],
  fees: ["fees.read", "fees.manage", "fees.export"],
  pages: [
    "pages.read",
    "pages.manage",
    "branding.manage",
    // F-115: public inquiry free text routinely contains health data about a
    // named child and was reachable through `pages.manage`. Never implied by it.
    "inquiries.read",
    "inquiries.manage",
  ],
  authorization: [
    "roles.read",
    // Grants an EXISTING role. Distinct from `roles.manage`, which edits which
    // permissions a role carries and is strictly stronger (F-109).
    "roles.assign",
    "roles.manage",
    "accessgroups.read",
    "accessgroups.assign",
    "accessgroups.manage",
  ],
  identity: [
    "identity.providers.read",
    // D-140: its own permission, never implied by `organization.settings.manage`
    // — "can edit settings" must not mean "can mint administrators".
    "identity.providers.manage",
    "sessions.read",
    // An emergency power (D-128's Article 33 containment), separately grantable.
    "sessions.revoke",
  ],
  backup: [
    // Four keys because taking a backup, exfiltrating one, overwriting the
    // database with one, and redirecting where they go are four different
    // powers.
    "backup.run",
    "backup.download",
    "backup.restore",
    "backup.settings.manage",
  ],
  administration: [
    "organization.settings.manage",
    "audit.read",
    // Distinct from `audit.read`: reading events is oversight, compiling a
    // per-actor dossier is an investigation (D-128).
    "audit.report",
    // F-125, D-156: the diagnostics page reveals whether a newer release with a
    // security advisory exists — a machine-readable answer to "is this instance
    // exploitable?". ORGANIZATION-scoped, authenticated always.
    "diagnostics.read",
    "privacy.export",
    "privacy.erase",
  ],
} as const;

type CataloguedPermission =
  (typeof PERMISSION_CATALOGUE)[keyof typeof PERMISSION_CATALOGUE][number];

/** A permission key. The union, not `string` — see the module comment. */
export type PermissionKey = CataloguedPermission;

/** The flat catalogue, frozen. */
export const PERMISSIONS: ReadonlySet<PermissionKey> = new Set(
  Object.values(PERMISSION_CATALOGUE).flat() as PermissionKey[],
);

/** Narrows an untrusted string to a catalogued permission, or `null`. */
export function asPermissionKey(value: string): PermissionKey | null {
  return PERMISSIONS.has(value as PermissionKey)
    ? (value as PermissionKey)
    : null;
}

/**
 * The HIGH-RISK SET (`02-security-privacy.md` §1.2).
 *
 * Holding ANY of these at ANY scope has three consequences, none of which may
 * be bound to a role name (D-130):
 *   1. MFA is mandatory — enforced at login AND at grant time, so granting one
 *      of these to an account with no verified factor fails rather than
 *      creating an unprotected administrator.
 *   2. The ELEVATED (shorter) session idle window applies, strictest wins on
 *      overlap (D-173, §4.1.2).
 *   3. It is the set the security alert rules bind to (`07-operations.md` §1.3).
 *
 * §1.2 names the set with three wildcards — `privacy.*`, `backup.*`,
 * `students.medical.*`. They are expanded here rather than matched at runtime:
 * a prefix match would silently absorb every future key beginning with those
 * words, which is the wrong direction of surprise for a set whose membership
 * compels MFA. `high-risk-set.test.ts` asserts the expansion still covers every
 * catalogued key under those three prefixes, so ADDING one goes red rather than
 * being absorbed.
 *
 * **Keeping this set small is a design goal, not an accident** (D-173's
 * trade-off): an instructor who is also the treasurer falls in it and gets the
 * shorter window on a wet tablet. That is the correct direction of failure and
 * it is an argument for a small set, not for binding to names.
 */
export const HIGH_RISK_PERMISSIONS: ReadonlySet<PermissionKey> = new Set([
  "organization.settings.manage",
  "identity.providers.manage",
  "roles.assign",
  "roles.manage",
  "accessgroups.assign",
  // privacy.*
  "privacy.export",
  "privacy.erase",
  // audit
  "audit.read",
  // backup.*
  "backup.run",
  "backup.download",
  "backup.restore",
  "backup.settings.manage",
  // students.medical.*
  "students.medical.read",
  "students.medical.write",
] as const);

/** The three prefixes §1.2 states as wildcards, for the expansion test. */
export const HIGH_RISK_PREFIXES = [
  "privacy.",
  "backup.",
  "students.medical.",
] as const;

/** True when this principal's permission set compels MFA and the short window. */
export function holdsHighRiskPermission(
  held: Iterable<PermissionKey>,
): boolean {
  for (const key of held) {
    if (HIGH_RISK_PERMISSIONS.has(key)) return true;
  }
  return false;
}

/**
 * The CLOSED permission set of the seeded `SELF` role (D-146).
 *
 * `SELF` was previously granted "to every authenticated person, **implicitly**".
 * An implicit scope match means
 * `requirePermission('students.medical.read', {student: self})` can succeed for
 * an authenticated person holding NO GRANT AT ALL — deny-by-default (§1.1 rule
 * 2) defeated by a rule in the same document. F-124.
 *
 * So `SELF` is an ordinary seeded `Role` row assigned at account creation,
 * visible in the administration UI, subject to §2.6 like any other — and its
 * permission set is this list and nothing else.
 *
 * **NEVER** `students.medical.*`, **never** `students.notes.*`, never anything
 * about another person: a guardian reading a child's record is not `SELF` and
 * has no scope in v1 (D-122, OD-5). Adding a key here is a security-relevant
 * change requiring review, in the same class as adding one to the high-risk set.
 *
 * The row itself is protected at its own boundary rather than by the settings
 * registry (D-171, F-141): the seeded `Role` carries `isSystem: true` and the
 * roles module refuses edits to system roles — because an ORGANIZATION-scoped
 * administrator holding `roles.manage` would otherwise open People & roles, add
 * a permission to the seeded `SELF` role, pass §2.6's invariants (they hold
 * everything), and nothing in the roles module would know the settings registry
 * had called that role invariant.
 */
export const SELF_PERMISSIONS: ReadonlySet<PermissionKey> = new Set([
  // own `Person`
  "people.read",
  // own `StudentProfile`
  "students.read",
  // own skill progress
  "skills.read",
  // own attendance
  "attendance.read",
  // own awards
  "exams.read",
] as const);

/**
 * D-146's set names a sixth member — **own consent records** — and §2.5's
 * catalogue defines NO permission for consent at any scope. By §2.5's own rule
 * ("a permission referenced anywhere in the design set and absent here is a
 * defect, not a shorthand") that is a catalogue gap, not a shorthand for one of
 * the keys above, and inventing `consent.read` here would put the catalogue's
 * second home in this file.
 *
 * So the sixth member is recorded and NOT implemented: it arrives with the
 * `consent` module, which is also what adds the key to §2.5. Recorded in
 * `docs/build/phase-0.4b-reach-and-retention-report.md` §3.
 *
 * D-146 also grants SELF a read of one's own consent records and explicitly NOT
 * their withdrawal — in v1 withdrawal and objection are staff-operated in the
 * privacy admin area (D-172), because a non-member guardian has no account
 * (§2.4) and the guardian portal is v2 (D-161).
 */
export const SELF_PERMISSION_GAP = "own consent records (no catalogued key)";
