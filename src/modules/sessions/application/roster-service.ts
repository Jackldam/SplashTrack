/**
 * Adding a guest to a lesson — *inhaalles*.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE ROW, AND THE ACCESS FALLS OUT OF IT
 *
 * D-179: *"een inhaalles is er 1 met een gast erbij"*. A make-up lesson is an
 * ordinary session with a guest attending once — not a separate entity, not a
 * session type, not an entitlement counter (D-109 models the shape and builds no
 * workflow). So this file writes exactly one `SessionRosterEntry` and does
 * nothing else.
 *
 * **THE RECEIVING INSTRUCTOR'S SIGHT OF THE CHILD COMES FROM THAT ROW**, through
 * `isOnSessionRoster` and a `SESSION`-scoped grant — never from group
 * membership, which the guest by definition does not have, and never from an
 * administrator minting something. That is the whole of D-179's second half, and
 * it is why `SESSION` reach is weekly machinery here rather than an exotic case
 * for external examiners.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT ADDING A GUEST IS **NOT**
 *
 * It is not a placement. No `GroupMembership` is written, no `GroupMove`, and no
 * capacity place is consumed — a guest is not in the group, so a full group can
 * still take a make-up lesson. See `@/modules/groups` `domain/capacity.ts` for
 * why that reading is the one that keeps D-179 and D-180 coherent.
 *
 * SERVER-ONLY.
 */
import { requirePermission } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { optionalText, requiredText } from "@/lib/validation";
import { recordAuditEvent } from "@/modules/audit";

import { ensureSessionsRegistrations } from "../infrastructure/registrations";
import { TEXT_MAX } from "./input";
import { ScheduleError, type ActorContext } from "./schedule-service";

function instant(actor: ActorContext): Date {
  return actor.at ?? new Date();
}

export interface AddGuestInput {
  studentProfileId: unknown;
  /** *"inhaalles, les van 5 maart gemist"*. Optional per §3.2's `reason?`. */
  reason?: unknown;
}

/**
 * Adds a pupil to one lesson as a guest.
 *
 * `groups.assign_members` on the session, not `planning.manage`: this is a
 * decision about a CHILD — which lesson they attend — rather than about the
 * timetable, and the person who makes it is whoever administers placements. The
 * reference is the SESSION, so a `SESSION`-scoped grant is enough and a
 * `GROUP`-scoped instructor can do it for their own group's lesson.
 */
export async function addGuestToSession(
  actor: ActorContext,
  sessionId: string,
  input: AddGuestInput,
): Promise<{ rosterEntryId: string }> {
  ensureSessionsRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "groups.assign_members",
    { session: sessionId },
    { at },
  );

  const studentProfileId = requiredText(
    "studentProfileId",
    input.studentProfileId,
    40,
  );
  const reason = optionalText("reason", input.reason, TEXT_MAX.reason);

  return prisma.$transaction(async (tx) => {
    const session = await tx.scheduledSession.findUnique({
      where: { id: sessionId },
      select: { id: true, groupId: true, status: true },
    });
    if (!session) {
      throw new ScheduleError("notFound", "That lesson does not exist.");
    }
    if (session.status === "CANCELLED") {
      throw new ScheduleError(
        "alreadyCancelled",
        "That lesson is cancelled, so nobody is attending it. Add the guest " +
          "to the lesson they are actually coming to.",
      );
    }

    const entry = await tx.sessionRosterEntry.create({
      data: { sessionId, studentProfileId, source: "GUEST", reason },
      select: { id: true },
    });

    await recordAuditEvent(
      {
        // AN ACCESS-AFFECTING WRITE, and worth finding later as one: this row is
        // what makes a child readable to an instructor who has no other
        // relationship with them. `grantsSessionReach` is the token an auditor
        // searches for when asking how somebody came to see a record.
        eventType: "sessions.roster.guest_added",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "scheduled_session",
        targetId: sessionId,
        requestId: actor.requestId ?? null,
        changedFields: {
          studentProfileId,
          rosterEntryId: entry.id,
          groupId: session.groupId,
          source: "GUEST",
          grantsSessionReach: true,
        },
      },
      tx,
    );

    return { rosterEntryId: entry.id };
  });
}

/**
 * Removes an explicitly-added guest.
 *
 * A DELETE, uniquely in these two modules, and it is the right verb: this row is
 * not history, it is a statement about a lesson that has not happened yet — "we
 * expect this child on Tuesday". Withdrawing it before the lesson leaves nothing
 * worth keeping, and it must genuinely remove the reach it conferred rather than
 * close it, because `isOnSessionRoster` asks whether the row EXISTS.
 *
 * Once attendance has been registered against the lesson that stops being true,
 * and the `attendance` module — which owns the append-only record of who was
 * actually there (D-061) — is where that constraint will live. Recorded here so
 * the next author sees the boundary rather than discovering it.
 */
export async function removeGuestFromSession(
  actor: ActorContext,
  sessionId: string,
  studentProfileId: string,
): Promise<void> {
  ensureSessionsRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "groups.assign_members",
    { session: sessionId },
    { at },
  );

  await prisma.$transaction(async (tx) => {
    const entry = await tx.sessionRosterEntry.findUnique({
      where: {
        sessionId_studentProfileId: { sessionId, studentProfileId },
      },
      select: { id: true, source: true },
    });
    if (!entry) return;

    await tx.sessionRosterEntry.delete({ where: { id: entry.id } });

    await recordAuditEvent(
      {
        eventType: "sessions.roster.guest_removed",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "scheduled_session",
        targetId: sessionId,
        requestId: actor.requestId ?? null,
        changedFields: {
          studentProfileId,
          rosterEntryId: entry.id,
          endsSessionReach: true,
        },
      },
      tx,
    );
  });
}
