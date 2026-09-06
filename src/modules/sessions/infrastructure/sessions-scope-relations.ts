/**
 * The `ScopeRelations` this module OWNS — and the one that makes a make-up
 * lesson work without an administrator granting anything.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `isOnSessionRoster` IS WEEKLY MACHINERY, NOT AN EXOTIC CASE
 *
 * D-179: *"een inhaalles is er 1 met een gast erbij"*. A make-up lesson is an
 * ordinary session with a guest attending once, and the guest is a pupil
 * enrolled elsewhere — **so they are not in the group**. `GROUP` coverage
 * reaches *"the students in it"*, which the guest is not, and without a
 * session-derived path the receiving instructor cannot see the child standing in
 * front of them. The fix at 16:55 on a Tuesday is then an administrator minting
 * a grant, on the code path D-031 calls the highest-risk in the application.
 *
 * This relation is what stops that. A `SESSION`-scoped grant plus a roster entry
 * is the whole mechanism, and D-068 requires the roster to be read **at the time
 * of the check**, never cached at grant time — so adding or removing a pupil
 * changes reach immediately.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ROSTER IS DERIVED PLUS EXPLICIT, AND BOTH HALVES ARE HERE
 *
 * §3.2: *"the roster of a session is derived from the group **plus** any
 * explicitly added guests."* So a pupil is on a session's roster when EITHER
 *
 *   - they were an active member of that session's group on the day of the
 *     lesson, or
 *   - somebody put them there — which for a make-up lesson is a `GUEST` row.
 *
 * Deriving the group half rather than materialising it is safe precisely because
 * `GroupMembership` is time-bounded and never mutated (D-059's rule applied to
 * groups): "who was in group G on 3 March" is a stable answer that does not
 * change when a child moves in April. Materialising it at generation time would
 * have been worse — a term generated in September would miss every child who
 * joined in November.
 *
 * **The membership is checked against the LESSON's date, not against `at`.** A
 * child who left the group last week was still on last month's roster, and the
 * instructor reviewing that lesson is looking at who was there. `at` is when the
 * question is being asked; `occursOn` is what it is being asked about.
 */
import type { ScopeRelations } from "@/lib/authorization";
import { prisma } from "@/lib/database";

export const sessionsScopeRelations: Partial<ScopeRelations> = {
  /**
   * The group a scheduled session belongs to. `UNIT` and `GROUP` reach a session
   * through it (§2.2), and `UNIT` reaches it through this plus `unitOfGroup` —
   * which is §3.6's *"`ScheduledSession` inherits its unit from its group"* made
   * executable.
   *
   * Null when the session does not exist, which DENIES.
   */
  async groupOfSession(sessionId: string): Promise<string | null> {
    const row = await prisma.scheduledSession.findUnique({
      where: { id: sessionId },
      select: { groupId: true },
    });
    return row?.groupId ?? null;
  },

  /**
   * Is this pupil on that session's roster? See the file comment for the two
   * halves and for why the group half is checked against the lesson's own date.
   */
  async isOnSessionRoster(input: {
    sessionId: string;
    studentProfileId: string;
    at: Date;
  }): Promise<boolean> {
    const session = await prisma.scheduledSession.findUnique({
      where: { id: input.sessionId },
      select: { groupId: true, occursOn: true },
    });
    // A dangling session id DENIES. Every coverage rule is a positive
    // membership test, so a missing referent can never widen anything.
    if (!session) return false;

    // The explicit half — a guest, or anyone else deliberately added.
    const explicit = await prisma.sessionRosterEntry.findFirst({
      where: {
        sessionId: input.sessionId,
        studentProfileId: input.studentProfileId,
      },
      select: { id: true },
    });
    if (explicit) return true;

    // The derived half — a member of the group ON THE DAY OF THE LESSON.
    const member = await prisma.groupMembership.findFirst({
      where: {
        groupId: session.groupId,
        studentProfileId: input.studentProfileId,
        fromDate: { lte: session.occursOn },
        OR: [{ toDate: null }, { toDate: { gt: session.occursOn } }],
      },
      select: { id: true },
    });
    return member !== null;
  },

  /**
   * When a session takes place — D-170's derived `SESSION` window ceiling
   * (session date + 7 days).
   *
   * `startsAt` and not `occursOn`: the ceiling is about a real instant, and
   * `occursOn` is a calendar day at UTC midnight, which for an evening lesson in
   * summer is nearly a day early. Null when the session does not exist, which
   * DENIES the grant rather than defaulting the ceiling.
   */
  async sessionDate(sessionId: string): Promise<Date | null> {
    const row = await prisma.scheduledSession.findUnique({
      where: { id: sessionId },
      select: { startsAt: true },
    });
    return row?.startsAt ?? null;
  },
};
