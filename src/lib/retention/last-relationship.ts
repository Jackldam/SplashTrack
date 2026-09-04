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
 * consent record; a legal retention ground on a record referencing them.
 *
 * `RelationshipSource` makes each relationship kind a separate, independently
 * testable unit, and the aggregation below has never had to change as they
 * arrived. Phase 0.4b could supply only `RoleAssignment` and a period-less
 * `Membership`; phase 1.1's `people` module registers `MembershipPeriod`,
 * `StudentProfile` and `PersonRelationship` — dated, real, and owned by the
 * module whose tables they read. `Consent` follows with its own module.
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
 * THE REGISTRY every relationship source is added to, and the list
 * `resolveLastRelationshipEnd` consults by default.
 *
 * A REGISTRY RATHER THAN A CONST ARRAY, changed in phase 1.1 for the reason the
 * original comment anticipated ("it grows by one entry per future module") and
 * for one it could not: the sources now live in the MODULES THAT OWN THEIR
 * TABLES. `MembershipPeriod`, `StudentProfile` and `PersonRelationship` belong
 * to `people` (D-057, `CLAUDE.md` §4), so this file must not query them — and a
 * const array naming them here would have imported the module that imports this
 * one, which is a cycle.
 *
 * The mechanism is `configureScopeRelations`' twin, deliberately: modules
 * REGISTER what they own, registration is explicit rather than an import-time
 * side effect, and an unregistered source contributes nothing rather than
 * silently answering "not held".
 *
 * `roleAssignmentSource` stays registered from here because `RoleAssignment` is
 * an authorization table this module's sibling owns, with no domain module
 * above it.
 */
const registeredSources = new Map<string, RelationshipSource>([
  [roleAssignmentSource.name, roleAssignmentSource],
]);

/**
 * Registers relationship sources, keyed by name so a module re-registering its
 * own is idempotent rather than a duplicate that double-counts an ending.
 */
export function registerRelationshipSources(
  sources: readonly RelationshipSource[],
): void {
  for (const source of sources) registeredSources.set(source.name, source);
}

/** The sources currently registered. */
export function relationshipSources(): readonly RelationshipSource[] {
  return [...registeredSources.values()];
}

/**
 * Drops every source a module registered, leaving the built-in
 * `roleAssignmentSource`. TEST SEAM ONLY.
 */
export function resetRelationshipSources(): void {
  registeredSources.clear();
  registeredSources.set(roleAssignmentSource.name, roleAssignmentSource);
}

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
  sources: readonly RelationshipSource[] = relationshipSources(),
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
