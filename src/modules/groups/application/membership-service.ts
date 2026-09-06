/**
 * Placing a pupil in a group, and moving them between groups.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE MOVE OPERATION, AND ONLY ONE
 *
 * `moveStudent` handles `UP`, `DOWN` and `LATERAL`. There is no second entry
 * point, no extra permission on one direction, no approval step on one and not
 * the others, and no branch below that reads `direction` for anything except
 * writing it down. That is D-108 taken literally: *moving a child back down must
 * be exactly as ordinary in the history as moving up*, and the domain expert was
 * explicit that both are normal teaching events.
 *
 * The asymmetry this guards against does not arrive as a decision. It arrives as
 * a helper somebody adds for "the common case" six months from now, which
 * quietly makes the other case the exception. `groups-move-symmetry.test.ts`
 * asserts the module's shape, not just its behaviour, for that reason.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE TRANSACTION, THREE ROWS
 *
 * A move closes the old `GroupMembership`, opens a new one, and writes the
 * `GroupMove` that explains both — in ONE transaction, together with the audit
 * event. A partial move is not a valid state: a child in no group, or in two,
 * with no record of why, is worse than a failed button.
 *
 * SERVER-ONLY.
 */
import { requirePermission } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { requiredDate, requiredEnum, requiredText } from "@/lib/validation";
import { recordAuditEvent } from "@/modules/audit";

import { assertHasRoom, type CapacityState } from "../domain/capacity";
import {
  assertMoveIsCoherent,
  GROUP_MOVE_DIRECTIONS,
  GroupMoveError,
  type GroupMoveDirectionValue,
} from "../domain/group-move";
import { assertClosable, IntervalError } from "../domain/interval";
import { findStudentGroupHistory } from "../infrastructure/group-repository";
import { ensureGroupsRegistrations } from "../infrastructure/registrations";
import { instant, type ActorContext } from "./group-service";
import { TEXT_MAX } from "./input";

export { GROUP_MOVE_DIRECTIONS, GroupMoveError };
export type { GroupMoveDirectionValue };

/** A Prisma transaction client, as the helpers below take one. */
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** The half-open activity rule as a filter. Mirrors `isActiveAt`. */
function activeAt(at: Date) {
  return {
    fromDate: { lte: at },
    OR: [{ toDate: null }, { toDate: { gt: at } }],
  };
}

async function capacityStateOf(
  tx: Tx,
  groupId: string,
  at: Date,
): Promise<CapacityState> {
  const [group, occupied] = await Promise.all([
    tx.group.findUnique({ where: { id: groupId }, select: { capacity: true } }),
    tx.groupMembership.count({ where: { groupId, ...activeAt(at) } }),
  ]);
  return { capacity: group?.capacity ?? null, occupied };
}

export interface PlaceStudentInput {
  studentProfileId: unknown;
  fromDate: unknown;
  reason: unknown;
  /**
   * Place into a group that is already at capacity. An EXPLICIT, audited act —
   * see `../domain/capacity.ts` for why the ceiling refuses by default and
   * takes an override rather than being a constraint nobody can pass.
   */
  overrideCapacity?: boolean;
}

/**
 * Places a pupil in a group for the first time, or into an additional group.
 *
 * IT WRITES A `GroupMove` TOO, with `fromGroupId = null`. A first placement is a
 * real event in the child's history — it is when they joined a group — and a
 * history that starts with a membership row and no explanation reads as though
 * the record began mid-sentence.
 */
export async function placeStudentInGroup(
  actor: ActorContext,
  groupId: string,
  input: PlaceStudentInput,
): Promise<{ membershipId: string; moveId: string }> {
  ensureGroupsRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "groups.assign_members",
    { group: groupId },
    { at },
  );

  const studentProfileId = requiredText(
    "studentProfileId",
    input.studentProfileId,
    40,
  );
  const fromDate = requiredDate("fromDate", input.fromDate);
  const reason = requiredText("reason", input.reason, TEXT_MAX.reason);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.groupMembership.findFirst({
      where: { groupId, studentProfileId, toDate: null },
      select: { id: true },
    });
    if (existing) {
      throw new GroupMoveError(
        "sameGroup",
        "This pupil is already in this group. Placing them again would make " +
          "'is this child in this group right now' a question with two answers.",
      );
    }

    assertHasRoom(
      await capacityStateOf(tx, groupId, at),
      input.overrideCapacity === true,
    );

    const membership = await tx.groupMembership.create({
      data: { groupId, studentProfileId, fromDate },
      select: { id: true },
    });

    const move = await tx.groupMove.create({
      data: {
        studentProfileId,
        fromGroupId: null,
        toGroupId: groupId,
        // A first placement is neither up nor down from anything.
        direction: "LATERAL",
        reason,
        decidedByPersonId: actor.principal.personId,
        occurredAt: fromDate,
      },
      select: { id: true },
    });

    await recordAuditEvent(
      {
        eventType: "groups.membership.placed",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "group",
        targetId: groupId,
        requestId: actor.requestId ?? null,
        // IDS AND TOKENS, never the reason text: a group move's reason is
        // written about a named child and belongs in the row it explains, not
        // in an append-only trail that cannot be corrected.
        changedFields: {
          studentProfileId,
          membershipId: membership.id,
          moveId: move.id,
          direction: "LATERAL",
          capacityOverridden: input.overrideCapacity === true,
        },
      },
      tx,
    );

    return { membershipId: membership.id, moveId: move.id };
  });
}

export interface MoveStudentInput {
  studentProfileId: unknown;
  fromGroupId: unknown;
  toGroupId: unknown;
  direction: unknown;
  reason: unknown;
  occurredAt: unknown;
  overrideCapacity?: boolean;
}

/**
 * Moves a pupil from one group to another — **in any direction**.
 *
 * Guarded on BOTH groups. A principal who may assign into the target but not out
 * of the source could otherwise remove a child from a group they have no reach
 * over, which is a write to somebody else's group dressed up as a write to their
 * own.
 *
 * The membership rows are what §3.2 calls "the data": the old one is CLOSED,
 * never deleted, and a new one is opened. Both survive, which is what makes
 * "which group was this child in last March?" answerable at all — and it is why
 * the definition of done can assert that a pupil moved down has TWO rows.
 */
export async function moveStudent(
  actor: ActorContext,
  input: MoveStudentInput,
): Promise<{
  closedMembershipId: string;
  openedMembershipId: string;
  moveId: string;
}> {
  ensureGroupsRegistrations();
  const at = instant(actor);

  const studentProfileId = requiredText(
    "studentProfileId",
    input.studentProfileId,
    40,
  );
  const fromGroupId = requiredText("fromGroupId", input.fromGroupId, 40);
  const toGroupId = requiredText("toGroupId", input.toGroupId, 40);
  const direction = requiredEnum(
    "direction",
    input.direction,
    GROUP_MOVE_DIRECTIONS,
  );
  const reason = requiredText("reason", input.reason, TEXT_MAX.reason);
  const occurredAt = requiredDate("occurredAt", input.occurredAt);

  // BOTH ENDS. Note there is no branch on `direction` here or below — a DOWN
  // passes exactly the checks an UP does.
  await requirePermission(
    actor.principal,
    "groups.assign_members",
    { group: fromGroupId },
    { at },
  );
  await requirePermission(
    actor.principal,
    "groups.assign_members",
    { group: toGroupId },
    { at },
  );

  assertMoveIsCoherent({
    studentProfileId,
    fromGroupId,
    toGroupId,
    direction,
    reason,
    occurredAt,
  });

  return prisma.$transaction(async (tx) => {
    const open = await tx.groupMembership.findFirst({
      where: { groupId: fromGroupId, studentProfileId, toDate: null },
      select: { id: true, fromDate: true, toDate: true },
    });
    if (!open) {
      throw new GroupMoveError(
        "notInSourceGroup",
        "This pupil has no open placement in the group they are being moved " +
          "out of. Moving them would leave a history that does not add up.",
      );
    }

    assertClosable(open, occurredAt);
    assertHasRoom(
      await capacityStateOf(tx, toGroupId, at),
      input.overrideCapacity === true,
    );

    // CLOSED, not deleted. The row is the child's history.
    await tx.groupMembership.update({
      where: { id: open.id },
      data: { toDate: occurredAt },
    });

    const opened = await tx.groupMembership.create({
      data: { groupId: toGroupId, studentProfileId, fromDate: occurredAt },
      select: { id: true },
    });

    const move = await tx.groupMove.create({
      data: {
        studentProfileId,
        fromGroupId,
        toGroupId,
        direction,
        reason,
        decidedByPersonId: actor.principal.personId,
        occurredAt,
      },
      select: { id: true },
    });

    await recordAuditEvent(
      {
        // ONE event type for all three directions. A `groups.membership.demoted`
        // beside a `groups.membership.promoted` would make a move down
        // separately searchable, separately alertable and separately explainable
        // — which is precisely the asymmetry D-108 refuses.
        eventType: "groups.membership.moved",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "group",
        targetId: toGroupId,
        requestId: actor.requestId ?? null,
        changedFields: {
          studentProfileId,
          fromGroupId,
          toGroupId,
          direction,
          moveId: move.id,
          capacityOverridden: input.overrideCapacity === true,
        },
      },
      tx,
    );

    return {
      closedMembershipId: open.id,
      openedMembershipId: opened.id,
      moveId: move.id,
    };
  });
}

export interface EndMembershipInput {
  studentProfileId: unknown;
  toDate: unknown;
}

/**
 * Ends a placement without opening another — a pupil leaving the club, or
 * pausing.
 *
 * NOT a move: there is no target group, so there is no `GroupMove` and no
 * direction to record. The lifecycle event that explains WHY belongs to
 * `people`'s `StudentLifecycleEvent`, which is where D-134 puts it.
 */
export async function endGroupMembership(
  actor: ActorContext,
  groupId: string,
  input: EndMembershipInput,
): Promise<void> {
  ensureGroupsRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "groups.assign_members",
    { group: groupId },
    { at },
  );

  const studentProfileId = requiredText(
    "studentProfileId",
    input.studentProfileId,
    40,
  );
  const toDate = requiredDate("toDate", input.toDate);

  await prisma.$transaction(async (tx) => {
    const open = await tx.groupMembership.findFirst({
      where: { groupId, studentProfileId, toDate: null },
      select: { id: true, fromDate: true, toDate: true },
    });
    if (!open) {
      throw new IntervalError(
        "noOpenInterval",
        "This pupil has no open placement in this group to end.",
      );
    }

    assertClosable(open, toDate);

    await tx.groupMembership.update({
      where: { id: open.id },
      data: { toDate },
    });

    await recordAuditEvent(
      {
        eventType: "groups.membership.ended",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "group",
        targetId: groupId,
        requestId: actor.requestId ?? null,
        changedFields: { studentProfileId, membershipId: open.id },
      },
      tx,
    );
  });
}

/**
 * A pupil's whole group history, guarded on the PUPIL rather than on a group.
 *
 * `{ student }` is the right reference: the history spans groups, so no single
 * group reference could authorise it, and a `GROUP`-scoped instructor holding
 * reach over one of them must not thereby read the child's placements
 * everywhere. That is D-145 rule 2 — coverage is per relation, and a group grant
 * returns *that group's* records, not the pupil's other ones.
 */
export async function getStudentGroupHistory(
  actor: ActorContext,
  studentProfileId: string,
) {
  ensureGroupsRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "groups.read",
    { student: studentProfileId },
    { at },
  );

  return findStudentGroupHistory(studentProfileId);
}

export { GroupFullError } from "../domain/capacity";
