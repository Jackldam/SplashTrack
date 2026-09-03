/**
 * Scope types and resource references — the vocabulary every guarded call uses.
 *
 * A grant is not a permission. **A grant is a permission plus a scope**
 * (`02-security-privacy.md` §2.1), and every protected operation is
 * resource-referenced (D-030): `hasPermission('students.read')` is meaningless
 * in a scoped world, because the honest question is always *"this student?"*.
 * Making the resource reference a REQUIRED argument is what stops an
 * instructor's group-scoped grant from reading the whole organisation.
 */

/**
 * The six scope types. Mirrors the `ScopeType` enum in `prisma/schema.prisma`;
 * `tests/unit/scope-type-sync.test.ts` asserts the two are the same set in both
 * directions, so adding a member to one without the other goes red.
 *
 * `RELATED` is not here and must not be added — see the schema enum's comment
 * and OD-5.
 */
export const SCOPE_TYPES = [
  "ORGANIZATION",
  "UNIT",
  "GROUP",
  "COURSE",
  "SESSION",
  "SELF",
] as const;

export type ScopeType = (typeof SCOPE_TYPES)[number];

/** The two scope types the grant row itself implies, so they carry no `scopeId`. */
export const SELF_IMPLIED_SCOPE_TYPES: ReadonlySet<ScopeType> = new Set([
  "ORGANIZATION",
  "SELF",
] as const);

/**
 * The two scope types whose `validUntil` is mandatory and bounded.
 *
 * D-144 makes it schema-mandatory for `SESSION`. D-170's ceiling table adds
 * `COURSE` — "mandatory and bounded", which is what §2.4's *"Internal examiner,
 * time-bounded"* always meant, and what D-144 could not express. D-170
 * completes D-144, so both are enforced.
 */
export const BOUNDED_WINDOW_SCOPE_TYPES: ReadonlySet<ScopeType> = new Set([
  "SESSION",
  "COURSE",
] as const);

/**
 * D-170's window ceilings, in days past the referent's own end date.
 *
 * `SESSION` is *"derived, not accepted"*: it defaults to the session's date and
 * is extendable only to session date + 7 days — D-068's *"a short window around
 * it for preparation and follow-up"* made numeric. `COURSE` is the course's own
 * end date + 7 days.
 *
 * D-170 asks for these "in the schema beside the not-null constraint". They are
 * NOT there, because both are computed from a table that does not exist yet
 * (`ScheduledSession`, `Course`), and a CHECK cannot read another table anyway.
 * They are enforced in `assertGrantable`, which DENIES when the referent cannot
 * be resolved. Moving the ceiling into a stored derived column is recorded as
 * a follow-up in `docs/build/phase-0.4b-reach-and-retention-report.md` §4.
 */
export const WINDOW_CEILING_DAYS_PAST_REFERENT = 7;

/** A grant's scope, as stored on `RoleAssignment`. */
export interface Scope {
  readonly scopeType: ScopeType;
  /** Null exactly for `ORGANIZATION` and `SELF`. */
  readonly scopeId: string | null;
}

/**
 * The resource a guarded call names.
 *
 * Written as a one-key object so a call site reads the way the design writes it
 * — `requirePermission(principal, 'attendance.record', { group: groupId })`.
 * Exactly one key must be present; `normaliseResourceRef` refuses zero or
 * several, because "which resource is this?" having two answers is not a
 * question the coverage rules can answer, and §1.1 rule 2 says nothing
 * ambiguous becomes an allow.
 */
export type ResourceRef =
  | { readonly organization: true }
  | { readonly unit: string }
  | { readonly group: string }
  | { readonly course: string }
  | { readonly session: string }
  | { readonly student: string }
  | { readonly person: string };

export const RESOURCE_REF_KEYS = [
  "organization",
  "unit",
  "group",
  "course",
  "session",
  "student",
  "person",
] as const;

export type ResourceKind = (typeof RESOURCE_REF_KEYS)[number];

/** A resource reference in the shape the coverage rules match on. */
export type NormalisedResourceRef =
  | { readonly kind: "organization" }
  | { readonly kind: "unit"; readonly id: string }
  | { readonly kind: "group"; readonly id: string }
  | { readonly kind: "course"; readonly id: string }
  | { readonly kind: "session"; readonly id: string }
  | { readonly kind: "student"; readonly id: string }
  | { readonly kind: "person"; readonly id: string };

export class InvalidResourceRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidResourceRefError";
  }
}

/**
 * Turns the call-site shape into the matched shape, refusing anything
 * ambiguous. Throws rather than returning null: a malformed reference is a
 * programming error at a guarded call site, and the guard converts every throw
 * into a denial anyway (§1.1 rule 2).
 */
export function normaliseResourceRef(ref: ResourceRef): NormalisedResourceRef {
  const present = RESOURCE_REF_KEYS.filter(
    (key) => (ref as Record<string, unknown>)[key] !== undefined,
  );

  if (present.length !== 1) {
    throw new InvalidResourceRefError(
      present.length === 0
        ? "A resource reference names no resource. Every protected operation is " +
            "resource-referenced (D-030); a bare permission check is not sufficient."
        : `A resource reference names ${present.length} resources (${present.join(", ")}). ` +
            "Exactly one is required — two answers to 'which resource?' is not a " +
            "question the coverage rules can answer.",
    );
  }

  const kind = present[0];
  if (kind === "organization") {
    if ((ref as { organization: unknown }).organization !== true) {
      throw new InvalidResourceRefError(
        "{ organization } must be exactly `true`.",
      );
    }
    return { kind: "organization" };
  }

  const id = (ref as Record<string, unknown>)[kind];
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidResourceRefError(
      `{ ${kind} } must be a non-empty id, received ${typeof id}.`,
    );
  }
  return { kind, id };
}

/** Human-readable form, for audit reasons and denial logs. */
export function describeResourceRef(ref: NormalisedResourceRef): string {
  return ref.kind === "organization" ? "organization" : `${ref.kind}:${ref.id}`;
}
