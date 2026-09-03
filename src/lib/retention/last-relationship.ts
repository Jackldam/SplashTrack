/**
 * D-066 — a `Person`'s retention clock starts at the end of their LAST
 * relationship of any kind, never at the end of membership.
 *
 * The most common person in the database — a child taking lessons — has no
 * membership at all. Neither do guardians or external examiners. A rule keyed
 * on "active membership" would silently retain the majority forever. So the
 * question this file answers is "is this person still held by ANYTHING", and
 * it is answered by asking every `RelationshipSource` and taking the LATEST
 * end date across all of them — the person is retained until every
 * relationship has ended, not until the first one has.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE REGISTRY, NOT A SINGLE QUERY
 *
 * `01-domain-model.md` §5.1 lists the relationships that hold a person: an
 * active `MembershipPeriod`; an active `StudentProfile` enrolment; a role
 * assignment; a guardian relationship to a person still held; an unexpired
 * consent record; a legal retention ground on a record referencing them. Only
 * two of those have a table TODAY — `Membership` and `RoleAssignment`; the
 * rest (`MembershipPeriod`, `StudentProfile`, `PersonRelationship`, `Consent`)
 * belong to modules phase 0.4b does not build (`CLAUDE.md` §1: no domain
 * modules in this phase). A single hand-written query could not be correct
 * today and would need rewriting at every module boundary besides.
 *
 * `RelationshipSource` makes each relationship kind a separate, independently
 * testable unit; `RELATIONSHIP_SOURCES` is the list `resolveLastRelationshipEnd`
 * actually consults, and it grows by one entry per future module — never by
 * rewriting the aggregation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * "A GUARDIAN IS HELD ONLY WHILE THE CHILD THEY ARE GUARDIAN OF IS HELD —
 * WHICH FOLLOWS AUTOMATICALLY FROM THE RULE" (D-066)
 *
 * That sentence is a claim about COMPOSABILITY: a future `PersonRelationship`
 * source for "guardian of" does not need to store or compute its own end date.
 * It asks the CHILD's own `resolveLastRelationshipEnd` and reports that. As
 * long as the child is held by anything, the guardian relationship reports
 * "held" too, with no special case. `tests/unit/last-relationship.test.ts`
 * proves this composability against a fake stand-in source — `PersonRelationship`
 * itself does not exist yet, so the real guardian source cannot be built or
 * tested against a real table today, but the aggregation rule it will plug
 * into is built and proven now, per `docs/build/phase-0.4b-reach-and-retention-report.md`
 * §3.
 */
import { prisma } from "@/lib/database";

/**
 * What one relationship source reports for one person.
 *
 * `{ held: true }` — the relationship is ongoing; the person's retention clock
 * has not started via this source.
 * `{ held: false, endedAt }` — the relationship existed and ended on this date.
 */
export type RelationshipStatus =
  { readonly held: true } | { readonly held: false; readonly endedAt: Date };

export interface RelationshipSource {
  /** Human-readable, for diagnostics and test failure messages only. */
  readonly name: string;
  /**
   * Returns `undefined` when this source has NO record of the person at all
   * (never held them) — distinct from `{ held: false, endedAt }`, which means
   * the source held them and can date when that stopped.
   */
  resolve(personId: string): Promise<RelationshipStatus | undefined>;
}

/**
 * `Membership` carries no period/history today — one row per person, present
 * or absent (`MembershipPeriod`, D-059, is future `people`-module work that
 * will replace this with dated periods). So this source can say "still held"
 * but cannot date an ending it has no column for; a departed member is
 * `undefined` here; some OTHER source must account for them, or D-066's
 * relationship list is genuinely exhausted and the person enters `REVIEW`
 * with no known trigger date — which `resolveLastRelationshipEnd` reports as
 * `undefined`, honestly, rather than inventing one.
 */
export const membershipSource: RelationshipSource = {
  name: "Membership",
  async resolve(personId) {
    const row = await prisma.membership.findUnique({
      where: { personId },
      select: { personId: true },
    });
    return row ? { held: true } : undefined;
  },
};

/**
 * `RoleAssignment` carries `validFrom`/`validUntil` (D-144, D-170) — a real
 * window, so this source can both say "still held" (any row standing, or
 * bounded but not yet expired) and date the ending (the LATEST `validUntil`
 * across every row, once all of them have expired).
 */
export const roleAssignmentSource: RelationshipSource = {
  name: "RoleAssignment",
  async resolve(personId) {
    const rows = await prisma.roleAssignment.findMany({
      where: { personId },
      select: { validUntil: true },
    });
    if (rows.length === 0) return undefined;

    const now = new Date();
    if (rows.some((row) => row.validUntil === null || row.validUntil > now)) {
      return { held: true };
    }
    const latest = rows.reduce<Date>(
      (max, row) => (row.validUntil! > max ? row.validUntil! : max),
      rows[0]!.validUntil!,
    );
    return { held: false, endedAt: latest };
  },
};

/**
 * Every relationship source `resolveLastRelationshipEnd` consults by default.
 * Add a source here — never inline a new query into the resolver — as each
 * module in §5.1's list is built.
 */
export const RELATIONSHIP_SOURCES: readonly RelationshipSource[] = [
  membershipSource,
  roleAssignmentSource,
];

/**
 * D-066's rule, applied: the person's retention clock starts at the end of
 * their LAST relationship of any kind.
 *
 * - `{ held: true }` — at least one source reports the person is currently
 *   held. The clock has not started.
 * - `{ held: false, endedAt }` — every source that ever held the person
 *   reports it has ended; `endedAt` is the LATEST of those endings (the
 *   moment the LAST one ended, not the first).
 * - `undefined` — no source has ever held this person. `PERSON_IDENTITY`'s
 *   `RetentionPolicy` trigger is `LAST_RELATIONSHIP_END`, so this is reported
 *   honestly rather than defaulted to "held" or "ended": a person with no
 *   relationship recorded by anything is not a case this function can decide.
 */
export async function resolveLastRelationshipEnd(
  personId: string,
  sources: readonly RelationshipSource[] = RELATIONSHIP_SOURCES,
): Promise<RelationshipStatus | undefined> {
  const results = await Promise.all(
    sources.map((source) => source.resolve(personId)),
  );
  const known = results.filter(
    (result): result is RelationshipStatus => result !== undefined,
  );
  if (known.length === 0) return undefined;
  if (known.some((result) => result.held)) return { held: true };

  const ended = known as Extract<RelationshipStatus, { held: false }>[];
  const latest = ended.reduce<Date>(
    (max, result) => (result.endedAt > max ? result.endedAt : max),
    ended[0]!.endedAt,
  );
  return { held: false, endedAt: latest };
}
