/**
 * The `ScopeRelations` this module OWNS — and the pair of them that D-145 rule 1
 * is made of.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FILE IS WHERE F-114 IS CLOSED
 *
 * `GroupMembership` rows are kept for life (D-059 applied to groups). In a
 * union-of-grants model over an append-only table, the natural implementation of
 * "a `GROUP` grant reaches the students in it" means **every instructor who ever
 * taught a child keeps read access to their complete record permanently**. That
 * is F-114, and D-145 rule 1 is the fix: coverage is evaluated LIVE, and a
 * `GROUP` grant reaches a pupil only while
 *
 *   1. the holder has an ACTIVE `InstructorAssignment` for that group, and
 *   2. the pupil has an ACTIVE `GroupMembership` in it,
 *
 * both **at query time**. The two halves are `activeInstructorGroupIds` and
 * `isActiveGroupMember` below, and they are asked on every single check —
 * `resolveReach` asks the first before it will put a group id in a reach at all,
 * and `coversResource` asks the second before it will let that reach touch a
 * pupil.
 *
 * **NEITHER IS CACHED AND NEITHER IS EVALUATED AT GRANT TIME.** That is the
 * whole property: an instructor who stops teaching a group loses sight of its
 * pupils on their next query, not at the next cleanup run. D-144 makes the same
 * argument for grant expiry — *a predicate cannot be behind schedule; a job can*.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A DENIAL AND NOT AN EMPTY LIST
 *
 * Both answer a POSITIVE membership question, so every failure mode — a deleted
 * group, a dangling `scopeId`, an unreadable database — produces "no" rather
 * than "yes". The authorization layer converts that into a refusal the caller
 * can see. `06-delivery.md` §2.1 makes the list case the one that must never be
 * silently dropped: an empty screen for an instructor whose assignment ended
 * teaches them the application is broken, when what happened is that they are no
 * longer the person who may read it.
 */
import type { ScopeRelations } from "@/lib/authorization";
import { prisma } from "@/lib/database";

/**
 * The half-open rule, as a Prisma filter: `fromDate <= at < toDate`, with a null
 * `toDate` meaning still open.
 *
 * It mirrors `../domain/interval.ts`'s `isActiveAt` and the two must agree — the
 * domain function is what the services and the screens use, this is what the
 * database evaluates, and a disagreement between them would be an access
 * decision that depends on which one asked. `groups-reach.test.ts` exercises
 * both against the same rows.
 */
function activeAt(at: Date) {
  return {
    fromDate: { lte: at },
    OR: [{ toDate: null }, { toDate: { gt: at } }],
  };
}

export const groupsScopeRelations: Partial<ScopeRelations> = {
  /**
   * Groups this person is CURRENTLY assigned to instruct — the first half of
   * D-145 rule 1, and the one `resolveReach` calls before it will admit a
   * `GROUP` grant into a reach at all.
   *
   * Resolved once per reach resolution however many `GROUP` grants a principal
   * holds, because the answer is the same for all of them.
   */
  async activeInstructorGroupIds(
    personId: string,
    at: Date,
  ): Promise<readonly string[]> {
    const rows = await prisma.instructorAssignment.findMany({
      where: { personId, ...activeAt(at) },
      select: { groupId: true },
    });
    return rows.map((row) => row.groupId);
  },

  /**
   * Is this pupil an ACTIVE member of this group right now — the second half.
   *
   * A LAPSED MEMBERSHIP ROW GRANTS NOTHING, which is the sentence that stops the
   * whole of F-114: the row survives for the child's history, and it stops
   * conferring access the instant it closes.
   */
  async isActiveGroupMember(input: {
    groupId: string;
    studentProfileId: string;
    at: Date;
  }): Promise<boolean> {
    const found = await prisma.groupMembership.findFirst({
      where: {
        groupId: input.groupId,
        studentProfileId: input.studentProfileId,
        ...activeAt(input.at),
      },
      select: { id: true },
    });
    return found !== null;
  },

  /**
   * The unit a group sits in (§3.6). Governs THAT GROUP'S records only — never
   * the pupils' profiles, which are governed by their own home unit (D-145).
   *
   * Null when the group does not exist, and equally when it exists with no unit
   * — v1 creates no `OrganizationUnit` rows, so an unassigned group is the
   * ordinary case today. Both DENY, which is the safe direction: every `UNIT`
   * coverage rule is a positive membership test, so a null cannot widen
   * anything.
   */
  async unitOfGroup(groupId: string): Promise<string | null> {
    const row = await prisma.group.findUnique({
      where: { id: groupId },
      select: { unitId: true },
    });
    return row?.unitId ?? null;
  },
};
