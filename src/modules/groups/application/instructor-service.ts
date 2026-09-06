/**
 * Assigning an instructor to a group, and ending that assignment.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS NOT HOW ACCESS IS GRANTED, AND THE DIFFERENCE IS THE POINT
 *
 * D-060: *membership is never an implicit prerequisite for a role*, and the
 * converse holds just as hard — assigning someone to teach a group grants them
 * nothing. Access comes from a `RoleAssignment` with `scopeType = GROUP`, issued
 * through `roles.assign` in the authorization layer, and nothing in this file
 * writes one.
 *
 * What this row IS, is the live half of that grant's coverage. D-145 rule 1:
 * a `GROUP` grant reaches a pupil only while the holder has an ACTIVE
 * `InstructorAssignment` *and* the pupil has an ACTIVE `GroupMembership`, both
 * evaluated at query time. So the two administrative acts are separate, and the
 * ordinary way an instructor's access ends is that somebody ends their
 * assignment here — which takes effect on their very next query, without anyone
 * touching a grant.
 *
 * That asymmetry is deliberate and it is worth stating plainly: this file can
 * REVOKE reach and cannot CONFER it. An assignment with no grant behind it sees
 * nothing; a grant with no assignment behind it sees nothing either. Both halves
 * are required, which is what F-114 asks for.
 *
 * SERVER-ONLY.
 */
import { requirePermission } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { optionalText, requiredDate, requiredText } from "@/lib/validation";
import { recordAuditEvent } from "@/modules/audit";

import { assertClosable, IntervalError } from "../domain/interval";
import { ensureGroupsRegistrations } from "../infrastructure/registrations";
import { instant, type ActorContext } from "./group-service";
import { TEXT_MAX } from "./input";

export { IntervalError };

export interface AssignInstructorInput {
  personId: unknown;
  role?: unknown;
  fromDate: unknown;
}

/**
 * Assigns a person to teach a group.
 *
 * `groups.manage` and not `groups.assign_members`: the latter is about placing
 * PUPILS, and the two are different powers over different people. A senior
 * instructor who may move children between their own groups should not thereby
 * be able to put themselves — or anybody else — in front of a new one, because
 * that is the act that turns a dormant `GROUP` grant into live reach over a
 * dozen children's records.
 */
export async function assignInstructor(
  actor: ActorContext,
  groupId: string,
  input: AssignInstructorInput,
): Promise<{ assignmentId: string }> {
  ensureGroupsRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "groups.manage",
    { group: groupId },
    { at },
  );

  const personId = requiredText("personId", input.personId, 40);
  const role = optionalText("role", input.role, TEXT_MAX.instructorRole);
  const fromDate = requiredDate("fromDate", input.fromDate);

  return prisma.$transaction(async (tx) => {
    const open = await tx.instructorAssignment.findFirst({
      where: { personId, groupId, toDate: null },
      select: { id: true },
    });
    if (open) {
      throw new IntervalError(
        "alreadyClosed",
        "This person already has an open assignment to this group. A second " +
          "one would make 'when did they stop teaching it' — the question " +
          "D-145 turns into an access decision — ambiguous.",
      );
    }

    const assignment = await tx.instructorAssignment.create({
      data: { personId, groupId, role, fromDate },
      select: { id: true },
    });

    await recordAuditEvent(
      {
        eventType: "groups.instructor.assigned",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "group",
        targetId: groupId,
        requestId: actor.requestId ?? null,
        // The assigned person's ID is the point of the event and is an
        // identifier, not content: this is the row that decides whether a GROUP
        // grant is live, so who it names has to be reconstructable.
        changedFields: {
          personId,
          assignmentId: assignment.id,
          roleStated: role !== null,
        },
      },
      tx,
    );

    return { assignmentId: assignment.id };
  });
}

export interface EndInstructorAssignmentInput {
  personId: unknown;
  toDate: unknown;
}

/**
 * Ends an instructor's assignment to a group.
 *
 * **THIS IS AN ACCESS-AFFECTING WRITE**, and the audit event says so. From the
 * instant `toDate` passes, `activeInstructorGroupIds` stops returning this
 * group, `resolveReach` stops admitting the holder's `GROUP` grant, and every
 * read of that group's pupils becomes a DENIAL — on the next query, not at the
 * next cleanup. Nothing is deleted: the assignment row is closed and stays, so
 * "who taught this group in 2026?" still has an answer.
 */
export async function endInstructorAssignment(
  actor: ActorContext,
  groupId: string,
  input: EndInstructorAssignmentInput,
): Promise<void> {
  ensureGroupsRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "groups.manage",
    { group: groupId },
    { at },
  );

  const personId = requiredText("personId", input.personId, 40);
  const toDate = requiredDate("toDate", input.toDate);

  await prisma.$transaction(async (tx) => {
    const open = await tx.instructorAssignment.findFirst({
      where: { personId, groupId, toDate: null },
      select: { id: true, fromDate: true, toDate: true },
    });
    if (!open) {
      throw new IntervalError(
        "noOpenInterval",
        "This person has no open assignment to this group to end.",
      );
    }

    assertClosable(open, toDate);

    await tx.instructorAssignment.update({
      where: { id: open.id },
      data: { toDate },
    });

    await recordAuditEvent(
      {
        eventType: "groups.instructor.assignment_ended",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "group",
        targetId: groupId,
        requestId: actor.requestId ?? null,
        changedFields: {
          personId,
          assignmentId: open.id,
          // The reason this event is worth finding later. An instructor who
          // says "I can't see my group any more" is answered by this row.
          endsGroupReach: true,
        },
      },
      tx,
    );
  });
}
