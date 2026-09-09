/**
 * D-066's "what still holds this person", for the teaching side.
 *
 * §5.1 lists the relationships that hold a `Person`, and one of them is *"a role
 * assignment (instructor, planner, examiner)"*. That sentence names two
 * different things which D-145 spends its length keeping apart: the GRANT, which
 * `roleAssignmentSource` already reports, and the TEACHING FACT — that this
 * person actually stands beside a group on a Tuesday.
 *
 * An instructor can easily hold the second and not the first. A volunteer with
 * no account teaches a group; a grant is revoked the week they leave while their
 * teaching history stays. Under a membership-keyed or grant-keyed rule alone,
 * that person's retention clock starts while the record of who was with those
 * children is still being kept — which is precisely the shape §5.1 warns about:
 * *"every person category must be covered by construction, because the one that
 * is forgotten is the one that accumulates indefinitely."*
 *
 * So `InstructorAssignment` is its own source, and it can DATE its ending, which
 * is what makes it useful: `toDate` is a real column, so once every assignment
 * has closed this reports the latest of them rather than "held" forever.
 */
import { prisma } from "@/lib/database";
import type { RelationshipSource } from "@/lib/retention/last-relationship";

export const instructorAssignmentSource: RelationshipSource = {
  name: "InstructorAssignment",
  async resolve(personId) {
    const rows = await prisma.instructorAssignment.findMany({
      where: { personId },
      select: { toDate: true },
    });
    // `undefined`, NOT `{held: false}`: this source has never held them, which
    // is a different answer from "held them and stopped" and must not
    // contribute an ending date of its own to the aggregation.
    if (rows.length === 0) return undefined;

    const now = new Date();
    if (rows.some((row) => row.toDate === null || row.toDate > now)) {
      return { held: true };
    }

    // Every assignment has closed. The LATEST close is when this source stopped
    // holding them — D-066 takes the last relationship to end, not the first.
    const latest = rows.reduce<Date>(
      (max, row) => (row.toDate! > max ? row.toDate! : max),
      rows[0]!.toDate!,
    );
    return { held: false, endedAt: latest };
  },
};
