/**
 * D-066's "what still holds this person", for enrolment — §5.1's item that has
 * never had its own table until now.
 *
 * `01-domain-model.md` §5.1 lists *"an active `StudentProfile` enrolment"*
 * among the relationships that hold a `Person`. Phase 1.1 could only answer it
 * from the profile's own lifecycle log, and said so:
 *
 *   > §5.1's phrase names a table the `courses` module owns and that does not
 *   > exist. What this module can answer honestly is the profile's own
 *   > LIFECYCLE ... When `Enrolment` arrives it adds a source beside this one —
 *   > never a rewrite of the aggregation — and the two compose by taking the
 *   > later ending.
 *
 * This is that source, added beside `studentProfileSource` and not replacing
 * it. The two answer different questions and `resolveLastRelationshipEnd` takes
 * the LATEST ending across every source, so a pupil whose lifecycle says `LEFT`
 * but who still has an open enrolment is still held — which is the direction
 * that cannot delete a record too early.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT REACHES A `Person` THROUGH `Enrolment`'s OWN RELATION
 *
 * A `RelationshipSource` is asked about a `personId`, and `Enrolment`
 * references `StudentProfile` rather than `Person` — deliberately, so that it
 * cascades with the profile and stays out of both erasure registries. The
 * filter therefore traverses `Enrolment.studentProfile.personId`: a join key on
 * OUR table's own declared relation, reading no column of `StudentProfile`
 * other than the one that identifies the pupil. The alternative — a published
 * `people` lookup for one id — would add a cross-module call on the retention
 * path for nothing this cannot already say.
 */
import { prisma } from "@/lib/database";
import type { RelationshipSource } from "@/lib/retention/last-relationship";

import { lastEnrolmentEnd } from "../domain/enrolment";

export const enrolmentRelationshipSource: RelationshipSource = {
  name: "Enrolment",
  async resolve(personId) {
    const rows = await prisma.enrolment.findMany({
      where: { studentProfile: { personId } },
      select: { startedAt: true, endedAt: true },
    });

    // `undefined`, NOT `{held: false}`: this source has never held them, which
    // is a different answer from "held them and stopped" and must not
    // contribute an ending date of its own to the aggregation.
    const end = lastEnrolmentEnd(rows);
    if (end === undefined) return undefined;
    return end === null ? { held: true } : { held: false, endedAt: end };
  },
};
