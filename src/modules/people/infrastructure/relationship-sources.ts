/**
 * D-066's relationship sources for the tables this module owns.
 *
 * `01-domain-model.md` §5.1 lists what HOLDS a `Person`: an active
 * `MembershipPeriod`; an active `StudentProfile` enrolment; a role assignment; a
 * guardian relationship to a person still held; an unexpired consent record; a
 * legal retention ground on a record referencing them.
 *
 * Phase 0.4b built the aggregation and could supply only two of those, from the
 * two tables that existed. Phase 1.1 supplies three more and REPLACES one:
 *
 *   - `membershipPeriodSource` — replaces `membershipSource`. That source could
 *     say "still held" and could not date an ending, because `Membership` had no
 *     period column to date it from; its own doc comment named this replacement
 *     as the `people` module's work. It is now a real interval and the ending is
 *     a real date.
 *   - `studentProfileSource` — the pupil's own relationship with the school.
 *   - `guardianRelationshipSource` — D-066's composability claim, proven against
 *     real rows for the first time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * "AN ACTIVE `StudentProfile` ENROLMENT", WITH NO `Enrolment` TABLE YET
 *
 * §5.1's phrase names a table the `courses` module owns and that does not exist.
 * What this module can answer honestly is the profile's own LIFECYCLE: a pupil
 * is held while their profile's derived state is anything but `LEFT`, and the
 * moment they stopped being held is the `LEFT` event currently in force.
 *
 * A PAUSE IS NOT AN ENDING. A child with a broken arm or a term abroad is still
 * the school's pupil, and starting a 24-month retention clock on them in
 * September would be wrong in the direction that deletes a real record.
 *
 * When `Enrolment` arrives it adds a source beside this one — never a rewrite of
 * the aggregation — and the two compose by taking the later ending, which is
 * what `resolveLastRelationshipEnd` already does.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RECURSION, AND WHY IT TERMINATES
 *
 * D-066: *"A guardian is held only while the child they are guardian of is
 * held — which follows automatically from the rule rather than needing a special
 * case."* So the guardian source asks the CHILD's own
 * `resolveLastRelationshipEnd` and reports the answer verbatim.
 *
 * Asking it over the FULL source list would not terminate: the child's guardian
 * source would ask the child's own dependants, and a family in which two adults
 * are each recorded as guardian of the other's child loops. So the subject's
 * status is resolved over `SUBJECT_SIDE_SOURCES` — every source EXCEPT this
 * one — which is exactly one level of indirection and provably finite.
 *
 * The cost is stated rather than hidden: a guardian who is held ONLY because
 * they guard a child who is in turn held only because they guard someone else
 * resolves as not-held by this source. That chain has no meaning in a swim
 * school, and the alternative — an unbounded walk over a graph a data-entry
 * mistake can make cyclic — is a retention job that hangs.
 */
import { prisma } from "@/lib/database";
import {
  resolveLastRelationshipEnd,
  roleAssignmentSource,
  type RelationshipSource,
  type RelationshipStatus,
} from "@/lib/retention/last-relationship";

import { lastMembershipEnd } from "../domain/membership";
import {
  lifecycleEndedAt,
  type LifecycleEvent,
} from "../domain/student-lifecycle";

/**
 * `MembershipPeriod` — belonging as a set of intervals (D-059).
 *
 * `undefined` when the person has no `Membership` at all, which is the ordinary
 * case: the most common person in the database is a child taking lessons and
 * never a member (§5.1). A membership with NO periods is also `undefined` — the
 * register entry exists but no interval of belonging ever did, so this source
 * cannot date an ending it never saw.
 */
export const membershipPeriodSource: RelationshipSource = {
  name: "MembershipPeriod",
  async resolve(personId) {
    const membership = await prisma.membership.findUnique({
      where: { personId },
      select: { periods: { select: { startedAt: true, endedAt: true } } },
    });
    if (!membership) return undefined;

    const end = lastMembershipEnd(membership.periods);
    if (end === undefined) return undefined;
    return end === null ? { held: true } : { held: false, endedAt: end };
  },
};

/**
 * `StudentProfile` — the pupil's relationship with the school, derived from the
 * append-only lifecycle log.
 */
export const studentProfileSource: RelationshipSource = {
  name: "StudentProfile",
  async resolve(personId) {
    const profile = await prisma.studentProfile.findUnique({
      where: { personId },
      select: {
        lifecycleEvents: {
          select: { type: true, occurredAt: true },
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!profile) return undefined;

    const endedAt = lifecycleEndedAt(
      profile.lifecycleEvents satisfies LifecycleEvent[],
      new Date(),
    );
    return endedAt === null ? { held: true } : { held: false, endedAt };
  },
};

/**
 * The sources a SUBJECT's status is resolved over when a guardian asks about
 * them. Every source except the guardian one — see the header for why.
 */
const SUBJECT_SIDE_SOURCES: readonly RelationshipSource[] = [
  membershipPeriodSource,
  studentProfileSource,
  roleAssignmentSource,
];

/**
 * `PersonRelationship` — a guardian (or emergency contact) is held while the
 * person they answer for is held.
 *
 * The relationship's OWN administrative window is respected first: a
 * relationship the school recorded as ended on a date is an ended relationship
 * with that date, whatever the child's status. Only an OPEN relationship
 * delegates to the subject.
 *
 * `undefined` when this person answers for nobody — they then fall through to
 * their own sources, which is the case the phase-0.4b test named "a guardian
 * with no guardian-of relationship at all".
 */
export const guardianRelationshipSource: RelationshipSource = {
  name: "PersonRelationship (relative of)",
  async resolve(personId) {
    const relationships = await prisma.personRelationship.findMany({
      where: { fromPersonId: personId },
      select: { toPersonId: true, validTo: true },
    });
    if (relationships.length === 0) return undefined;

    const now = new Date();
    const statuses: RelationshipStatus[] = [];

    for (const relationship of relationships) {
      if (relationship.validTo !== null && relationship.validTo <= now) {
        statuses.push({ held: false, endedAt: relationship.validTo });
        continue;
      }
      const subject = await resolveLastRelationshipEnd(
        relationship.toPersonId,
        SUBJECT_SIDE_SOURCES,
      );
      // The subject is held by nothing this instance knows about. That is not
      // "the guardian is released": it is an unknown, reported as such by
      // contributing nothing, exactly as `resolveLastRelationshipEnd` treats a
      // source with no record of a person.
      if (subject !== undefined) statuses.push(subject);
    }

    if (statuses.length === 0) return undefined;
    if (statuses.some((status) => status.held)) return { held: true };

    // A guardian of two children is held until the LAST child's relationship
    // ends — the aggregation rule, applied within this one source.
    const ended = statuses as Extract<RelationshipStatus, { held: false }>[];
    return {
      held: false,
      endedAt: ended.reduce<Date>(
        (latest, status) => (status.endedAt > latest ? status.endedAt : latest),
        ended[0]!.endedAt,
      ),
    };
  },
};
